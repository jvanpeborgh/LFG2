import {
  WORLD_HEIGHT, castCost, checkSummon, levelForTier, looksLikeScenario, scaleSummonToTier, summonTier, tierForLevel, type SummonReport, fitSpecToRules, generateModel, newSummonState, planSummon, playtestSummon, stepSummon, summonHurt,
  summonStats, type BrainPlayer, type EntityTypeDef, type SummonSpec, type SummonState, type SummonStats,
} from "@lfg/shared";
import type { Entity } from "../../entities";
import type { ServerModule } from "../../kernel";
import type { Player } from "../../player";
import type { WorldEventQueue } from "../../worldEvents";
import type { CastContext, Caster, ProgressionService } from "./progression";

interface Summoned {
  spec: SummonSpec;
  stats: SummonStats;
  state: SummonState;
  by: string;
  /** Run by a scenario (which handles its lifetime and limits), not a lone summon. */
  owner?: string;
  /** Which cast it came from (XP for the creator when others engage with it) and who cast it. */
  castKey?: string;
  casters?: string[];
  /** Seconds each nearby player has spent around it. */
  nearby?: Map<string, number>;
}

/**
 * What the summons module offers other modules (as the "summons" service):
 * scenarios use it to bring in ships, raiders and bosses with the same
 * generation, checks and behaviour as /summon.
 */
export interface SummonService {
  /** Generate and check the model, and work out the stats from the standards. */
  prepare(spec: SummonSpec, tier?: number): { stats: SummonStats; report: SummonReport } | string;
  /** Make the type known to the server and every client (idempotent). */
  register(spec: SummonSpec, stats: SummonStats): string;
  spawn(spec: SummonSpec, stats: SummonStats, x: number, y: number, z: number, opts: { by: string; owner?: string; health?: number }): Entity;
  state(id: number): SummonState | undefined;
  remove(id: number): void;
  /** Hostile summons that count against the world's hazard limit (scenario ones don't: a scenario counts once). */
  hostiles(): number;
}

/** The scenarios module's service, as far as summons need it. */
interface ScenarioService {
  active(): number;
  cast(p: Player, text: string, ctx: CastContext): string;
}

/**
 * /summon <anything>: generated creatures and objects, as world events.
 *
 *   gathering   plan the request into a spec, fit it to the rules, generate the
 *               3D model, check it (budgets, palette, readability), and shadow-
 *               playtest its behaviour on the real terrain with virtual players
 *   arrival     register the new type with every client (they generate the same
 *               model from the spec) and spawn it somewhere that suits it
 *   aftershock  the event queue watches for trouble (e.g. players dying) and
 *               undoes it, which removes what was summoned
 */
export const summons: ServerModule = {
  id: "vanilla:summons",
  name: "Summons",
  version: "0.1.0",
  author: "lfg",
  description: "Summon generated creatures and things (/summon a flying shark) as world events.",
  setup(api) {
    const { reg, std, table, world } = api;
    const sm = std.summons;
    const active = new Map<number, Summoned>();
    const sendTypes = (types: EntityTypeDef[], to?: Player) => {
      if (!types.length) return;
      for (const p of to ? [to] : api.players()) p.send({ t: "entityTypes", types });
    };
    const summonTypes = () => [...reg.entityTypes.values()].filter((t) => t.summon);
    api.on("player:join", ({ player }) => sendTypes(summonTypes(), player));

    const groundY = (x: number, z: number) => {
      for (let y = WORLD_HEIGHT - 1; y >= 0; y--) if (table.solid[world.getBlock(x, y, z)]) return y;
      return -1;
    };
    const [spawnX, , spawnZ] = world.store.meta.spawn;
    const inSafeZone = (x: number, z: number) => Math.hypot(x - spawnX, z - spawnZ) < sm.safeZoneRadius;

    /** Where it appears: in front of the summoner, at a height that suits how it moves. */
    const findSpot = (p: Player, spec: SummonSpec, stats: SummonStats): [number, number, number] | string => {
      const yaw = p.entity.yaw;
      const ahead = Math.max(4, spec.length * 0.8 + 3);
      const fx = p.entity.x - Math.sin(yaw) * ahead, fz = p.entity.z - Math.cos(yaw) * ahead;
      if (spec.movement === "swim") {
        // Nearest water deep enough to swim in.
        let best: [number, number, number] | null = null, bestD = Infinity;
        for (let dz = -24; dz <= 24; dz += 2)
          for (let dx = -24; dx <= 24; dx += 2) {
            const x = Math.floor(p.entity.x + dx), z = Math.floor(p.entity.z + dz);
            if (!world.isLoaded(x, 64, z)) continue;
            let top = -1;
            for (let y = WORLD_HEIGHT - 2; y > 0; y--) if (table.liquid[world.getBlock(x, y, z)]) { top = y; break; }
            if (top < 0 || !table.liquid[world.getBlock(x, top - 2, z)]) continue;
            const d = dx * dx + dz * dz;
            if (d < bestD) { bestD = d; best = [x + 0.5, top - 1.5, z + 0.5]; }
          }
        return best ?? `a ${spec.name.toLowerCase()} needs water nearby (or try "a flying ${spec.name.toLowerCase()}")`;
      }
      const g = groundY(Math.floor(fx), Math.floor(fz));
      if (g < 0) return "that spot isn't loaded yet";
      const y = spec.movement === "drift" ? Math.min(WORLD_HEIGHT - 4 - stats.height * 2, g + 1 + stats.altitude[0])
        : spec.movement === "fly" ? g + 1 + 4
        : spec.movement === "hover" ? g + 1 + 1.5
        : g + 1;
      return [fx, y, fz];
    };

    const register = (spec: SummonSpec, stats: SummonStats): string => {
      const name = `summon:${spec.id}`;
      if (!reg.entityTypes.has(name)) {
        const def: EntityTypeDef = {
          name, displayName: spec.name, width: stats.width, height: stats.height, maxHealth: stats.health,
          kind: stats.kind, model: [], tags: ["summon", spec.body, spec.movement], summon: spec,
        };
        reg.currentModule = api.id;
        reg.addEntityType(def);
        reg.currentModule = "kernel";
        sendTypes([def]);
      }
      return name;
    };

    const prepare = (spec: SummonSpec, tier = 2) => {
      const model = generateModel(spec, std);
      const report = checkSummon(spec, model, std, tier);
      if (!report.ok) return report.errors.join("; ");
      return { stats: summonStats(spec, model, std), report };
    };
    const spawnOne = (spec: SummonSpec, stats: SummonStats, x: number, y: number, z: number, opts: { by: string; owner?: string; health?: number }) => {
      const e = api.spawnEntity(register(spec, stats), x, y, z);
      const state = newSummonState(e.x, e.y, e.z, api.rand);
      e.yaw = state.yaw;
      e.data.summonedBy = opts.by;
      if (opts.health) e.health = opts.health;
      active.set(e.id, { spec, stats, state, by: opts.by, owner: opts.owner });
      return e;
    };
    const hostiles = () => [...active.values()].filter((s) => s.stats.kind === "hostile" && !s.owner).length;
    const service: SummonService = {
      prepare, register, spawn: spawnOne, hostiles,
      state: (id) => active.get(id)?.state,
      remove: (id) => { const e = api.entities.get(id); if (e) api.entities.remove(e); active.delete(id); },
    };
    api.provide("summons", service);

    /**
     * Cast a summon for `p` (or a ritual led by `p`): plan it, check it fits the caster's tier
     * (or scale it down, saying what it would need), pay for it, and submit it as a world event.
     */
    const cast = (p: Player, text: string, ctx: CastContext): string => {
      const scenarios = api.use<ScenarioService>("scenarios");
      if (scenarios && looksLikeScenario(text)) return scenarios.cast(p, text, ctx);
      const plan = planSummon(text);
      if (!plan.spec) return plan.notes.join("\n");
      const prog = api.use<ProgressionService>("progression");
      const allowed = prog ? tierForLevel(ctx.level ?? prog.level(p), std) : std.locked.progression.tiers;
      const notes = [...plan.notes];
      let planned = plan.spec;
      const want = summonTier(planned);
      if (want.tier > allowed) {
        const scaled = scaleSummonToTier(planned, allowed);
        const need = `${planned.name} is tier ${want.tier} (${want.why.join(", ")}): it needs level ${levelForTier(want.tier, std)}, or a ritual: /ritual ${text}`;
        if (!scaled) return need;
        notes.push(need);
        planned = scaled;
      }
      const tier = summonTier(planned).tier;
      const fitted = fitSpecToRules(planned, std, tier);
      const spec = fitted.spec;
      notes.push(...fitted.notes);
      const payers = ctx.payers ?? [p];
      const refund = prog ? prog.pay(payers, tier) : () => {};
      if (typeof refund === "string") return `Can't summon ${spec.name}: ${refund}`;
      const castKey = `${spec.name}#${Date.now()}`;
      const spawned: Entity[] = [];
      let stats: SummonStats | null = null;
      let at: [number, number, number] | null = null;
      const queue = api.use<WorldEventQueue>("kernel:events");
      if (!queue) { refund(1); return "World events aren't available"; }
      queue.submit({
        title: `${spec.name}${spec.count > 1 ? ` ×${spec.count}` : ""}`,
        by: payers.map((q) => q.name).join(" + "),
        size: tier >= 4 ? "epic" : spec.temperament === "hostile" || tier >= 3 ? "major" : "minor",
        detail: [`tier ${tier}`, ...notes].join(" · "),
        check: () => {
          // Limits first (cheap), then the model, then the behaviour.
          const mine = [...active.values()].filter((s) => s.by === p.name && !s.owner).length;
          if (mine + spec.count > sm.maxActivePerPlayer) return `you already have ${mine} summons (limit ${sm.maxActivePerPlayer}); /unsummon some first`;
          if (active.size + spec.count > sm.maxActiveWorld) return `the world already has ${active.size} summons (limit ${sm.maxActiveWorld})`;
          const prepared = prepare(spec, tier);
          if (typeof prepared === "string") return prepared;
          const report = prepared.report;
          stats = prepared.stats;
          if (stats.kind === "hostile") {
            const hazards = hostiles() + (api.use<ScenarioService>("scenarios")?.active() ?? 0);
            if (hazards + 1 > std.locked.maxWorldwideHazards) return `there are already ${hazards} hazards (hostile summons and scenarios; the world allows ${std.locked.maxWorldwideHazards} hazards at once)`;
          }
          const spot = findSpot(p, spec, stats);
          if (typeof spot === "string") return spot;
          at = spot;
          const test = playtestSummon(spec, stats, std, world.store, table, spot);
          api.log(`playtest ${spec.id}: ${JSON.stringify(test.metrics)}${test.warnings.length ? ` warnings: ${test.warnings.join("; ")}` : ""}`);
          if (!test.ok) return `failed its playtest: ${test.errors.join("; ")}`;
          for (const w of [...report.warnings, ...test.warnings]) api.tell(p, `(${spec.name}) ${w}`);
          return null;
        },
        apply: () => {
          const [x, y, z] = at!;
          for (let i = 0; i < spec.count; i++) {
            const a = (i / spec.count) * Math.PI * 2, r = spec.count > 1 ? 1.5 + spec.length * 0.6 : 0;
            const e = spawnOne(spec, stats!, x + Math.cos(a) * r, y, z + Math.sin(a) * r, { by: p.name });
            active.get(e.id)!.castKey = castKey;
            active.get(e.id)!.casters = payers.map((q) => q.name);
            spawned.push(e);
          }
          if (stats!.kind === "hostile" && inSafeZone(x, z)) api.tell(p, `(${spec.name}) It won't hunt anyone within ${sm.safeZoneRadius} blocks of spawn.`);
        },
        revert: () => {
          for (const e of spawned) { active.delete(e.id); api.entities.remove(e); }
        },
        onFizzle: () => refund(std.progression.aether.fizzleRefund),
      });
      const cost = castCost(tier, std);
      return `Summoning ${spec.name}${spec.count > 1 ? ` ×${spec.count}` : ""} (tier ${tier}: ${cost.aether} aether${cost.shards ? ` + ${cost.shards} shards` : ""})…${notes.length > plan.notes.length ? `\n${notes.slice(plan.notes.length).join("\n")}` : ""}`;
    };

    api.provide("caster:summons", {
      plan: (_p, text) => {
        if (looksLikeScenario(text)) return null;
        const plan = planSummon(text);
        return plan.spec ? { tier: summonTier(plan.spec).tier, title: plan.spec.name } : null;
      },
      cast,
    } satisfies Caster);

    api.command({
      name: "summon",
      usage: "/summon <what> (e.g. a big cloud, a flying shark, two pigs)",
      help: "Summon something into the world (as a world event)",
      admin: false,
      run(p, args) {
        if (!p) return "Players only";
        const text = args.join(" ").trim();
        if (!text) return "Summon what? e.g. /summon a big cloud";
        // Built-in mobs by name still work directly for admins: /summon zombie 3
        const vanilla = reg.entityTypes.get(args[0]);
        if (vanilla && !vanilla.summon && (vanilla.kind === "passive" || vanilla.kind === "hostile") && p.admin) {
          const n = Math.min(20, Math.max(1, Number(args[1]) || 1));
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            api.spawnEntity(vanilla.name, p.entity.x + Math.cos(a) * 3, p.entity.y + 0.5, p.entity.z + Math.sin(a) * 3);
          }
          return `Summoned ${n} ${vanilla.displayName}`;
        }
        return cast(p, text, {});
      },
    });

    api.command({
      name: "unsummon",
      usage: "/unsummon [all]",
      help: "Remove your summons (or everyone's, for admins)",
      admin: false,
      run(p, [arg]) {
        let n = 0;
        for (const [id, s] of active) {
          if (s.owner) continue; // scenarios clean up their own
          if (arg === "all" ? !p?.admin && s.by !== p?.name : s.by !== p?.name) continue;
          const e = api.entities.get(id);
          if (e) api.entities.remove(e);
          active.delete(id);
          n++;
        }
        return `Removed ${n} summon${n === 1 ? "" : "s"}`;
      },
    });

    // ------------------------------------------------------------ behaviour
    api.on("tick", ({ dt }) => {
      if (active.size === 0) return;
      const players: (BrainPlayer & { p: Player })[] = api.players().map((p) => ({
        id: p.entity.id, x: p.entity.x, y: p.entity.y, z: p.entity.z, p,
        huntable: !p.dead && p.gameMode !== "creative" && !inSafeZone(p.entity.x, p.entity.z),
      }));
      for (const [id, s] of active) {
        const e = api.entities.get(id);
        if (!e || e.removed) { active.delete(id); continue; }
        if (!world.isLoaded(Math.floor(e.x), Math.max(0, Math.min(WORLD_HEIGHT - 1, Math.floor(e.y))), Math.floor(e.z))) continue;
        stepSummon(s.spec, s.stats, e.body, s.state, {
          world: world.store, table, gravity: std.balance.player.gravity, rand: api.rand, players,
          groundY,
          bite: (pid, dmg) => {
            const target = players.find((q) => q.id === pid)?.p;
            if (!target) return;
            if (api.damage(target.entity, dmg, { kind: "melee", attacker: e })) api.knockback(target.entity, e.x, e.z, 3);
          },
          warn: () => {
            api.sendNear(e.x, e.y, e.z, 48, { t: "entityEvent", id: e.id, event: "fuse" });
            if (s.stats.slamRadius) api.sendNear(e.x, e.y, e.z, 64, { t: "slam", phase: "warn", x: e.x, y: e.y, z: e.z, radius: s.stats.slamRadius, seconds: s.stats.telegraph });
          },
          slam: (x, y, z, radius) => api.sendNear(x, y, z, 64, { t: "slam", phase: "hit", x, y, z, radius, seconds: 0 }),
        }, dt);
        e.yaw = s.state.yaw;
        e.pitch = s.state.pitch;
        e.flags = (e.flags & 1) | s.state.flags;
        // Lifetime, and hostiles nobody is near any more.
        const nearest = Math.min(Infinity, ...players.map((q) => Math.hypot(q.x - e.x, q.z - e.z)));
        if (!s.owner && (s.state.age > s.stats.lifetime || (s.stats.kind === "hostile" && nearest > 96))) { api.entities.remove(e); active.delete(id); }
      }
    });

    // Others enjoying what you made: time spent near it, or fighting it, earns the caster XP.
    const engage = (s: Summoned, q: Player) => {
      if (!s.castKey || s.casters?.includes(q.name)) return;
      const seen = (s.nearby ??= new Map());
      if (seen.get(q.name) === -1) return;
      seen.set(q.name, -1);
      api.use<ProgressionService>("progression")?.engaged(s.by, s.castKey, q);
    };
    api.every(1, () => {
      for (const [id, s] of active) {
        if (!s.castKey) continue;
        const e = api.entities.get(id);
        if (!e) continue;
        for (const q of api.players()) {
          if (q.dead || s.casters?.includes(q.name) || Math.hypot(q.entity.x - e.x, q.entity.z - e.z) > 12) continue;
          const seen = (s.nearby ??= new Map());
          const t = seen.get(q.name) ?? 0;
          if (t < 0) continue;
          if (t + 1 >= 20) engage(s, q); else seen.set(q.name, t + 1);
        }
      }
    });
    api.on("entity:damage", ({ entity, source }) => {
      // Bitten by someone's summon counts as engaging with it too.
      const biter = source.attacker ? active.get(source.attacker.id) : undefined;
      const victim = api.playerOf(entity);
      if (biter && victim) engage(biter, victim);
      const s = active.get(entity.id);
      if (!s) return;
      const attacker = source.attacker ? api.playerOf(source.attacker) : undefined;
      if (attacker) engage(s, attacker);
      summonHurt(s.spec, s.state, attacker ? attacker.entity.id : null, source.attacker?.x ?? entity.x, source.attacker?.z ?? entity.z, entity.x, entity.z);
    });
    api.on("entity:death", ({ entity }) => { active.delete(entity.id); });
  },
};
