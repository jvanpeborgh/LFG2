import { ARCS, craterBlocks, happeningValue, isBuiltBlock, isNightAt, meteorPath, planArc, type ArcDef, type ArcKind, type RuleValue } from "@lfg/shared";
import type { IntentService } from "../../intent";
import type { ServerModule } from "../../kernel";
import type { Player } from "../../player";
import type { ProgressionService } from "./progression";
import type { SummonService } from "./summons";

/**
 * Arcs: world events over several in-game days (shared arcs.ts): a blood moon week, a meteor
 * shower, a harvest festival. /arc a blood moon week (or /event a meteor shower, 2 nights).
 *
 * They change the world for days, so only an admin (the world's owner) starts one, or someone
 * playing alone. The arc is kept in the world's storage: it carries on after a restart, counting
 * dawns until it's done. Night rules are put back each dawn and when it ends; what it built (the
 * festival's lanterns) is taken down. Meteor craters stay, to be mined.
 */
interface ArcState {
  id: ArcKind; title: string; by: string; days: number;
  /** Dawns seen so far (the arc ends when it reaches days). */
  dawns: number;
  night: boolean;
  /** Rules changed for the night, to put back at dawn: [path, value before]. */
  saved: [string, RuleValue][];
  /** Blocks it placed (festival lanterns), to take down: [x, y, z, previous id]. */
  changes: [number, number, number, number][];
  /** The last night's boss (blood moon), once spawned. */
  boss?: number | null;
}
interface Rules { get(path: string): RuleValue | undefined; set(path: string, value: RuleValue): void }

const FIREWORK_COLOURS = ["#ff5a5a", "#ffd34d", "#5ad1ff", "#9b6bff", "#6bff8f", "#ff8bd1"];
const FOODS = ["apple", "cooked_porkchop", "cooked_chicken", "steak"];

export const arcs: ServerModule = {
  id: "vanilla:arcs", name: "Arcs", version: "0.1.0", author: "lfg",
  description: "World events over several days: blood moon week, meteor shower, harvest festival.",
  setup(api) {
    const { reg } = api;
    const rules = () => api.use<Rules>("rules");
    let arc = api.storage.load<ArcState>("arc") ?? null;
    let meteorTimer = 10, fireworkTimer = 0;
    const pending: { x: number; y: number; z: number; left: number }[] = [];
    const save = () => api.storage.save("arc", arc);
    const def = (a: ArcState): ArcDef => ARCS.find((d) => d.id === a.id)!;

    const hud = (p?: Player) => {
      const msg = arc
        ? { t: "arc" as const, title: arc.title, day: Math.min(arc.days, arc.dawns + 1), days: arc.days, detail: def(arc).description, sky: arc.id === "blood_moon" && arc.night ? "blood" as const : null }
        : { t: "arc" as const, title: "", day: 0, days: 0, detail: "", sky: null };
      if (p) p.send(msg); else for (const q of api.players()) q.send(msg);
    };

    const restoreRules = (a: ArcState) => {
      const r = rules();
      if (r) for (const [path, value] of [...a.saved].reverse()) r.set(path, value);
      a.saved = [];
    };
    const end = (why: string) => {
      const a = arc;
      if (!a) return;
      restoreRules(a);
      for (let i = a.changes.length - 1; i >= 0; i--) {
        const [x, y, z, id] = a.changes[i];
        if (api.world.isLoaded(x, y, z)) api.world.setBlock(x, y, z, id);
      }
      if (a.boss != null) api.use<SummonService>("summons")?.remove(a.boss);
      arc = null;
      save();
      api.broadcast(`☾ ${a.title} is over${why ? ` (${why})` : ""}`, "event");
      api.worldEvent({ phase: "undo", title: a.title, by: a.by, detail: why || "the world is back to normal" });
      hud();
    };

    /** The festival's lanterns: a ring of posts around the world's spawn. */
    const decorate = (a: ArcState) => {
      const [sx, , sz] = api.world.store.meta.spawn;
      const lamps = ["lantern", "neon_pink", "neon_yellow", "neon_blue", "neon_green"];
      for (let k = 0; k < 12; k++) {
        const ang = (k / 12) * Math.PI * 2;
        const x = Math.floor(sx + Math.cos(ang) * 9), z = Math.floor(sz + Math.sin(ang) * 9);
        if (!api.world.isLoaded(x, 64, z)) continue;
        const y = api.world.surfaceY(x, z) + 1;
        const cells: [number, number, number, string][] = [[x, y, z, "log"], [x, y + 1, z, "log"], [x, y + 2, z, lamps[k % lamps.length]]];
        if (cells.some(([cx, cy, cz]) => api.world.getBlock(cx, cy, cz) !== 0)) continue;
        for (const [cx, cy, cz, name] of cells) { a.changes.push([cx, cy, cz, 0]); api.world.setBlock(cx, cy, cz, reg.blockId(name)); }
      }
    };

    const start = (p: Player | null, text: string): string => {
      const plan = planArc(text);
      if (!plan) return `I don't know that one. Try: ${ARCS.map((a) => a.title.toLowerCase()).join(", ")}`;
      return startDef(p, plan.def, plan.days, plan.notes);
    };
    /** Start an arc already planned (by the planner, or the model's reading). */
    const startDef = (p: Player | null, def: ArcDef, days: number, notes: string[] = []): string => {
      const plan = { def, days, notes };
      if (arc) return `${arc.title} is on (day ${Math.min(arc.days, arc.dawns + 1)} of ${arc.days}); /arc stop ends it`;
      if (p && !p.admin && api.players().length > 1) return "An arc changes the world for days: only the world's owner (an admin) can start one, or someone playing alone";
      const a: ArcState = { id: plan.def.id, title: plan.def.title, by: p?.name ?? "the world", days: plan.days, dawns: 0, night: false, saved: [], changes: [] };
      arc = a;
      if (a.id === "festival") decorate(a);
      save();
      api.worldEvent({ phase: "arrival", title: a.title, by: a.by, detail: `${plan.def.description} · ${a.days} day${a.days > 1 ? "s" : ""}` });
      hud();
      return `${a.title} for ${a.days} day${a.days > 1 ? "s" : ""}${plan.notes.length ? ` (${plan.notes.join("; ")})` : ""}`;
    };
    api.provide("arcs", { start, startDef, active: () => arc?.title ?? null });

    // Nightfall: the night's rules (and, the last night of a blood moon, its boss).
    const nightfall = (a: ArcState) => {
      a.night = true;
      const r = rules();
      for (const [path, v] of def(a).nightRules) {
        const before = r?.get(path);
        if (typeof before !== "number") continue;
        a.saved.push([path, before]);
        r!.set(path, happeningValue(before, v));
      }
      if (a.id === "blood_moon") {
        const last = a.dawns === a.days - 1;
        api.broadcast(last ? "☾ The last blood moon rises. Something is coming." : "☾ The moon rises red. Stay close to the light.", "event");
        if (last) spawnBoss(a);
      }
      if (a.id === "meteors") api.broadcast("☄ Look up: the meteor shower begins.", "event");
      save();
      hud();
    };
    const dawn = (a: ArcState) => {
      a.night = false;
      restoreRules(a);
      a.dawns++;
      const prog = api.use<ProgressionService>("progression");
      for (const q of api.players()) {
        if (q.dead) continue;
        if (a.id === "blood_moon") prog?.awardShards(q, 1, "survived the blood moon");
        else if (a.id === "meteors") prog?.award(q, 20, "watched the meteor shower");
        else for (let k = 0; k < 3; k++) q.give(reg.stack(FOODS[Math.floor(api.rand() * FOODS.length)], 2));
      }
      if (a.id === "festival") api.broadcast("✿ Good morning! A basket of food for everyone.", "event");
      if (a.dawns >= a.days) { end(""); return; }
      save();
      hud();
    };

    const spawnBoss = (a: ArcState) => {
      const sv = api.use<SummonService>("summons");
      const players = api.players().filter((q) => !q.dead);
      if (!sv || !players.length) return;
      const target = players[Math.floor(api.rand() * players.length)];
      const spec = sv.plan("a huge blood red wraith").spec;
      if (!spec) return;
      const boss = { ...spec, name: "Blood Moon Wraith", role: "boss" as const, temperament: "hostile" as const };
      const prepared = sv.prepare(boss, 3);
      if (typeof prepared === "string") return;
      const ang = api.rand() * Math.PI * 2;
      const x = target.entity.x + Math.cos(ang) * 18, z = target.entity.z + Math.sin(ang) * 18;
      if (!api.world.isLoaded(Math.floor(x), 64, Math.floor(z))) return;
      const e = sv.spawn(boss, prepared.stats, x, api.world.surfaceY(Math.floor(x), Math.floor(z)) + 1, z, { by: a.by, owner: "arc:blood_moon" });
      a.boss = e.id;
    };

    /** A meteor: it streaks down for everyone near, then lands in a crater of crystal and iron. */
    const meteor = () => {
      const players = api.players().filter((q) => !q.dead);
      if (!players.length) return;
      const p = players[Math.floor(api.rand() * players.length)];
      const ang = api.rand() * Math.PI * 2, d = 25 + api.rand() * 30;
      const x = Math.floor(p.entity.x + Math.cos(ang) * d), z = Math.floor(p.entity.z + Math.sin(ang) * d);
      if (!api.world.isLoaded(x, 64, z)) return;
      const y = api.world.surfaceY(x, z);
      const [sx, , sz] = api.world.store.meta.spawn;
      if (Math.hypot(x - sx, z - sz) < api.std.summons.safeZoneRadius) return;
      // Never on anything built (or anyone's chests), and not in water.
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) for (let dy = -2; dy <= 3; dy++) {
        const b = reg.blockById(api.world.getBlock(x + dx, y + dy, z + dz));
        if (b.name === "water" || b.container || api.world.getBlockEntity(x + dx, y + dy, z + dz) || (b.name !== "air" && isBuiltBlock(b.name, b.tags))) return;
      }
      const path = meteorPath(x + 0.5, y + 1, z + 0.5, api.rand() * Math.PI * 2);
      api.sendNear(x, y, z, 160, { t: "meteor", from: path.from, to: path.to, seconds: 3 });
      pending.push({ x, y, z, left: 3 });
    };
    const impact = (m: { x: number; y: number; z: number }) => {
      for (const [dx, dy, dz, name] of craterBlocks(2 + Math.floor(api.rand() * 2), api.rand)) {
        const bx = m.x + dx, by = m.y + dy, bz = m.z + dz;
        if (!api.world.isLoaded(bx, by, bz) || by < 2) continue;
        if (api.world.getBlockEntity(bx, by, bz) || reg.blockById(api.world.getBlock(bx, by, bz)).container) continue;
        api.world.setBlock(bx, by, bz, name === "air" ? 0 : reg.blockId(name));
      }
      api.sendNear(m.x, m.y, m.z, 96, { t: "explosion", x: m.x + 0.5, y: m.y + 0.5, z: m.z + 0.5, radius: 3 });
      api.sendNear(m.x, m.y, m.z, 96, { t: "particles", x: m.x, y: m.y + 1, z: m.z, color: "#b98cff", count: 24 });
      for (const e of api.entities.near(m.x + 0.5, m.y, m.z + 0.5, 4, () => true)) api.damage(e, 8, { kind: "explosion" });
      api.broadcast(`☄ A meteor lands ${Math.round(m.x)} ${Math.round(m.z)}: crystal in the crater!`, "event");
    };

    api.every(0.5, (dt) => {
      for (let i = pending.length - 1; i >= 0; i--) {
        pending[i].left -= dt;
        if (pending[i].left <= 0) { impact(pending[i]); pending.splice(i, 1); }
      }
      const a = arc;
      if (!a) return;
      const { time, dayLength } = api.time();
      const night = isNightAt(time, dayLength);
      if (night && !a.night) nightfall(a);
      else if (!night && a.night) { dawn(a); if (!arc) return; }
      if (a.boss != null && !api.entities.get(a.boss)) { api.broadcast("☾ The Blood Moon Wraith is beaten!", "event"); a.boss = null; save(); }
      if (!a.night) return;
      if (a.id === "meteors") {
        meteorTimer -= dt;
        if (meteorTimer <= 0) { meteorTimer = 18 + api.rand() * 24; meteor(); }
      }
      if (a.id === "festival") {
        fireworkTimer -= dt;
        if (fireworkTimer <= 0) {
          fireworkTimer = 1.5 + api.rand() * 2;
          const [sx, sy, sz] = api.world.store.meta.spawn;
          const fx = sx + (api.rand() - 0.5) * 24, fz = sz + (api.rand() - 0.5) * 24, fy = sy + 18 + api.rand() * 12;
          api.sendNear(fx, fy, fz, 160, { t: "firework", x: fx, y: fy, z: fz, color: FIREWORK_COLOURS[Math.floor(api.rand() * FIREWORK_COLOURS.length)] });
        }
      }
    });
    api.on("player:join", ({ player }) => hud(player));

    api.command({
      name: "arc",
      usage: "/arc <a blood moon week | a meteor shower | a harvest festival> [for N days] | /arc stop | /arc list",
      help: "Start a world event that lasts days (admins, or alone): blood moon, meteor shower, festival",
      admin: false,
      run(p, args) {
        const text = args.join(" ").trim();
        if (!text || text === "list") return ARCS.map((d) => `${d.title}: ${d.description} (${d.days} days)`).join("\n") + (arc ? `\nNow: ${arc.title}, day ${Math.min(arc.days, arc.dawns + 1)} of ${arc.days}` : "");
        if (text === "stop") {
          if (!arc) return "No arc is on";
          if (p && !p.admin && p.name !== arc.by) return "Only whoever started it (or an admin) can stop it";
          end(`called off by ${p?.name ?? "the console"}`);
          return "Stopped";
        }
        const intent = api.use<IntentService>("intent");
        if (intent && p) { intent.handle(p, text, "/arc (a world event over days)", () => start(p, text)); return "✧ …"; }
        return start(p, text);
      },
    });
  },
};
