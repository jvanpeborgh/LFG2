import { BOOSTS, RACE_ITEMS, advanceRacer, buildTrack, looksLikeRace, nearestOnTrack, planRace, raceItemFor, standings, type RaceItem, type RacePlan, type RacerProgress, type Track } from "@lfg/shared";
import type { ServerModule } from "../../kernel";
import type { Player } from "../../player";
import type { SummonService } from "./summons";

/**
 * Races: /race (or /event a Mario Kart course, a kart race, 5 laps…). The course is laid on the
 * flattest ground near whoever started it:
 * - a closed loop of road with kerbs, a start gate, checkpoint posts and lanterns;
 * - everyone near gets a kart of their own colour on the grid.
 * Then a countdown, the laps (checkpoints in order), placings, and rewards. Boost pads on the
 * straights speed you up; item boxes give a mushroom, a shell or a star (Q, or /race use, to use it). Fall off or wander off
 * the road and you're put back at your last checkpoint. When it's over the karts go and every
 * block the course changed is put back, even after a restart.
 */
export interface RaceService { running(): boolean; start(p: Player, text: string): string; /** The course being raced, if any. */ track(): Track | null }

interface Racer {
  p: Player; name: string; kart: number | null; progress: RacerProgress; lastCp: number; x: number; z: number;
  /** The item held, a pad's cooldown, and how long a star still protects them. */
  item: RaceItem | null; padCd: number; star: number;
}
interface Race {
  id: string; by: string; plan: RacePlan; track: Track;
  racers: Racer[];
  phase: "building" | "countdown" | "racing" | "finished";
  t: number;
  /** Blocks the course replaced, to put back: [x, y, z, previous id]. */
  changes: [number, number, number, number][];
  firstFinish: number | null;
  /** Item boxes taken, and when each comes back (index into track.boxes → seconds left). */
  taken: Map<number, number>;
}

const COLOURS = ["red", "blue", "green", "yellow", "purple", "orange", "pink", "teal", "white", "black"];
const JOIN_RADIUS = 48;
const REWARDS: [string, number][][] = [[["diamond", 2], ["gold_ingot", 4]], [["gold_ingot", 3], ["iron_ingot", 4]], [["iron_ingot", 4]]];

export const races: ServerModule = {
  id: "vanilla:races", name: "Races", version: "0.1.0", author: "lfg",
  description: "Kart races on a course laid where you are: checkpoints, laps, placings, rewards.",
  setup(api) {
    const { reg } = api;
    let race: Race | null = null;
    const summons = () => api.use<SummonService>("summons");

    // A course left behind by a crash or restart comes down first.
    const pending = api.storage.load<[number, number, number, number][]>("course");
    const restore = (changes: [number, number, number, number][]) => {
      for (let i = changes.length - 1; i >= 0; i--) {
        const [x, y, z, id] = changes[i];
        if (api.world.isLoaded(x, y, z)) api.world.setBlock(x, y, z, id);
      }
    };
    if (pending?.length) { restore(pending); api.storage.save("course", []); }

    const hud = (r: Race, q: Racer, place: number) => q.p.send({
      t: "race", phase: r.phase, title: r.plan.title,
      lap: Math.min(r.plan.laps, Math.max(1, q.progress.lap)), laps: r.plan.laps, place, of: r.racers.length,
      time: r.phase === "racing" || r.phase === "finished" ? (q.progress.finished ?? r.t) : 0,
      countdown: r.phase === "countdown" ? Math.ceil(3 - r.t) : undefined,
      next: (() => { const c = r.track.points[r.track.checkpoints[q.progress.next]]; return [c.x, r.track.y, c.z] as [number, number, number]; })(),
      item: q.item,
      ...(r.phase === "finished" ? { results: standings(r.track, r.racers).map((s) => ({ name: s.name, time: s.progress.finished })) } : {}),
    });

    /** The flattest dry ground near (x, z) for a course this big. */
    const findSite = (x: number, z: number, racers: number): { cx: number; cz: number } | null => {
      let best: { cx: number; cz: number; score: number } | null = null;
      const water = reg.blockId("water");
      for (const d of [0, 24, 40]) for (let a = 0; a < (d ? 8 : 1); a++) {
        const cx = Math.round(x + Math.cos((a / 8) * Math.PI * 2) * d), cz = Math.round(z + Math.sin((a / 8) * Math.PI * 2) * d);
        const r = Math.min(30, 13 + racers * 2.5) * 1.3;
        const hs: number[] = [];
        let wet = 0, ok = true;
        for (let k = 0; k < 24 && ok; k++) for (const f of [0.6, 1]) {
          const px = Math.round(cx + Math.cos((k / 24) * Math.PI * 2) * r * f), pz = Math.round(cz + Math.sin((k / 24) * Math.PI * 2) * r * f);
          if (!api.world.isLoaded(px, 64, pz)) { ok = false; break; }
          const h = api.world.surfaceY(px, pz);
          hs.push(h);
          if (api.world.getBlock(px, h, pz) === water) wet++;
        }
        if (!ok || hs.length === 0) continue;
        const mean = hs.reduce((s, h) => s + h, 0) / hs.length;
        const score = hs.reduce((s, h) => s + (h - mean) ** 2, 0) / hs.length + wet * 30 + d * 0.05;
        if (!best || score < best.score) best = { cx, cz, score };
      }
      return best;
    };

    const end = (r: Race) => {
      for (const q of r.racers) {
        summons()?.dismount(q.p);
        if (q.kart !== null) summons()?.remove(q.kart);
        q.p.send({ t: "race", phase: "over", title: r.plan.title, lap: 0, laps: r.plan.laps, place: 0, of: 0, time: 0 });
      }
      restore(r.changes);
      api.storage.save("course", []);
      race = null;
    };

    const start = (p: Player, text: string): string => {
      if (race) return `A race is already on (${race.plan.title}); /race stop ends it`;
      const plan = planRace(text);
      const near = api.players().filter((q) => !q.dead && Math.hypot(q.entity.x - p.entity.x, q.entity.z - p.entity.z) < JOIN_RADIUS);
      const field = [p, ...near.filter((q) => q !== p)].slice(0, 10);
      const site = findSite(p.entity.x, p.entity.z, field.length);
      if (!site) return "There's no room for a course here (the land isn't loaded around you yet)";
      const ground = (x: number, z: number) => api.world.surfaceY(x, z);
      const track = buildTrack(site.cx, site.cz, field.length, ground, Math.floor(api.rand() * 1e9));
      const id = `race_${Date.now().toString(36)}`;
      const r: Race = { id, by: p.name, plan, track, racers: [], phase: "building", t: 0, changes: [], firstFinish: null, taken: new Map() };
      race = r;
      api.worldEvent({ phase: "gathering", title: plan.title, by: p.name, detail: `${plan.laps} laps · ${field.length} racer${field.length > 1 ? "s" : ""}`, seconds: 3 });
      api.broadcast(`🏁 ${p.name} draws a race course: ${plan.title}, ${plan.laps} laps. Everyone within ${JOIN_RADIUS} blocks gets a kart.`, "event");
      // Lay the course (remembering what was there), then the karts on the grid.
      setTimeout(() => {
        if (race !== r) return;
        for (const [x, y, z, name] of track.blocks) {
          if (!api.world.isLoaded(x, y, z) || y < 1) continue;
          const prev = api.world.getBlock(x, y, z);
          // Never through anything someone keeps things in.
          if (api.world.getBlockEntity(x, y, z) || reg.blockById(prev).container) continue;
          // "clear-leaves": only trees (leaves and logs) give way, for a clear sky over the road.
          if (name === "clear-leaves" && !reg.blockById(prev).tags.some((t) => t === "leaves" || t === "log")) continue;
          const want = name === "air" || name === "clear-leaves" ? 0 : reg.blockId(name);
          if (prev === want) continue;
          r.changes.push([x, y, z, prev]);
          api.world.setBlock(x, y, z, want);
        }
        api.storage.save("course", r.changes);
        const svc = summons();
        field.forEach((q, i) => {
          const g = track.grid[i];
          const racer: Racer = { p: q, name: q.name, kart: null, progress: { lap: 0, next: 0, finished: null, offTrack: 0 }, lastCp: 0, x: g.x, z: g.z, item: null, padCd: 0, star: 0 };
          r.racers.push(racer);
          const planned = svc?.plan(`a ${COLOURS[i % COLOURS.length]} ${plan.vehicle}`).spec;
          const prepared = planned && svc ? svc.prepare(planned, 1) : null;
          if (!svc || !planned || !prepared || typeof prepared === "string") { api.teleport(q, g.x, track.y, g.z); return; }
          const e = svc.spawn(planned, prepared.stats, g.x, track.y, g.z, { by: q.name, owner: `race:${id}`, driver: q.name, yaw: g.yaw });
          racer.kart = e.id;
          const why = svc.mount(q, e.id);
          if (why) api.tell(q, why);
        });
        r.phase = "countdown"; r.t = 0;
        api.worldEvent({ phase: "arrival", title: plan.title, by: r.by, detail: "3… 2… 1…" });
      }, 3000);
      return `Drawing the course for ${plan.title}…${plan.notes.length ? ` (${plan.notes.join("; ")})` : ""}`;
    };
    const boxBlock = () => reg.blockId("item_box");
    /** Use the item a racer holds. */
    const useItem = (r: Race, q: Racer): string => {
      if (r.phase !== "racing" || q.progress.finished !== null) return "Not while the race isn't on";
      const item = q.item;
      if (!item) return "You've no item: drive through a ? box";
      q.item = null;
      if (item === "boost" || item === "star") {
        q.p.send({ t: "kart", effect: "boost", ...BOOSTS[item] });
        if (item === "star") q.star = BOOSTS.star.seconds;
      } else {
        // The shell finds whoever's just ahead (or, if you lead, nobody: it's wasted).
        const order = standings(r.track, r.racers.filter((x) => x.progress.finished === null));
        const target = order[order.indexOf(q) - 1];
        if (!target) return "Nobody's ahead of you: the shell sails off";
        if (target.star > 0) { api.tell(target.p, `⭐ ${q.name}'s shell bounces off you`); return `${target.name}'s star shrugs it off`; }
        target.p.send({ t: "kart", effect: "spin", seconds: BOOSTS.spin.seconds });
        api.tell(target.p, `🐚 ${q.name}'s shell spins you out!`);
        api.sendNear(target.p.entity.x, target.p.entity.y, target.p.entity.z, 32, { t: "entityEvent", id: target.p.entity.id, event: "hurt" });
        return `🐚 Hit ${target.name}!`;
      }
      return `${RACE_ITEMS[item].icon} ${RACE_ITEMS[item].label}!`;
    };
    api.provide("races", { running: () => race !== null, start, track: () => race?.track ?? null } satisfies RaceService);
    // "/summon a mario kart course" (or said aloud) is a race, not one kart. A race is tier 1: it
    // costs little, and everyone who joins plays.
    const isRace = (text: string) => looksLikeRace(text) && /\b(race|races|course|circuit|track|rally|derby|speedway|prix)\b/i.test(text);
    api.provide("caster:races", {
      plan: (_p: Player, text: string) => (isRace(text) ? { tier: 1, title: planRace(text).title } : null),
      cast: (p: Player, text: string) => start(p, text),
      preview: (_p: Player, text: string) => (isRace(text) ? { tier: 1, title: planRace(text).title } : null),
    });

    let hudTimer = 0;
    api.every(0.1, (dt) => {
      const r = race;
      if (!r || r.phase === "building") return;
      r.t += dt;
      r.racers = r.racers.filter((q) => api.players().includes(q.p));
      if (!r.racers.length) { end(r); return; }
      if (r.phase === "countdown" && r.t >= 3) { r.phase = "racing"; r.t = 0; for (const q of r.racers) q.p.send({ t: "chat", kind: "event", text: "GO!" }); }
      if (r.phase === "racing") {
        for (const q of r.racers) {
          if (q.progress.finished !== null) continue;
          const b = q.p.entity;
          q.x = b.x; q.z = b.z;
          const step = advanceRacer(r.track, q.progress, b.x, b.z);
          if (step) q.lastCp = r.track.checkpoints[(q.progress.next - 1 + r.track.checkpoints.length) % r.track.checkpoints.length];
          if (step === "lap" && q.progress.lap > r.plan.laps) {
            q.progress.finished = Math.round(r.t * 10) / 10;
            r.firstFinish ??= r.t;
            const place = standings(r.track, r.racers).indexOf(q) + 1;
            api.broadcast(`🏁 ${q.name} finishes ${place === 1 ? "first" : place === 2 ? "second" : place === 3 ? "third" : `${place}th`} in ${q.progress.finished.toFixed(1)} s`, "event");
          } else if (step === "lap" && q.progress.lap > 1) api.tell(q.p, q.progress.lap === r.plan.laps ? "Final lap!" : `Lap ${q.progress.lap} of ${r.plan.laps}`);
          q.padCd = Math.max(0, q.padCd - dt);
          q.star = Math.max(0, q.star - dt);
          // Boost pads: over a strip (and in your kart), a burst of speed.
          if (q.p.riding && q.padCd <= 0 && Math.abs(b.y - r.track.y) < 1.5 && r.track.pads.some((i) => { const c = r.track.points[i]; return Math.hypot(c.x - b.x, c.z - b.z) < 2.6; })) {
            q.padCd = 1.5;
            q.p.send({ t: "kart", effect: "boost", ...BOOSTS.pad });
          }
          // Item boxes: through one (with empty hands) for an item; it comes back after a while.
          r.track.boxes.forEach((bx, k) => {
            if (r.taken.has(k) || Math.hypot(bx.x - b.x, bx.z - b.z) > 1.3 || Math.abs(b.y - r.track.y) > 1.8) return;
            r.taken.set(k, 6);
            api.world.setBlock(Math.floor(bx.x), r.track.y, Math.floor(bx.z), 0);
            if (q.item) return;
            const order = standings(r.track, r.racers);
            q.item = raceItemFor(order.indexOf(q) + 1, order.length, api.rand());
            api.tell(q.p, `${RACE_ITEMS[q.item].icon} ${RACE_ITEMS[q.item].label}: ${RACE_ITEMS[q.item].help} (Q to use)`);
          });
          // Off the course (fallen, lost, upside down in a lake): back to the last checkpoint.
          // (Only racers in their kart: someone who got out to watch, or flies about in creative, is left be.)
          const off = !!q.p.riding && (nearestOnTrack(r.track, b.x, b.z).distance > r.track.width / 2 + 5 || b.y < r.track.y - 4);
          q.progress.offTrack = off ? q.progress.offTrack + dt : 0;
          if (q.progress.offTrack > 2.5) {
            q.progress.offTrack = 0;
            const c = r.track.points[q.lastCp];
            api.teleport(q.p, c.x, r.track.y + 0.2, c.z);
            api.tell(q.p, "Back on the track");
          }
        }
        for (const [k, left] of r.taken) {
          if (left - dt > 0) { r.taken.set(k, left - dt); continue; }
          r.taken.delete(k);
          const bx = r.track.boxes[k];
          if (api.world.getBlock(Math.floor(bx.x), r.track.y, Math.floor(bx.z)) === 0) api.world.setBlock(Math.floor(bx.x), r.track.y, Math.floor(bx.z), boxBlock());
        }
        const all = r.racers.every((q) => q.progress.finished !== null);
        const late = r.firstFinish !== null && r.t - r.firstFinish > 30;
        if (all || late || r.t > 120 + r.plan.laps * 90) {
          r.phase = "finished"; r.t = 0;
          const order = standings(r.track, r.racers);
          api.broadcast(`🏁 ${r.plan.title} results: ${order.map((q, i) => `${i + 1}. ${q.name}${q.progress.finished !== null ? ` (${q.progress.finished.toFixed(1)} s)` : " (didn't finish)"}`).join("  ")}`, "event");
          order.forEach((q, i) => {
            const prize = q.progress.finished === null ? [] : REWARDS[Math.min(i, REWARDS.length - 1)];
            for (const [item, n] of prize) q.p.give(reg.stack(item, n));
            if (prize.length) api.tell(q.p, `Prize: ${prize.map(([item, n]) => `${n} ${reg.item(item).displayName}`).join(", ")}`);
          });
          api.worldEvent({ phase: "undo", title: r.plan.title, by: r.by, detail: `${order[0].name} wins` });
        }
      }
      if (r.phase === "finished" && r.t > 12) { end(r); return; }
      hudTimer -= dt;
      if (hudTimer <= 0) {
        hudTimer = 0.25;
        const order = standings(r.track, r.racers);
        for (const q of r.racers) hud(r, q, order.indexOf(q) + 1);
      }
    });
    api.on("player:leave", ({ player }) => {
      const q = race?.racers.find((x) => x.p === player);
      if (q?.kart != null) summons()?.remove(q.kart);
    });

    api.command({
      name: "race",
      usage: "/race [what kind] | /race use | /race stop",
      help: "Lay a race course here and race everyone near (e.g. /race a mario kart course, 5 laps)",
      admin: false,
      run(p, args) {
        const text = args.join(" ").trim();
        if (text === "use") {
          const q = race?.racers.find((x) => x.p === p);
          return race && q ? useItem(race, q) : "You're not in a race";
        }
        if (text === "stop") {
          if (!race) return "No race is on";
          if (p && !p.admin && p.name !== race.by) return "Only whoever started it (or an admin) can stop it";
          api.broadcast(`🏁 ${race.plan.title} was called off`, "event");
          end(race);
          return "Stopped";
        }
        if (!p) return "Players only";
        return start(p, text || "a kart race");
      },
    });
  },
};
