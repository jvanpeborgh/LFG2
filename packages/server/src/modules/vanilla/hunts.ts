import { bossHealth, fitSpecToRules, huntClue, huntSite, looksLikeHunt, planHunt, summonTier, type HuntTrack, type SummonSpec } from "@lfg/shared";
import type { Entity } from "../../entities";
import type { IntentService } from "../../intent";
import type { ServerModule } from "../../kernel";
import type { Player } from "../../player";
import type { ProgressionService } from "./progression";
import type { SummonService } from "./summons";

/**
 * Hunts: /hunt a frost wyrm (or /event hunt down the great boar, or /summon a hunt for a yeti).
 * The quarry, a boss, is let loose far from you and roams. It leaves tracks as it goes, which
 * everyone hunting sees, and the HUD gives a rough bearing and how far (true when you're on its
 * trail). Bring it down before time runs out for its gear (bosses always drop two pieces) and XP
 * for everyone who helped; otherwise it gets away.
 */
interface Hunt {
  id: string; by: string; title: string; quarry: SummonSpec; entity: Entity;
  endsAt: number; tracks: HuntTrack[]; lastTrack: number; wander: number; wobble: Map<string, number>;
  /** Resting before it moves on to the next waypoint (seconds). */
  rest: number;
  hurtBy: Set<string>;
}

const MAX_TRACKS = 90;

export const hunts: ServerModule = {
  id: "vanilla:hunts", name: "Hunts", version: "0.1.0", author: "lfg",
  description: "Hunt a roaming boss by its tracks before it gets away.",
  setup(api) {
    let hunt: Hunt | null = null;
    const summons = () => api.use<SummonService>("summons");
    const prog = () => api.use<ProgressionService>("progression");

    const hud = (h: Hunt | null, p?: Player) => {
      const targets = p ? [p] : api.players();
      for (const q of targets) {
        if (!h) { q.send({ t: "hunt", phase: "over", title: "", clue: "", left: 0, tracks: [] }); continue; }
        const e = h.entity;
        const w = h.wobble.get(q.name) ?? 0;
        const clue = huntClue(q.entity.x, q.entity.z, e.x, e.z, h.tracks, w);
        // Tracks near you (the ones you could see).
        const near = h.tracks.filter((t) => Math.hypot(t.x - q.entity.x, t.z - q.entity.z) < 48).map((t) => [Math.round(t.x * 10) / 10, Math.round(t.y * 10) / 10, Math.round(t.z * 10) / 10, Math.round(t.yaw * 100) / 100] as [number, number, number, number]);
        q.send({ t: "hunt", phase: "on", title: h.title, clue: clue.text, left: Math.max(0, Math.round((h.endsAt - Date.now()) / 1000)), tracks: near });
      }
    };

    const end = (h: Hunt, how: "caught" | "escaped" | "called off", by?: string) => {
      hunt = null;
      if (how === "caught") {
        api.broadcast(`🏹 ${by ?? "Someone"} brought down ${h.title}!`, "event");
        for (const name of h.hurtBy) {
          const q = api.players().find((x) => x.name === name);
          if (q) prog()?.award(q, api.std.progression.xp.bossDefeat, "won a hunt");
        }
        api.worldEvent({ phase: "undo", title: `Hunt: ${h.title}`, by: h.by, detail: `brought down by ${by ?? "the hunters"}` });
      } else {
        if (!h.entity.removed) summons()?.remove(h.entity.id);
        api.broadcast(how === "escaped" ? `🏹 ${h.title} got away. Better luck next time.` : `🏹 The hunt for ${h.title} was called off.`, "event");
        api.worldEvent({ phase: "undo", title: `Hunt: ${h.title}`, by: h.by, detail: how === "escaped" ? "it got away" : "called off" });
      }
      hud(null);
    };

    const start = (p: Player, text: string): string => {
      const plan = planHunt(text);
      return startQuarry(p, summons()?.plan(plan.quarry).spec ?? null, plan.minutes, plan.notes, plan.quarry);
    };
    /** Start a hunt for a creature already planned (by the planner, or the model's reading). */
    const startQuarry = (p: Player, planned: SummonSpec | null, minutes: number, notes: string[], asked: string): string => {
      if (hunt) return `A hunt is on already (${hunt.title}); /hunt stop ends it`;
      const sv = summons();
      if (!sv) return "Nothing can be hunted here";
      const plan = { quarry: asked, minutes: Math.max(3, Math.min(30, Math.round(minutes) || 15)), notes };
      if (!planned || planned.vehicle || planned.body === "ship" || planned.body === "cloud") return `I can't make ${plan.quarry} to hunt. Try a creature: /hunt a frost wyrm`;
      const allowed = prog()?.tier(p) ?? 5;
      const tier = Math.max(1, Math.min(allowed, summonTier({ ...planned, role: "boss" }).tier));
      const spec: SummonSpec = fitSpecToRules({ ...planned, role: "boss", temperament: "hostile", name: planned.name }, api.std, tier).spec;
      const prepared = sv.prepare(spec, tier);
      if (typeof prepared === "string") return `Can't make ${plan.quarry}: ${prepared}`;
      if (prepared.report.errors.length) return `Can't make ${plan.quarry}: ${prepared.report.errors[0]}`;
      // Far away, on loaded land, out of the water (for walkers).
      let site: [number, number, number] | null = null;
      const swims = spec.movement === "swim";
      for (const d of [110, 85, 60, 40]) {
        for (let k = 0; k < 10 && !site; k++) {
          const [x, z] = huntSite(p.entity.x, p.entity.z, d, api.rand() * Math.PI * 2);
          if (!api.world.isLoaded(x, 64, z)) continue;
          const y = api.world.surfaceY(x, z);
          const wet = api.reg.blockById(api.world.getBlock(x, y, z)).name === "water";
          if (wet !== swims && spec.movement !== "fly") continue;
          site = [x + 0.5, y + 1, z + 0.5];
        }
        if (site) break;
      }
      if (!site) return "There's nowhere far enough to let it loose yet (the land isn't loaded)";
      const refund = prog()?.pay([p], tier);
      if (typeof refund === "string") return `Can't start the hunt: ${refund}`;
      const hunters = api.players().length;
      const e = sv.spawn(spec, prepared.stats, site[0], site[1], site[2], { by: p.name, owner: `hunt:${p.name}`, health: bossHealth(prepared.stats.health, hunters) });
      const title = `the ${spec.name}`;
      hunt = { id: `hunt_${Date.now().toString(36)}`, by: p.name, title, quarry: spec, entity: e, endsAt: Date.now() + plan.minutes * 60_000, tracks: [], lastTrack: 0, wander: api.rand() * Math.PI * 2, wobble: new Map(), hurtBy: new Set(), rest: 0 };
      api.worldEvent({ phase: "arrival", title: `Hunt: ${title}`, by: p.name, detail: `tier ${tier} · ${plan.minutes} min · follow its tracks` });
      api.broadcast(`🏹 ${p.name} starts a hunt: ${title} roams somewhere out there. Follow its tracks (${plan.minutes} min).`, "event");
      hud(hunt);
      return `The hunt is on: ${title}${plan.notes.length ? ` (${plan.notes.join("; ")})` : ""}`;
    };

    api.provide("hunts", { start, startQuarry, active: () => hunt?.title ?? null });
    // "/summon a hunt for a yeti" is a hunt (the word hunt is what asks for it). Its tier is the
    // quarry's as a boss (casting scales it to what you can manage).
    const casterPlan = (p: Player, text: string) => {
      if (!looksLikeHunt(text)) return null;
      const quarry = planHunt(text).quarry, spec = summons()?.plan(quarry).spec;
      const tier = spec ? Math.min(prog()?.tier(p) ?? 5, summonTier({ ...spec, role: "boss" }).tier) : 1;
      return { tier: Math.max(1, tier), title: `Hunt: ${quarry}` };
    };
    api.provide("caster:hunts", { plan: casterPlan, cast: (p: Player, text: string) => start(p, text), preview: casterPlan });

    // Who's hurt it (they share the reward).
    api.on("entity:damage", (ev) => {
      if (!hunt || ev.entity !== hunt.entity || ev.cancelled) return;
      const q = ev.source.attacker ? api.playerOf(ev.source.attacker) : undefined;
      if (q) hunt.hurtBy.add(q.name);
    }, 100);
    api.on("entity:death", ({ entity, source }) => {
      if (!hunt || entity !== hunt.entity) return;
      const q = source.attacker ? api.playerOf(source.attacker) : undefined;
      if (q) hunt.hurtBy.add(q.name);
      end(hunt, "caught", q?.name);
    });

    let hudTimer = 0, wobbleTimer = 0;
    api.every(0.25, (dt) => {
      const h = hunt;
      if (!h) return;
      if (h.entity.removed) { end(h, h.entity.health <= 0 ? "caught" : "escaped"); return; }
      if (Date.now() >= h.endsAt) { end(h, "escaped"); return; }
      const e = h.entity;
      // Tracks: a print every couple of blocks it walks (on the ground; flyers and swimmers leave none
      // but feathers or ripples aren't tracks, so they're tracked where they land or surface).
      const last = h.tracks[h.tracks.length - 1];
      if (!last || Math.hypot(e.x - last.x, e.z - last.z) > 2.2) {
        if (e.body.onGround || !last) {
          h.tracks.push({ x: e.x, y: e.y, z: e.z, yaw: e.yaw, t: Date.now() });
          if (h.tracks.length > MAX_TRACKS) h.tracks.shift();
        }
      }
      // It roams: a waypoint about 20 blocks on, then a rest there, then the next (its course
      // bending a little each time, turning back at the edge of the loaded world).
      const st = summons()?.state(e.id);
      if (st && st.target === null) {
        const there = st.goal && Math.hypot(st.goal[0] - e.x, st.goal[2] - e.z) < 3;
        if (there || !st.goal) {
          if (there) { st.goal = null; h.rest = 3 + api.rand() * 5; st.home = [e.x, e.y, e.z]; }
          h.rest -= dt;
          if (h.rest <= 0) {
            for (let k = 0; k < 10; k++) {
              h.wander += (api.rand() - 0.5) * 1.2 + (k ? Math.PI / 3 : 0);
              const nx = e.x + Math.cos(h.wander) * 20, nz = e.z + Math.sin(h.wander) * 20;
              if (!api.world.isLoaded(Math.floor(nx), 64, Math.floor(nz))) continue;
              // Walkers keep to dry land, swimmers to the water (flyers go anywhere).
              const gy = api.world.surfaceY(Math.floor(nx), Math.floor(nz));
              const wet = api.reg.blockById(api.world.getBlock(Math.floor(nx), gy, Math.floor(nz))).name === "water";
              if (h.quarry.movement !== "fly" && wet !== (h.quarry.movement === "swim")) continue;
              st.goal = [nx, gy + 1, nz];
              break;
            }
          }
        }
      }
      wobbleTimer -= dt;
      if (wobbleTimer <= 0) { wobbleTimer = 10; for (const q of api.players()) h.wobble.set(q.name, api.rand() * 2 - 1); }
      hudTimer -= dt;
      if (hudTimer <= 0) { hudTimer = 1; hud(h); }
    });
    api.on("player:join", ({ player }) => { if (hunt) hud(hunt, player); });

    api.command({
      name: "hunt",
      usage: "/hunt <a creature> [for N minutes] | /hunt stop",
      help: "Let a boss loose far away and hunt it by its tracks (e.g. /hunt a frost wyrm)",
      admin: false,
      run(p, args) {
        const text = args.join(" ").trim();
        if (text === "stop") {
          if (!hunt) return "No hunt is on";
          if (p && !p.admin && p.name !== hunt.by) return "Only whoever started it (or an admin) can stop it";
          end(hunt, "called off");
          return "Stopped";
        }
        // For admins and tests: where the quarry is.
        if (text === "where") {
          if (p && !p.admin) return "That would spoil the hunt";
          return hunt ? `${hunt.title} is at ${Math.round(hunt.entity.x)} ${Math.round(hunt.entity.y)} ${Math.round(hunt.entity.z)}` : "No hunt is on";
        }
        if (!p) return "Players only";
        const intent = api.use<IntentService>("intent");
        if (intent && text) { intent.handle(p, `hunt ${text}`, "/hunt", () => start(p, `hunt ${text}`)); return "✧ …"; }
        return start(p, `hunt ${text || "a fearsome beast"}`);
      },
    });
  },
};
