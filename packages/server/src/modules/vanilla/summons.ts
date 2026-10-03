import {
  WORLD_HEIGHT, castCost, checkSummon, levelForTier, looksLikeScenario, scaleSummonToTier, summonTier, tierForLevel, type SummonReport, fitSpecToRules, generateModel, newSummonState, planSummon, playtestSummon, stepSummon, summonHurt,
  summonStats, checkDesign, designId, shapeForSculpting, interpretPrompt, lookupCreature, normalizeDesign, styleFor, type DesignCheck, type DesignInput, type BrainPlayer, type EntityTypeDef, type SummonSpec, type SummonState, type SummonStats,
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
  /** Plan a request: "design:<id>" is a saved design, anything else goes to the planner. */
  plan(text: string): { spec?: SummonSpec | null; notes: string[] };
  designs: DesignLibrary;
}

/** A design saved to a world, for players to cast (/summon design:<id>, or a scroll). */
export interface SavedDesign {
  id: string;
  input: DesignInput;
  spec: SummonSpec;
  by: string;
  savedAt: string;
  tier: number;
}

/** The world's designs: written by agents (through the MCP server) or people, checked like any summon. */
export interface DesignLibrary {
  list(): { id: string; name: string; by: string; tier: number; movement: string; temperament: string; length: number; savedAt: string; castWith: string }[];
  get(id: string): SavedDesign | undefined;
  /** Every check a cast makes, including a playtest on this world's terrain. */
  check(input: unknown): DesignCheck & { playtest?: { ok: boolean; errors: string[]; warnings: string[]; metrics: unknown } | string };
  save(by: string, input: unknown): { ok: true; design: SavedDesign; check: ReturnType<DesignLibrary["check"]> } | { ok: false; check: ReturnType<DesignLibrary["check"]> };
  remove(id: string, by: string, admin: boolean): string | null;
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
    // ------------------------------------------------------------ designs
    const MAX_DESIGNS = 200;
    const saved: { designs: SavedDesign[] } = api.storage.load<{ designs: SavedDesign[] }>("designs") ?? { designs: [] };
    const designs: DesignLibrary = {
      list: () => saved.designs.map((d) => ({ id: d.id, name: d.spec.name, by: d.by, tier: d.tier, movement: d.spec.movement, temperament: d.spec.temperament, length: d.spec.length, savedAt: d.savedAt, castWith: `/summon design:${d.id}` })),
      get: (id) => saved.designs.find((d) => d.id === id.toLowerCase()),
      check(input) {
        const c = checkDesign(input, std);
        if (!c.ok || !c.spec || !c.stats) return c;
        // Play it on this world's land near spawn (swimmers are tested where they're cast: they need water).
        if (c.spec.movement === "swim") return { ...c, playtest: "swimmers are playtested when cast, in the water they arrive in" };
        const [sx, , sz] = world.store.meta.spawn;
        const x = Math.floor(sx) + 12, z = Math.floor(sz) + 12;
        const g = groundY(x, z);
        if (g < 0) return { ...c, playtest: "the land here isn't loaded; it's playtested when cast" };
        const y = c.spec.movement === "drift" ? Math.min(WORLD_HEIGHT - 4 - c.stats.height * 2, g + 1 + c.stats.altitude[0]) : c.spec.movement === "fly" ? g + 5 : c.spec.movement === "hover" ? g + 2.5 : g + 1;
        const t = playtestSummon(c.spec, c.stats, std, world.store, table, [x + 0.5, y, z + 0.5]);
        return { ...c, ok: c.ok && t.ok, playtest: { ok: t.ok, errors: t.errors, warnings: t.warnings, metrics: t.metrics } };
      },
      save(by, input) {
        const check = designs.check(input);
        if (!check.ok || !check.spec) return { ok: false, check };
        const id = designId(input as DesignInput);
        const existing = saved.designs.findIndex((d) => d.id === id);
        if (existing >= 0 && saved.designs[existing].by !== by) return { ok: false, check: { ...check, ok: false, issues: [...check.issues, { path: "id", level: "error", message: `"${id}" belongs to ${saved.designs[existing].by}`, hint: "pick another id or name" }] } };
        if (existing < 0 && saved.designs.length >= MAX_DESIGNS) return { ok: false, check: { ...check, ok: false, issues: [...check.issues, { path: "", level: "error", message: `this world has ${MAX_DESIGNS} designs`, hint: "remove one first" }] } };
        const { id: _i, name, description, body, length, colors, features, movement, temperament, abilities, count, role, shape, style, gait, surface } = input as DesignInput;
        const clean = JSON.parse(JSON.stringify({ id: _i, name, description, body, length, colors, features, movement, temperament, abilities, count, role, shape, style, gait, surface })) as DesignInput;
        const design: SavedDesign = { id, input: clean, spec: check.spec, by, savedAt: new Date().toISOString(), tier: check.tier ?? 1 };
        if (existing >= 0) saved.designs[existing] = design; else saved.designs.push(design);
        api.storage.save("designs", saved);
        return { ok: true, design, check };
      },
      remove(id, by, admin) {
        const i = saved.designs.findIndex((d) => d.id === id.toLowerCase());
        if (i < 0) return `no design "${id}"`;
        if (saved.designs[i].by !== by && !admin) return `"${id}" is ${saved.designs[i].by}'s`;
        saved.designs.splice(i, 1);
        api.storage.save("designs", saved);
        return null;
      },
    };
    const DESIGN_REF = /^(?:a |an |the )?design[: ]\s*([a-z0-9_-]+)$/i;
    /** "design:lantern_moth" → the saved design; anything else → the planner. */
    const planText = (text: string): { spec?: SummonSpec | null; notes: string[] } => {
      const m = DESIGN_REF.exec(text.trim());
      if (!m) {
        const plan = planSummon(text);
        // Creatures the bestiary knows get the design skills' model (their species' features, body
        // and gait) in every style; the planner keeps what it read from the request (how many, a role).
        const known = lookupCreature(text.toLowerCase());
        if (known) {
          const r = interpretPrompt(text, std);
          const n = "error" in r ? undefined : normalizeDesign(r.start, std).spec;
          // The planner keeps the gameplay it read (name, size, movement, temperament, abilities, count,
          // role); the design brings the model: its shape, colours and gait.
          if (n?.shape && plan.spec && plan.spec.body !== "ship" && plan.spec.body !== "cloud") return { spec: { ...plan.spec, shape: n.shape, colors: n.colors, ...(n.gait ? { gait: n.gait } : {}), ...(n.surface ? { surface: n.surface } : {}) }, notes: plan.notes };
          if (n && !plan.spec) return { spec: { ...n, prompt: text }, notes: [] };
        }
        // Sculpted needs a shape: the design skills give planned summons one.
        if (plan.spec && styleFor(plan.spec, std) === "sculpted") plan.spec = shapeForSculpting(plan.spec, text, std);
        return plan;
      }
      const d = designs.get(m[1]);
      return d ? { spec: { ...d.spec, prompt: text }, notes: [`${d.spec.name}, a design by ${d.by}`] } : { notes: [`No design called "${m[1]}" in this world (/designs lists them)`] };
    };

    const hostiles = () => [...active.values()].filter((s) => s.stats.kind === "hostile" && !s.owner).length;
    const service: SummonService = {
      prepare, register, spawn: spawnOne, hostiles, plan: planText, designs,
      state: (id) => active.get(id)?.state,
      remove: (id) => { const e = api.entities.get(id); if (e) api.entities.remove(e); active.delete(id); },
    };
    api.provide("summons", service);

    /**
     * Cast a summon for `p` (or a ritual led by `p`): plan it, check it fits the caster's tier
     * (or scale it down, saying what it would need), pay for it, and submit it as a world event.
     */
    const cast = (p: Player, text: string, ctx: CastContext): string => {
      const isDesign = DESIGN_REF.test(text.trim());
      // "The power of a wizard" changes the summoner; "ships arrive in waves" is a scenario.
      const powers = api.use<Caster>("caster:powers");
      if (!isDesign && powers?.plan(p, text)) return powers.cast(p, text, ctx);
      const scenarios = api.use<ScenarioService>("scenarios");
      if (!isDesign && scenarios && looksLikeScenario(text)) return scenarios.cast(p, text, ctx);
      // "A village", "a city on the mountainside": epic builds.
      const builds = api.use<Caster>("caster:builds");
      if (!isDesign && builds?.plan(p, text)) return builds.cast(p, text, ctx);
      const plan = planText(text);
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
        if (!DESIGN_REF.test(text.trim()) && looksLikeScenario(text)) return null;
        const plan = planText(text);
        return plan.spec ? { tier: summonTier(plan.spec).tier, title: plan.spec.name } : null;
      },
      cast,
      preview: (_p, text, level) => {
        const plan = planText(text);
        if (!plan.spec) return null;
        const allowed = tierForLevel(level, std), want = summonTier(plan.spec).tier;
        if (want <= allowed) return { tier: want, title: plan.spec.name };
        const s = scaleSummonToTier(plan.spec, allowed);
        return s ? { tier: summonTier(s).tier, title: s.name } : null;
      },
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
      name: "designs",
      usage: "/designs [remove <id>]",
      help: "Designs saved to this world (written in a chat through the MCP server); summon one with /summon design:<id>",
      admin: false,
      run(p, [sub, id]) {
        if (sub === "remove") return designs.remove(id ?? "", p?.name ?? "", p ? p.admin : true) ?? `Removed ${id}`;
        const list = designs.list();
        return list.length ? list.map((d) => `✎ ${d.id}: ${d.name} by ${d.by} (tier ${d.tier}, ${d.temperament}, ${d.length} blocks) · /summon design:${d.id}`).join("\n") : "No designs in this world yet. Link a chat (/link) and design one there.";
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
        // Frozen by a spell (crowd control): it stays put.
        if (Number(e.data.frozenUntil ?? 0) > Date.now()) { e.body.vx = e.body.vz = 0; s.state.flags &= ~(2 | 4); e.flags = e.flags & 1; continue; }
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
