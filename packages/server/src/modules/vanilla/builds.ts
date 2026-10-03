import {
  WORLD_HEIGHT, castCost, generateBuild, levelForTier, looksLikeBuild, planBuild, planSummon, scaleBuildToTier, tierForLevel,
  type BuildSpec, type SummonSpec,
} from "@lfg/shared";
import type { ServerModule } from "../../kernel";
import type { Player } from "../../player";
import type { WorldEventQueue } from "../../worldEvents";
import type { CastContext, Caster, ProgressionService } from "./progression";
import type { SummonService } from "./summons";

interface Build {
  id: string;
  title: string;
  kind: BuildSpec["kind"];
  tier: number;
  by: string;
  casters: string[];
  /** North-west corner and size of the claimed region. */
  x0: number;
  z0: number;
  size: number;
  createdAt: number;
  expiresAt: number;
  adopted: boolean;
  /** Other players who spent time there or voted to keep it. */
  visitors: string[];
  doors: [number, number, number][];
  center: [number, number, number];
  /** What it placed: x, y, z, previous block, placed block (flat), for restoring the land. */
  placed: number[];
  state: "rising" | "standing" | "fading";
  villagers: number;
}

interface Saved {
  builds: Build[];
  /** 8×8 cells where players have placed or broken blocks: builds never go over player work. */
  touched: string[];
  /** Blocks still to restore in chunks that weren't loaded when a build faded: x, y, z, prev, placed. */
  pendingRestore: number[];
}

const CELL = 8;
const PER_TICK = 1500;
const DAY_MS = 24 * 3600 * 1000;

/**
 * Epic builds (docs/standards/progression-and-power.md §5): houses and towers
 * (tiers 2–3), villages and castles (tier 4), whole cities with their people
 * on a mountainside (tier 5). They rise from the ground as a world event,
 * only on land nobody has built on, and fade back into it after a few days
 * unless other players adopt them (by spending time there or /keep).
 */
export const builds: ServerModule = {
  id: "vanilla:builds",
  name: "Builds",
  version: "0.1.0",
  author: "lfg",
  description: "Villages, castles and cities raised as world events; temporary unless adopted.",
  setup(api) {
    const { std, reg, table, world } = api;
    const eb = () => std.progression.epicBuild;
    const saved: Saved = api.storage.load<Saved>("builds") ?? { builds: [], touched: [], pendingRestore: [] };
    const all = saved.builds;
    const touched = new Set(saved.touched);
    let dirty = false;
    const save = () => { dirty = true; };
    api.every(10, () => {
      if (!dirty) return;
      dirty = false;
      saved.touched = [...touched].slice(-200_000);
      api.storage.save("builds", saved);
    });

    const ids = {
      air: 0, grass: reg.blockId("grass"), dirt: reg.blockId("dirt"), stone: reg.blockId("stone"), cobblestone: reg.blockId("cobblestone"), planks: reg.blockId("planks"), log: reg.blockId("log"),
      glass: reg.blockId("glass"), torch: reg.blockId("torch"), stone_bricks: reg.blockId("stone_bricks"), bricks: reg.blockId("bricks"),
      sandstone: reg.blockId("sandstone"), gravel: reg.blockId("gravel"), water: reg.blockId("water"), wool: reg.blockId("wool"), sand: reg.blockId("sand"),
    };
    // Natural ground (not trees, plants or water) for finding the land's shape.
    const notGround = new Set(["log", "leaves", "tall_grass", "dandelion", "poppy", "sapling", "cactus", "snow", "water", "torch"].filter((n) => reg.hasBlock(n)).map((n) => reg.blockId(n)));
    const terrain = {
      ground: (x: number, z: number) => {
        for (let y = WORLD_HEIGHT - 1; y > 0; y--) { const b = world.getBlock(x, y, z); if (b && !notGround.has(b)) return y; }
        return -1;
      },
      top: (x: number, z: number) => { for (let y = WORLD_HEIGHT - 1; y > 0; y--) if (world.getBlock(x, y, z)) return y; return -1; },
      water: (x: number, z: number) => { for (let y = WORLD_HEIGHT - 1; y > 0; y--) { const b = world.getBlock(x, y, z); if (b) return !!table.liquid[b]; } return false; },
    };

    // Player work: columns where players placed or broke blocks (cells of 8×8).
    const touch = (x: number, z: number) => { const k = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`; if (!touched.has(k)) { touched.add(k); save(); } };
    api.on("block:broken", ({ player, x, z }) => { if (player) touch(x, z); });
    api.on("intent:place", ({ player, x, y, z, nx, nz }) => { if (player) touch(x + nx, z + nz); void y; });

    const inside = (b: Build, x: number, z: number, margin = 0) => x >= b.x0 - margin && z >= b.z0 - margin && x < b.x0 + b.size + margin && z < b.z0 + b.size + margin;
    const buildAt = (x: number, z: number) => all.find((b) => b.state !== "fading" && inside(b, x, z));

    /** Find room for a region of `size` near `p`: loaded, unclaimed, nobody's work in it, the right shape of land. */
    const findSpot = (p: Player, spec: BuildSpec): [number, number] | string => {
      const S = spec.size;
      const [spx, , spz] = world.store.meta.spawn;
      const yaw = p.entity.yaw;
      const want: [number, number] = [p.entity.x - Math.sin(yaw) * (S / 2 + 6), p.entity.z - Math.cos(yaw) * (S / 2 + 6)];
      const stepC = S > 40 ? 8 : 4;
      let best: [number, number] | null = null, bestScore = Infinity;
      let why = "there's no loaded land nearby";
      for (let ox = -80; ox <= 80; ox += stepC) for (let oz = -80; oz <= 80; oz += stepC) {
        const x0 = Math.floor(want[0] + ox - S / 2), z0 = Math.floor(want[1] + oz - S / 2);
        const score = Math.hypot(ox, oz);
        if (score >= bestScore) continue;
        let ok = true;
        for (let x = x0; x <= x0 + S && ok; x += 8) for (let z = z0; z <= z0 + S && ok; z += 8) if (!world.isLoaded(Math.min(x, x0 + S - 1), 64, Math.min(z, z0 + S - 1))) ok = false;
        if (!ok) continue;
        // The spawn safe zone and other builds stay as they are.
        const nx = Math.max(x0, Math.min(spx, x0 + S)), nz = Math.max(z0, Math.min(spz, z0 + S));
        if (Math.hypot(nx - spx, nz - spz) < std.summons.safeZoneRadius) { why = "it would overlap the spawn safe zone"; continue; }
        if (all.some((b) => b.state !== "fading" && x0 < b.x0 + b.size + 4 && x0 + S + 4 > b.x0 && z0 < b.z0 + b.size + 4 && z0 + S + 4 > b.z0)) { why = "other builds are in the way"; continue; }
        let mine = false;
        for (let cx = Math.floor(x0 / CELL); cx <= Math.floor((x0 + S - 1) / CELL) && !mine; cx++)
          for (let cz = Math.floor(z0 / CELL); cz <= Math.floor((z0 + S - 1) / CELL) && !mine; cz++) if (touched.has(`${cx},${cz}`)) mine = true;
        if (mine) { why = "players have built everywhere close by (builds never go over player work)"; continue; }
        let water = 0, n = 0, lo = Infinity, hi = -Infinity;
        for (let x = x0; x < x0 + S; x += 4) for (let z = z0; z < z0 + S; z += 4) {
          n++;
          if (terrain.water(x, z)) water++;
          const g = terrain.ground(x, z);
          lo = Math.min(lo, g); hi = Math.max(hi, g);
        }
        if (water / n > 0.2) { why = "it's too wet here"; continue; }
        const range = hi - lo;
        if (spec.mountain ? range < 10 || range > 48 : range > 14) { why = spec.mountain ? "there's no mountainside close by" : "the land is too steep here"; continue; }
        if (hi + 30 >= WORLD_HEIGHT) continue;
        best = [x0, z0];
        bestScore = score;
      }
      return best ?? why;
    };

    // ---------------------------------------------------------------- raising and fading, a little each tick
    const jobs: { build: Build; list: number[]; i: number; restore: boolean; done?: () => void }[] = [];
    api.on("tick", () => {
      const job = jobs[0];
      if (!job) return;
      let n = 0;
      while (job.i < job.list.length && n < PER_TICK) {
        const [x, y, z, a, b] = job.list.slice(job.i, job.i + 5);
        job.i += 5;
        n++;
        if (job.restore) {
          // Only put back what's still ours: anything players changed since stays theirs.
          if (world.getBlock(x, y, z) !== b) continue;
          if (!world.isLoaded(x, y, z)) { saved.pendingRestore.push(x, y, z, a, b); continue; }
          world.setBlock(x, y, z, a);
        } else if (world.setBlock(x, y, z, b)) job.build.placed.push(x, y, z, a, b);
      }
      if (job.i >= job.list.length) {
        jobs.shift();
        unstick(job.build);
        job.done?.();
        save();
      }
    });
    // Nobody ends up inside a wall: lift anyone stuck to the first open space above.
    const unstick = (b: Build) => {
      for (const p of api.players()) {
        const x = Math.floor(p.entity.x), z = Math.floor(p.entity.z);
        if (!inside(b, x, z, 1)) continue;
        let y = Math.floor(p.entity.y);
        while (y < WORLD_HEIGHT - 2 && (table.solid[world.getBlock(x, y, z)] || table.solid[world.getBlock(x, y + 1, z)])) y++;
        if (y !== Math.floor(p.entity.y)) api.teleport(p, p.entity.x, y, p.entity.z);
      }
    };
    api.every(10, () => {
      // Retry restoring blocks in chunks that are loaded again.
      const left: number[] = [];
      for (let i = 0; i < saved.pendingRestore.length; i += 5) {
        const [x, y, z, a, b] = saved.pendingRestore.slice(i, i + 5);
        if (!world.isLoaded(x, y, z)) left.push(x, y, z, a, b);
        else if (world.getBlock(x, y, z) === b) world.setBlock(x, y, z, a);
      }
      if (left.length !== saved.pendingRestore.length) { saved.pendingRestore = left; save(); }
    });

    // ---------------------------------------------------------------- villagers
    const villagerIds = new Map<string, number[]>();
    const spawnVillagers = (b: Build) => {
      const sv = api.use<SummonService>("summons");
      if (!sv || b.villagers <= 0 || b.state !== "standing") return;
      const palette = ["green3", "blue3", "orange2", "violet3", "red2", "yellow3", "teal3"];
      const list: number[] = [];
      for (let i = 0; i < b.villagers; i++) {
        const base = planSummon("a villager").spec!;
        const spec: SummonSpec = { ...base, id: `villager_${i % palette.length}`, name: "Villager", colors: { ...base.colors, main: palette[i % palette.length] }, seed: base.seed + i, count: 1 };
        const prep = sv.prepare(spec);
        if (typeof prep === "string") continue;
        const [x, y, z] = b.doors[i % b.doors.length];
        const e = sv.spawn(spec, prep.stats, x, y, z, { by: b.by, owner: `build:${b.id}` });
        e.data.home = i % b.doors.length;
        list.push(e.id);
      }
      villagerIds.set(b.id, list);
    };
    const removeVillagers = (b: Build) => {
      const sv = api.use<SummonService>("summons");
      for (const id of villagerIds.get(b.id) ?? []) sv?.remove(id);
      villagerIds.delete(b.id);
    };
    // Villagers go about their day: off to another door now and then, home at night.
    api.every(5, () => {
      const sv = api.use<SummonService>("summons");
      if (!sv) return;
      const { time, dayLength } = api.time();
      const f = (time / dayLength) % 1;
      const night = f > 0.54 && f < 0.96;
      for (const b of all) {
        for (const id of villagerIds.get(b.id) ?? []) {
          const st = sv.state(id), e = api.entities.get(id);
          if (!st || !e) continue;
          if (night) { st.goal = b.doors[Number(e.data.home ?? 0) % b.doors.length]; continue; }
          if (!st.goal || api.rand() < 0.15) st.goal = b.doors[Math.floor(api.rand() * b.doors.length)];
          st.home = [...b.center];
        }
      }
    });
    // Builds standing from earlier sessions get their people back.
    let restored = false;
    api.every(2, () => {
      if (restored || !api.players().length) return;
      restored = true;
      for (const b of all) if (b.state === "standing") spawnVillagers(b);
    });

    // ---------------------------------------------------------------- fading, adoption
    const fade = (b: Build, why: string) => {
      if (b.state === "fading") return;
      b.state = "fading";
      removeVillagers(b);
      const list: number[] = [];
      // Top down, so nothing floats while it sinks.
      const order = [...Array(b.placed.length / 5).keys()].sort((i, j) => b.placed[j * 5 + 1] - b.placed[i * 5 + 1]);
      for (const i of order) list.push(...b.placed.slice(i * 5, i * 5 + 5));
      jobs.push({ build: b, list, i: 0, restore: true, done: () => { all.splice(all.indexOf(b), 1); save(); } });
      api.broadcast(`🏚 ${b.title} ${why}`, "event");
      save();
    };
    const threshold = () => Math.max(1, Math.min(eb().adoptPlayers, Math.ceil(eb().adoptShareOfActive * Math.max(1, api.players().length))));
    const adopt = (b: Build) => {
      if (b.adopted || b.visitors.length < threshold()) return;
      b.adopted = true;
      api.broadcast(`🏛 ${b.title} has been adopted by ${b.visitors.join(", ")}: it stays for good.`, "event");
      const owner = api.playerByName(b.by);
      if (owner) api.use<ProgressionService>("progression")?.award(owner, std.progression.xp.adopted, "your build was adopted");
      save();
    };
    const visit = (b: Build, q: Player) => {
      if (b.casters.includes(q.name) || b.visitors.includes(q.name)) return;
      b.visitors.push(q.name);
      api.use<ProgressionService>("progression")?.engaged(b.by, `${b.title}#${b.id}`, q);
      api.tell(q, `You visited ${b.title}: ${b.visitors.length}/${threshold()} visitors to adopt it${b.adopted ? " (already adopted)" : ""}`);
      adopt(b);
      save();
    };
    const timeInside = new Map<string, number>();
    api.every(5, () => {
      const now = Date.now();
      for (const b of all) {
        if (b.state === "standing" && !b.adopted && now > b.expiresAt) { fade(b, "fades back into the land."); continue; }
        if (b.state !== "standing") continue;
        for (const q of api.players()) {
          if (q.dead || !inside(b, q.entity.x, q.entity.z)) continue;
          const k = `${b.id}:${q.name}`;
          const t = (timeInside.get(k) ?? 0) + 5;
          timeInside.set(k, t);
          if (t >= 60) visit(b, q);
        }
      }
    });

    // ---------------------------------------------------------------- casting
    const cast = (p: Player, text: string, ctx: CastContext): string => {
      const planned = planBuild(text, std);
      if (!planned) return `I don't know how to build "${text}" yet`;
      const prog = api.use<ProgressionService>("progression");
      const allowed = prog ? tierForLevel(ctx.level ?? prog.level(p), std) : 5;
      let spec = planned;
      const notes: string[] = [];
      if (planned.tier > allowed) {
        const need = `${planned.title} is tier ${planned.tier}: it needs level ${levelForTier(planned.tier, std)}, or a ritual: /ritual ${text}`;
        const scaled = scaleBuildToTier(planned, allowed, std);
        if (!scaled) return need;
        notes.push(need);
        spec = scaled;
      }
      if (spec.tier >= 5 && all.some((b) => b.tier >= 5 && b.state !== "fading" && !b.adopted)) return "One legendary build at a time: another is standing (it can still be adopted)";
      if (spec.tier >= 5) {
        const last = Number(saved.builds.length ? Math.max(0, ...saved.builds.filter((b) => b.tier >= 5).map((b) => b.createdAt)) : 0);
        const wait = std.progression.legendaryWorldCooldownMinutes * 60_000 - (Date.now() - last);
        if (wait > 0) return `A legendary build was raised recently; the world can have another in ${Math.ceil(wait / 60_000)} min`;
      }
      if (spec.tier >= 4) {
        const today = all.filter((b) => b.by === p.name && b.tier >= 4 && Date.now() - b.createdAt < DAY_MS).length;
        if (today >= 1) return "One epic build per player per day";
      }
      const payers = ctx.payers ?? [p];
      const refund = prog ? prog.pay(payers, spec.tier) : () => {};
      if (typeof refund === "string") return `Can't build ${spec.title}: ${refund}`;
      const queue = api.use<WorldEventQueue>("kernel:events");
      if (!queue) { refund(1); return "World events aren't available"; }
      let build: Build | null = null;
      let list: number[] = [];
      queue.submit({
        title: spec.title,
        by: payers.map((q) => q.name).join(" + "),
        size: spec.tier >= 4 ? "epic" : spec.tier >= 3 ? "major" : "minor",
        detail: [`tier ${spec.tier}`, `${spec.size}×${spec.size} blocks`, spec.villagers ? `${spec.villagers} villagers` : "", ...notes].filter(Boolean).join(" · "),
        check: () => {
          const spot = findSpot(p, spec);
          if (typeof spot === "string") return `no room for ${spec.title}: ${spot}`;
          const [x0, z0] = spot;
          const plan = generateBuild(spec, x0, z0, terrain, ids);
          for (const [k, id] of plan.blocks) {
            const [x, y, z] = k.split(",").map(Number);
            if (y < 1 || y >= WORLD_HEIGHT) continue;
            const prev = world.getBlock(x, y, z);
            if (prev !== id) list.push(x, y, z, prev, id);
          }
          // Bottom up, so it rises from the ground.
          const order = [...Array(list.length / 5).keys()].sort((i, j) => list[i * 5 + 1] - list[j * 5 + 1]);
          const sorted: number[] = [];
          for (const i of order) sorted.push(...list.slice(i * 5, i * 5 + 5));
          list = sorted;
          if (list.length / 5 > 80_000) return "too many blocks for one build";
          const now = Date.now();
          build = {
            id: `${now.toString(36)}${Math.floor(api.rand() * 1e4).toString(36)}`, title: spec.title, kind: spec.kind, tier: spec.tier,
            by: p.name, casters: payers.map((q) => q.name), x0, z0, size: spec.size, createdAt: now, expiresAt: now + eb().lifetimeHours * 3600_000,
            adopted: false, visitors: [], doors: plan.doors, center: plan.center, placed: [], state: "rising", villagers: spec.villagers,
          };
          api.log(`build ${spec.title} at ${x0},${z0}: ${list.length / 5} blocks`);
          return null;
        },
        apply: () => {
          const b = build!;
          all.push(b);
          jobs.push({ build: b, list, i: 0, restore: false, done: () => { b.state = "standing"; spawnVillagers(b); } });
          const dir = (() => {
            const dx = b.center[0] - p.entity.x, dz = b.center[2] - p.entity.z;
            const names = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"];
            return names[(Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) + 8) % 8];
          })();
          api.broadcast(`🏗 ${b.title} rises ${Math.round(Math.hypot(b.center[0] - p.entity.x, b.center[2] - p.entity.z))} blocks ${dir} (${Math.round(b.center[0])}, ${Math.round(b.center[2])}). It stays ${eb().lifetimeHours} h unless ${threshold()} other player${threshold() > 1 ? "s" : ""} adopt it (spend a minute there, or /keep).`, "event");
          save();
        },
        revert: () => {
          const b = build;
          if (!b) return;
          // Undone right after arriving: put the land back at once.
          const i = jobs.findIndex((j) => j.build === b);
          if (i >= 0) jobs.splice(i, 1);
          removeVillagers(b);
          for (let k = b.placed.length - 5; k >= 0; k -= 5) {
            const [x, y, z, a, id] = b.placed.slice(k, k + 5);
            if (world.getBlock(x, y, z) === id) world.setBlock(x, y, z, a);
          }
          if (all.includes(b)) all.splice(all.indexOf(b), 1);
          save();
        },
        onFizzle: () => refund(std.progression.aether.fizzleRefund),
      });
      const cost = castCost(spec.tier, std);
      return [`Building ${spec.title} (tier ${spec.tier}: ${cost.aether} aether${cost.shards ? ` + ${cost.shards} shards` : ""})…`, ...notes].join("\n");
    };
    api.provide("caster:builds", {
      plan: (_p, text) => {
        if (!looksLikeBuild(text)) return null;
        const s = planBuild(text, std);
        return s ? { tier: s.tier, title: s.title } : null;
      },
      cast,
      preview: (_p, text, level) => {
        const sp = planBuild(text, std);
        const s = sp && scaleBuildToTier(sp, tierForLevel(level, std), std);
        return s ? { tier: s.tier, title: s.title } : null;
      },
    } satisfies Caster);

    // ---------------------------------------------------------------- commands
    const describe = (b: Build) => {
      const left = b.adopted ? "adopted: stays for good" : `fades in ${Math.max(0, Math.round((b.expiresAt - Date.now()) / 3600_000))} h unless adopted (${b.visitors.length}/${threshold()} visitors)`;
      return `${b.title} by ${b.casters.join(" + ")} at (${Math.round(b.center[0])}, ${Math.round(b.center[2])}) · ${b.state} · ${left} · id ${b.id}`;
    };
    api.command({
      name: "keep",
      usage: "/keep",
      help: "Vote to keep the build you're standing in",
      admin: false,
      run(p) {
        if (!p) return "Players only";
        const b = buildAt(p.entity.x, p.entity.z);
        if (!b) return "You're not in a build";
        if (b.casters.includes(p.name)) return "Others have to adopt your build";
        if (b.adopted) return `${b.title} is already adopted`;
        visit(b, p);
        return `You voted to keep ${b.title} (${b.visitors.length}/${threshold()})`;
      },
    });
    api.command({
      name: "build",
      usage: "/build list | here | expire <id|here>",
      help: "Epic builds: list them, see the one you're in, or let one fade (its builder or an admin)",
      admin: false,
      run(p, [what, arg]) {
        if (what === "here") {
          const b = p && buildAt(p.entity.x, p.entity.z);
          return b ? describe(b) : "You're not in a build";
        }
        if (what === "expire") {
          const b = arg === "here" || !arg ? (p ? buildAt(p.entity.x, p.entity.z) : undefined) : all.find((x) => x.id === arg);
          if (!b) return "No such build";
          if (p && !p.admin && p.name !== b.by) return "Only its builder or an admin can let it fade";
          if (b.state !== "standing") return `${b.title} is ${b.state}`;
          fade(b, "fades back into the land.");
          return "Fading";
        }
        return all.length ? all.map(describe).join("\n") : "No builds yet. Try /summon a village (tier 4) or /summon a house (tier 2)";
      },
    });
  },
};
