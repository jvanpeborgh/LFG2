import {
  SCENARIO_RULES, bossHealth, castCost, describeScenario, findCoast, levelForTier, looksLikeScenario, looksLikeRace, planScenario, playtestScenario,
  scaleScenarioToTier, scenarioTier, tierForLevel, buildRaid, raidId,
  type Coast, type RaidInput, type ShapeIssue, type ScenarioHud, type ScenarioSpec, type SummonSpec, type SummonStats,
} from "@lfg/shared";
import type { Entity } from "../../entities";
import type { ServerModule } from "../../kernel";
import type { Player } from "../../player";
import type { WorldEventQueue } from "../../worldEvents";
import type { CastContext, Caster, ProgressionService } from "./progression";
import type { SummonService } from "./summons";

type Phase = "approach" | "wave" | "rest" | "leaving";

/** A raid written by an agent or a person, saved to the world (/event raid:<id>). */
export interface SavedRaid { id: string; input: RaidInput; spec: ScenarioSpec; by: string; savedAt: string; tier: number }

export interface RaidCheck {
  ok: boolean;
  issues: ShapeIssue[];
  spec?: ScenarioSpec;
  tier?: number;
  summary?: string;
  playtest?: { ok: boolean; errors: string[]; warnings: string[]; waves: unknown } | string;
}

/** The world's raids (the MCP server uses this for players' chats). */
export interface RaidLibrary {
  check(input: unknown, near?: [number, number]): Promise<RaidCheck>;
  save(by: string, input: unknown, near?: [number, number]): Promise<{ ok: true; raid: SavedRaid; check: RaidCheck } | { ok: false; check: RaidCheck }>;
  list(): { id: string; title: string; by: string; tier: number; waves: number; savedAt: string; startWith: string }[];
  remove(id: string, by: string, admin: boolean): string | null;
}

const RAID_REF = /^(?:a |an |the )?raid[: ]\s*([a-z0-9_-]+)$/i;

interface Running {
  spec: ScenarioSpec;
  coast: Coast;
  by: string;
  stats: Map<string, SummonStats>;
  phase: Phase;
  phaseTime: number;
  elapsed: number;
  abandoned: number;
  wave: number;
  ships: number[];
  foes: Set<number>;
  queue: { spec: SummonSpec; boss: boolean }[];
  disembark: number;
  nextLanding: number;
  bossId: number | null;
  bossName: string;
  bossMax: number;
  outcome: "won" | "lost" | null;
  hudTimer: number;
  /** Damage each player dealt to the current boss (XP is split by it). */
  bossDamage: Map<string, number>;
  casters: string[];
  castKey: string;
}

/**
 * Scenarios: world events with a story arc, directed live.
 *
 *   /event a swarm of pirate ships attack the coast in waves, with bosses
 *
 * An invasion runs like this:
 *   gathering   plan (ships, waves, bosses, reward), find the nearest coast
 *               with open sea outside the safe zone, generate and check every
 *               model, and shadow-playtest every wave against virtual
 *               defenders on the real terrain
 *   approach    ships appear out at sea and sail in, dropping anchor in the
 *               shallows
 *   waves       raiders jump off the ships a few at a time (never more than
 *               a handful on the field), wade ashore and go for the nearest
 *               defenders; brutes join later waves; bosses come with their
 *               wave and are scaled to the players there
 *   rest        a breather between waves, with a countdown
 *   end         win: a reward chest on the beach; lose (everyone left, or
 *               time ran out): the raiders get back on board. Either way the
 *               ships sail off and everything the scenario brought is removed.
 *
 * The whole scenario counts as one hazard against the world's hazard limit.
 */
export const scenarios: ServerModule = {
  id: "vanilla:scenarios",
  name: "Scenarios",
  version: "0.1.0",
  author: "lfg",
  description: "Directed world events with waves and bosses (/event pirates raid the coast in waves).",
  setup(api) {
    const { std, table, world, reg } = api;
    let current: Running | null = null;
    const summons = () => api.use<SummonService>("summons");
    const [spawnX, , spawnZ] = world.store.meta.spawn;

    const near = (r: Running, radius: number) =>
      api.players().filter((p) => !p.dead && Math.hypot(p.entity.x - r.coast.beach[0], p.entity.z - r.coast.beach[2]) < radius);
    const huntable = (p: Player) => !p.dead && p.gameMode !== "creative";

    const hud = (r: Running | null): ScenarioHud | null => {
      if (!r) return null;
      const left = r.queue.length + r.foes.size;
      const status =
        r.outcome === "won" ? "Victory! A reward chest is on the beach"
        : r.outcome === "lost" ? "The raiders are leaving"
        : r.phase === "approach" ? "Ships approaching"
        : r.phase === "rest" ? `Wave ${r.wave + 2} incoming`
        : `Wave ${r.wave + 1} of ${r.spec.waves.length}`;
      const boss = r.bossId !== null ? api.entities.get(r.bossId) : undefined;
      return {
        title: r.spec.title, status, wave: r.wave + 1, waves: r.spec.waves.length, enemiesLeft: r.phase === "wave" ? left : 0,
        at: r.coast.beach,
        ...(boss && !boss.removed ? { boss: { name: r.bossName, health: Math.max(0, boss.health), maxHealth: r.bossMax } } : {}),
        ...(r.phase === "rest" ? { countdown: Math.max(0, Math.ceil(r.spec.restSeconds - r.phaseTime)) } : {}),
      };
    };
    const sendHud = (to?: Player) => {
      const msg = { t: "scenario" as const, hud: hud(current) };
      for (const p of to ? [to] : api.players()) p.send(msg);
    };
    api.on("player:join", ({ player }) => { if (current) sendHud(player); });

    const statsOf = (r: { stats: Map<string, SummonStats> }, s: SummonSpec) => r.stats.get(s.id)!;

    /** Everything the scenario brought leaves; the HUD clears. */
    const cleanup = () => {
      const sv = summons();
      if (current && sv) for (const id of [...current.ships, ...current.foes]) sv.remove(id);
      current = null;
      sendHud();
    };

    const end = (r: Running, outcome: "won" | "lost", message: string) => {
      r.outcome = outcome;
      r.phase = "leaving";
      r.phaseTime = 0;
      r.queue = [];
      const sv = summons();
      // Raiders still ashore go back on board (simply vanish: there's no rowing-back animation yet).
      if (sv) for (const id of r.foes) sv.remove(id);
      r.foes.clear();
      r.bossId = null;
      if (outcome === "won") placeReward(r);
      // Ships weigh anchor and sail back out to sea.
      if (sv) r.ships.forEach((id, i) => {
        const st = sv.state(id);
        if (st) { st.goal = r.coast.starts[i % r.coast.starts.length]; st.anchored = false; }
      });
      api.broadcast(message, "event");
      sendHud();
    };

    const placeReward = (r: Running) => {
      const [cx, , cz] = r.coast.camp;
      const x = Math.floor(cx), z = Math.floor(cz);
      const y = world.surfaceY(x, z) + 1;
      const chest = reg.blockId("chest");
      if (!world.setBlock(x, y, z, chest)) return;
      const items = r.spec.reward.filter(([name]) => reg.hasItem(name)).map(([name, count]) => {
        const def = reg.item(name);
        return { item: def.id, count: Math.min(count, def.maxStack), ...(def.tool ? { durability: def.tool.durability } : {}) };
      });
      const slots = Array(27).fill(null);
      items.forEach((it, i) => (slots[i * 2] = it));
      world.setBlockEntity(x, y, z, { kind: "chest", slots: { items: slots }, data: {} });
      api.log(`scenario reward chest at ${x} ${y} ${z}`);
    };

    const startWave = (r: Running) => {
      r.wave++;
      r.phase = "wave";
      r.phaseTime = 0;
      const w = r.spec.waves[r.wave];
      const q: Running["queue"] = [];
      for (const g of w.groups) for (let k = 0; k < g.count; k++) q.push({ spec: g.spec, boss: false });
      for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(api.rand() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; }
      if (w.boss) q.push({ spec: w.boss, boss: true });
      r.queue = q;
      r.disembark = 0;
      api.broadcast(w.boss ? `⚔ Wave ${r.wave + 1}: ${w.boss.name} is coming ashore!` : `⚔ Wave ${r.wave + 1} of ${r.spec.waves.length}`, "event");
      sendHud();
    };

    // ------------------------------------------------------------ XP for defenders (and the creator)
    const waveCleared = (r: Running, defenders: Player[]) => {
      const prog = api.use<ProgressionService>("progression");
      if (!prog) return;
      for (const q of defenders) {
        prog.award(q, std.progression.xp.scenarioWave, "defended a wave");
        if (!r.casters.includes(q.name)) prog.engaged(r.by, r.castKey, q);
      }
    };
    const bossDefeated = (r: Running) => {
      const prog = api.use<ProgressionService>("progression");
      const total = [...r.bossDamage.values()].reduce((a, b) => a + b, 0);
      if (prog && total > 0) for (const [name, dmg] of r.bossDamage) {
        const q = api.playerByName(name);
        if (!q) continue;
        prog.award(q, Math.max(15, Math.round(std.progression.xp.bossDefeat * (dmg / total))), "defeated a boss");
        prog.awardShards(q, 1, `helped defeat ${r.bossName}`);
      }
      r.bossDamage.clear();
    };
    api.on("entity:damage", ({ entity, amount, source }) => {
      const r = current;
      if (!r || entity.id !== r.bossId || !source.attacker) return;
      const q = api.playerOf(source.attacker);
      if (q) r.bossDamage.set(q.name, (r.bossDamage.get(q.name) ?? 0) + amount);
    });

    /** A ship that's gone counts as anchored (nothing to wait for). */
    const anchored = (id: number) => { const st = summons()?.state(id); return !st || st.anchored === true; };

    api.on("tick", ({ dt }) => {
      const r = current;
      if (!r) return;
      const sv = summons();
      if (!sv) return cleanup();
      r.elapsed += dt;
      r.phaseTime += dt;
      // Forget enemies that are gone (defeated, or removed by anyone).
      for (const id of r.foes) {
        const e = api.entities.get(id);
        if (!e || e.removed) { r.foes.delete(id); if (id === r.bossId) { r.bossId = null; api.broadcast(`★ ${r.bossName} is defeated!`, "event"); bossDefeated(r); } }
      }
      const defenders = near(r, 80).filter(huntable);

      if (r.phase === "leaving") {
        // Ships sail off; when they're out at sea (or after a while) they're gone.
        const allOut = r.ships.every(anchored);
        if (allOut || r.phaseTime > 40) cleanup();
        return;
      }
      r.abandoned = defenders.length ? 0 : r.abandoned + dt;
      if (r.abandoned > r.spec.abandonSeconds) return end(r, "lost", `⚓ Nobody defended the coast: the ${r.spec.theme} sail away.`);
      if (r.elapsed > r.spec.timeLimitSeconds) return end(r, "lost", `⚓ The ${r.spec.theme} give up and sail away.`);

      if (r.phase === "approach") {
        if (r.ships.every(anchored) || r.phaseTime > 75) startWave(r);
      } else if (r.phase === "rest") {
        if (r.phaseTime >= r.spec.restSeconds) startWave(r);
      } else if (r.phase === "wave") {
        // Disembark a few at a time, never more than the cap on the field.
        r.disembark -= dt;
        if (r.queue.length && r.disembark <= 0 && r.foes.size < SCENARIO_RULES.maxAlive) {
          const q = r.queue.shift()!;
          const shipIdx = r.nextLanding++ % r.coast.landings.length;
          const ship = api.entities.get(r.ships[shipIdx]);
          const [lx, ly, lz] = r.coast.landings[shipIdx];
          // Jump off the ship's side towards the shore (or from the landing point if the ship is gone).
          const x = ship ? ship.x - r.coast.seaward[0] * 2.5 : lx, z = ship ? ship.z - r.coast.seaward[1] * 2.5 : lz;
          const stats = statsOf(r, q.spec);
          const health = q.boss ? bossHealth(stats.health, Math.max(1, defenders.length)) : undefined;
          const e: Entity = sv.spawn(q.spec, stats, x + (api.rand() - 0.5) * 2, Math.max(ly, ship ? ship.y + 2 : ly), z + (api.rand() - 0.5) * 2, { by: r.by, owner: r.spec.id, health });
          const st = sv.state(e.id)!;
          st.goal = [...r.coast.beach];
          r.foes.add(e.id);
          if (q.boss) { r.bossId = e.id; r.bossName = q.spec.name; r.bossMax = e.health; }
          r.disembark = q.boss ? 2 : SCENARIO_RULES.disembarkSeconds;
        }
        // Raiders head for the nearest defender near the beach, otherwise the beach itself.
        for (const id of r.foes) {
          const e = api.entities.get(id), st = sv.state(id);
          if (!e || !st) continue;
          let best = 48, goal: [number, number, number] = [...r.coast.beach];
          for (const p of defenders) {
            const d = Math.hypot(p.entity.x - e.x, p.entity.z - e.z);
            if (d < best) { best = d; goal = [p.entity.x, p.entity.y, p.entity.z]; }
          }
          st.goal = goal;
          // Stragglers that wandered far off (or fell somewhere) leave the fight.
          if (Math.hypot(e.x - r.coast.beach[0], e.z - r.coast.beach[2]) > 100 || e.y < 2) { sv.remove(id); continue; }
          // Stuck (in a hole, against a cliff) with nobody to fight: it comes ashore again at the beach.
          const last = (e.data.lastPos as [number, number, number, number] | undefined) ?? [e.x, e.z, r.elapsed, 0];
          if (Math.hypot(e.x - last[0], e.z - last[1]) > 1.5) e.data.lastPos = [e.x, e.z, r.elapsed, 0];
          else if (r.elapsed - last[2] > 15 && best > 4) {
            const [lx, ly, lz] = r.coast.landings[r.nextLanding++ % r.coast.landings.length];
            e.body.x = lx; e.body.y = ly + 1; e.body.z = lz; e.body.vx = e.body.vz = 0;
            e.data.lastPos = [lx, lz, r.elapsed, 0];
          } else e.data.lastPos = last;
        }
        if (!r.queue.length && r.foes.size === 0) {
          waveCleared(r, defenders);
          if (r.wave >= r.spec.waves.length - 1) {
            const prog = api.use<ProgressionService>("progression");
            for (const q of defenders) { prog?.award(q, std.progression.xp.scenarioWin, "won a scenario"); prog?.awardShards(q, 1, "won a scenario"); }
            return end(r, "won", `🏆 The coast is safe! A reward chest waits on the beach.`);
          }
          r.phase = "rest";
          r.phaseTime = 0;
          api.broadcast(`Wave ${r.wave + 1} cleared. Next wave in ${r.spec.restSeconds} s.`, "event");
        }
      }
      r.hudTimer -= dt;
      if (r.hudTimer <= 0) { r.hudTimer = 0.5; sendHud(); }
    });

    // ------------------------------------------------------------ written raids
    const savedRaids: { raids: SavedRaid[] } = api.storage.load<{ raids: SavedRaid[] }>("raids") ?? { raids: [] };
    const raids: RaidLibrary = {
      async check(input, near) {
        const sv = summons();
        if (!sv) return { ok: false, issues: [{ path: "", level: "error", message: "summons are switched off", hint: "" }] };
        const built = buildRaid(input, std, (who) => sv.plan(who), (name) => reg.hasItem(name));
        if (!built.spec) return { ok: false, issues: built.issues };
        const spec = built.spec;
        // Every member must pass the art checks, as when cast.
        const stats = new Map<string, SummonStats>();
        const issues = [...built.issues];
        for (const s of [spec.ship, ...spec.waves.flatMap((w) => [...w.groups.map((g) => g.spec), ...(w.boss ? [w.boss] : [])])]) {
          if (stats.has(s.id)) continue;
          const prep = sv.prepare(s, s.role === "boss" ? 4 : 3);
          if (typeof prep === "string") issues.push({ path: "waves", level: "error", message: `${s.name}: ${prep}`, hint: "pick another creature, or fix its design" });
          else stats.set(s.id, prep.stats);
        }
        const tier = scenarioTier(spec).tier;
        const base: RaidCheck = { ok: !issues.some((i) => i.level === "error"), issues, spec, tier, summary: describeScenario(spec) };
        if (!base.ok) return base;
        // Play every wave on a real coast near the player (or spawn), if one is loaded.
        const [nx, nz] = near ?? [spawnX, spawnZ];
        const coast = findCoast(world.store, table, (x, z) => world.isLoaded(Math.floor(x), 64, Math.floor(z)), [nx, nz], { ships: spec.ships, avoid: { x: spawnX, z: spawnZ, radius: std.summons.safeZoneRadius } });
        if (!coast) return { ...base, playtest: "no coast is loaded near here; it's playtested when started" };
        const test = await playtestScenario(spec, (s) => stats.get(s.id)!, std, world.store, table, coast, 1, 12345);
        return { ...base, ok: test.ok, playtest: { ok: test.ok, errors: test.errors, warnings: test.warnings, waves: test.waves } };
      },
      async save(by, input, near) {
        const check = await raids.check(input, near);
        if (!check.ok || !check.spec) return { ok: false, check };
        const id = raidId(input as RaidInput);
        const i = savedRaids.raids.findIndex((r) => r.id === id);
        if (i >= 0 && savedRaids.raids[i].by !== by) return { ok: false, check: { ...check, ok: false, issues: [...check.issues, { path: "id", level: "error", message: `"${id}" belongs to ${savedRaids.raids[i].by}`, hint: "pick another title or id" }] } };
        if (i < 0 && savedRaids.raids.length >= 100) return { ok: false, check: { ...check, ok: false, issues: [...check.issues, { path: "", level: "error", message: "this world has 100 raids", hint: "remove one first" }] } };
        const raid: SavedRaid = { id, input: input as RaidInput, spec: check.spec, by, savedAt: new Date().toISOString(), tier: check.tier ?? 3 };
        if (i >= 0) savedRaids.raids[i] = raid; else savedRaids.raids.push(raid);
        api.storage.save("raids", savedRaids);
        return { ok: true, raid, check };
      },
      list: () => savedRaids.raids.map((r) => ({ id: r.id, title: r.spec.title, by: r.by, tier: r.tier, waves: r.spec.waves.length, savedAt: r.savedAt, startWith: `/event raid:${r.id}` })),
      remove(id, by, admin) {
        const i = savedRaids.raids.findIndex((r) => r.id === id.toLowerCase());
        if (i < 0) return `no raid "${id}"`;
        if (savedRaids.raids[i].by !== by && !admin) return `"${id}" is ${savedRaids.raids[i].by}'s`;
        savedRaids.raids.splice(i, 1);
        api.storage.save("raids", savedRaids);
        return null;
      },
    };
    api.provide("raids", raids);
    /** "raid:bone_tide" → the saved raid; anything else → the planner. */
    const planText = (p: Player, text: string): { spec?: ScenarioSpec; notes: string[] } => {
      const m = RAID_REF.exec(text.trim());
      if (!m) return planScenario(text, std, nearbyCount(p), api.world.store.meta.theme?.raidTheme);
      const r = savedRaids.raids.find((x) => x.id === m[1].toLowerCase());
      return r ? { spec: structuredClone(r.spec), notes: [`${r.spec.title}, a raid by ${r.by}`] } : { notes: [`No raid called "${m[1]}" in this world (/raids lists them)`] };
    };
    const isRaidRef = (text: string) => RAID_REF.test(text.trim());

    const nearbyCount = (p: Player) => api.players().filter((q) => Math.hypot(q.entity.x - p.entity.x, q.entity.z - p.entity.z) < 96).length;

    /** Start a scenario for `p` (or a ritual led by `p`), within the caster's tier. */
    const cast = (p: Player, text: string, ctx: CastContext): string => {
      if (current) return `A scenario is already running (${current.spec.title}); one at a time.`;
      const sv = summons();
      const queue = api.use<WorldEventQueue>("kernel:events");
      if (!sv || !queue) return "Scenarios need the summons module and world events";
      const plan = planText(p, text);
      if (!plan.spec) return plan.notes.join("\n");
      const prog = api.use<ProgressionService>("progression");
      const allowed = prog ? tierForLevel(ctx.level ?? prog.level(p), std) : std.locked.progression.tiers;
      let spec = plan.spec;
      const want = scenarioTier(spec);
      const notes = [...plan.notes];
      if (want.tier > allowed) {
        const need = `${spec.title} (${want.why.join(", ")}) is tier ${want.tier}: it needs level ${levelForTier(want.tier, std)}, or a ritual: /ritual ${text}`;
        const scaled = scaleScenarioToTier(spec, allowed);
        if (!scaled) return need;
        notes.push(need);
        spec = scaled;
      }
      const tier = scenarioTier(spec).tier;
      const payers = ctx.payers ?? [p];
      const refund = prog ? prog.pay(payers, tier) : () => {};
      if (typeof refund === "string") return `Can't start ${spec.title}: ${refund}`;
      let coast: Coast | null = null;
      const stats = new Map<string, SummonStats>();
      let pending: Running | null = null;
      queue.submit({
        title: spec.title,
        by: payers.map((q) => q.name).join(" + "),
        size: tier >= 4 ? "epic" : "major",
        detail: [`tier ${tier}`, describeScenario(spec), ...notes].join(" · "),
        onFizzle: () => refund(std.progression.aether.fizzleRefund),
        check: async () => {
          if (current) return `a scenario is already running (${current.spec.title})`;
          const hazards = sv.hostiles() + 1;
          if (hazards > std.locked.maxWorldwideHazards) return `there are already ${hazards - 1} hazards (the world allows ${std.locked.maxWorldwideHazards} at once)`;
          coast = findCoast(world.store, table, (x, z) => world.isLoaded(Math.floor(x), 64, Math.floor(z)), [p.entity.x, p.entity.z], {
            ships: spec.ships, avoid: { x: spawnX, z: spawnZ, radius: std.summons.safeZoneRadius },
          });
          if (!coast) return "there's no coast with open sea nearby (outside the spawn safe zone) for ships to land on";
          // Every model must pass the art checks.
          const all = [spec.ship, ...spec.waves.flatMap((w) => [...w.groups.map((g) => g.spec), ...(w.boss ? [w.boss] : [])])];
          for (const s of all) {
            if (stats.has(s.id)) continue;
            const prep = sv.prepare(s);
            if (typeof prep === "string") return `${s.name}: ${prep}`;
            stats.set(s.id, prep.stats);
          }
          const test = await playtestScenario(spec, (s) => stats.get(s.id)!, std, world.store, table, coast, nearbyCount(p), Math.floor(api.rand() * 1e9));
          api.log(`scenario playtest ${spec.id}: ${JSON.stringify(test.waves)}${test.warnings.length ? ` warnings: ${test.warnings.join("; ")}` : ""}`);
          if (!test.ok) return `failed its playtest: ${test.errors.join("; ")}`;
          for (const w of test.warnings) api.tell(p, `(${spec.title}) ${w}`);
          return null;
        },
        apply: () => {
          const c = coast!;
          const r: Running = {
            spec, coast: c, by: p.name, stats, phase: "approach", phaseTime: 0, elapsed: 0, abandoned: 0, wave: -1,
            ships: [], foes: new Set(), queue: [], disembark: 0, nextLanding: 0, bossId: null, bossName: "", bossMax: 0, outcome: null, hudTimer: 0,
            bossDamage: new Map(), casters: payers.map((q) => q.name), castKey: `${spec.title}#${Date.now()}`,
          };
          const shipStats = statsOf(r, spec.ship);
          c.anchors.forEach((a, i) => {
            const [sx, sy, sz] = c.starts[i];
            const e = sv.spawn(spec.ship, shipStats, sx, sy, sz, { by: p.name, owner: spec.id });
            const st = sv.state(e.id)!;
            st.goal = a;
            st.yaw = Math.atan2(c.seaward[0], c.seaward[1]); // facing the shore
            e.yaw = st.yaw;
            r.ships.push(e.id);
          });
          current = pending = r;
          const dir = (() => {
            const dx = c.beach[0] - p.entity.x, dz = c.beach[2] - p.entity.z;
            const names = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"];
            return names[(Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) + 8) % 8];
          })();
          api.broadcast(`⚓ Sails on the horizon! ${spec.ships} ships are heading for the coast ${Math.round(Math.hypot(c.beach[0] - p.entity.x, c.beach[2] - p.entity.z))} blocks ${dir} (${Math.round(c.beach[0])}, ${Math.round(c.beach[2])}).`, "event");
          sendHud();
        },
        revert: () => { if (current && current === pending) cleanup(); },
      });
      const cost = castCost(tier, std);
      return `Planning ${spec.title}: ${describeScenario(spec)} (tier ${tier}: ${cost.aether} aether${cost.shards ? ` + ${cost.shards} shards` : ""})…${notes.length > plan.notes.length ? `\n${notes.slice(plan.notes.length).join("\n")}` : ""}`;
    };

    api.provide("scenarios", { active: () => (current ? 1 : 0), cast });
    api.provide("caster:scenarios", {
      plan: (p, text) => {
        if (!isRaidRef(text) && !looksLikeScenario(text)) return null;
        const sp = planText(p, text).spec;
        return sp ? { tier: scenarioTier(sp).tier, title: sp.title } : null;
      },
      cast,
      preview: (p, text, level) => {
        const sp = planText(p, text).spec;
        if (!sp) return null;
        const s = scaleScenarioToTier(sp, tierForLevel(level, std));
        return s ? { tier: scenarioTier(s).tier, title: s.title } : null;
      },
    } satisfies Caster);

    api.command({
      name: "raids",
      usage: "/raids [remove <id>]",
      help: "Raids written for this world (in a chat through the MCP server); start one with /event raid:<id>",
      admin: false,
      run(p, [sub, id]) {
        if (sub === "remove") return raids.remove(id ?? "", p?.name ?? "", p ? p.admin : true) ?? `Removed ${id}`;
        const list = raids.list();
        return list.length ? list.map((r) => `⚓ ${r.id}: ${r.title} by ${r.by} (tier ${r.tier}, ${r.waves} waves) · /event raid:${r.id}`).join("\n") : "No raids written for this world yet. Link a chat (/link) and write one there.";
      },
    });

    api.command({
      name: "event",
      usage: "/event <what happens> | /event stop",
      help: "Start a scenario as a world event (e.g. /event pirate ships raid the coast in waves, with bosses)",
      admin: false,
      run(p, args) {
        const text = args.join(" ").trim();
        if (text === "stop") {
          if (!current) return "No scenario is running";
          if (p && !p.admin && p.name !== current.by) return "Only whoever started it (or an admin) can stop it";
          end(current, "lost", `⚓ ${current.spec.title} was called off.`);
          return "Stopping";
        }
        if (!p) return "Players only";
        if (!text) return "What happens? e.g. /event a swarm of pirate ships attack in waves, with bosses";
        // Races are their own kind of event (see races.ts).
        const races = api.use<{ start(p: Player, text: string): string }>("races");
        if (races && looksLikeRace(text) && !looksLikeScenario(text)) return races.start(p, text);
        return cast(p, text, {});
      },
    });
  },
};
