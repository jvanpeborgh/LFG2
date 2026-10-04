/**
 * Races: "a Mario Kart course", "a kart race round the lake, 5 laps". The planner reads how many
 * laps and what to race in; the track builder lays a closed loop on the ground near the players:
 * - a road with red and white kerbs, a dashed centre line and lanterns;
 * - a start/finish gate and a grid behind it;
 * - checkpoint posts that must be passed in order, so cutting across doesn't count.
 * Pure data and geometry: the server's race module builds it, runs the race and takes it down.
 */
export interface RacePlan {
  title: string;
  laps: number;
  /** What everyone drives: a vehicle prompt ("kart", "car", "buggy"). */
  vehicle: string;
  notes: string[];
}

const RACE_WORDS = ["race", "races", "racing", "kart", "karts", "course", "circuit", "track", "rally", "derby", "grand", "prix", "speedway"];
const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/** Does this ask for a race (rather than a creature or an invasion)? */
export function looksLikeRace(text: string): boolean {
  const w: string[] = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const has = (x: string) => w.includes(x);
  return has("race") || has("races") || has("racing") || has("rally") || has("derby") || has("speedway") || (has("grand") && has("prix")) || ((has("kart") || has("karts") || has("car") || has("cars")) && (has("course") || has("track") || has("circuit")));
}

export function planRace(text: string): RacePlan {
  const w: string[] = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const notes: string[] = [];
  let laps = 3;
  w.forEach((x, i) => { if (w[i + 1] === "laps" || w[i + 1] === "lap") laps = NUM[x] ?? (Number(x) || laps); });
  if (laps > 10) { notes.push(`${laps} laps is a long race; made it 10`); laps = 10; }
  laps = Math.max(1, laps);
  const vehicle = ["buggy", "buggies", "truck", "trucks", "car", "cars", "motorbike", "motorbikes", "bike", "bikes"].find((v) => w.includes(v))?.replace(/s$/, "").replace(/ie$/, "y") ?? "kart";
  const title = w.includes("mario") || (w.includes("kart") && !w.includes("derby")) ? "Kart Grand Prix" : vehicle === "kart" ? "Kart Race" : `${vehicle[0].toUpperCase()}${vehicle.slice(1)} Race`;
  if (!RACE_WORDS.some((r) => w.includes(r))) notes.push("read as a race");
  return { title, laps, vehicle, notes };
}

export interface TrackPoint { x: number; z: number; /** Heading along the track here (the game's yaw: forward is (-sin, -cos)). */ yaw: number }

export interface Track {
  centre: [number, number];
  /** The road's surface: drive at this height (blocks are laid at y - 1). */
  y: number;
  width: number;
  /** The centre line, about a block apart, in racing order; index 0 is the start/finish line. */
  points: TrackPoint[];
  /** Indices into points, in order; the first is the start/finish line. */
  checkpoints: number[];
  /** Where the karts line up, behind the line, facing the way to go. */
  grid: TrackPoint[];
  /** Blocks to set: [x, y, z, block name] ("air" clears). */
  blocks: [number, number, number, string][];
  /** Length of one lap in blocks. */
  length: number;
  /** Boost pads (centre-line indices): drive over one for a burst of speed. */
  pads: number[];
  /** Item boxes, floating over the road: drive through one for a race item. */
  boxes: { x: number; z: number }[];
}

/** What an item box gives. */
export type RaceItem = "boost" | "shell" | "star";
export const RACE_ITEMS: Record<RaceItem, { label: string; icon: string; help: string }> = {
  boost: { label: "Mushroom", icon: "🍄", help: "a burst of speed" },
  shell: { label: "Shell", icon: "🐚", help: "spins out whoever's just ahead of you" },
  star: { label: "Star", icon: "⭐", help: "a long burst of speed, and shells can't touch you" },
};
/** How strong a boost pad (and each item) is: top speed times power, for this long. */
export const BOOSTS = { pad: { power: 1.45, seconds: 1.2 }, boost: { power: 1.6, seconds: 2 }, star: { power: 1.5, seconds: 5 }, spin: { seconds: 1.2 } };

/**
 * What a box gives you, by where you are: the leader gets mostly shells, those behind get the
 * better things to catch up (place 1 of n is first).
 */
export function raceItemFor(place: number, of: number, roll: number): RaceItem {
  const behind = of > 1 ? (place - 1) / (of - 1) : 0;
  const star = 0.05 + behind * 0.3, boost = 0.35 + behind * 0.2;
  return roll < star ? "star" : roll < star + boost ? "boost" : "shell";
}

/** A small seeded random, so the same race in the same place builds the same track. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}

/** The track's outline: a wobbly loop around (cx, cz) with "radius" r, sampled about a block apart. */
export function trackLoop(cx: number, cz: number, r: number, seed: number): TrackPoint[] {
  const rand = rng(seed);
  const a = rand() * 6.28, b = rand() * 6.28, sx = 1.15 + rand() * 0.3, sz = 0.85 - rand() * 0.15;
  const raw: [number, number][] = [];
  for (let i = 0; i < 720; i++) {
    const t = (i / 720) * Math.PI * 2;
    const rr = r * (1 + 0.16 * Math.sin(2 * t + a) + 0.1 * Math.sin(3 * t + b));
    raw.push([cx + Math.cos(t) * rr * sx, cz + Math.sin(t) * rr * sz]);
  }
  // Resample by distance (about 1 block apart).
  const pts: TrackPoint[] = [];
  let carry = 0;
  for (let i = 0; i < raw.length; i++) {
    const [x0, z0] = raw[i], [x1, z1] = raw[(i + 1) % raw.length];
    const d = Math.hypot(x1 - x0, z1 - z0);
    let t = carry;
    while (t < d) {
      const x = x0 + ((x1 - x0) * t) / d, z = z0 + ((z1 - z0) * t) / d;
      pts.push({ x, z, yaw: Math.atan2(-(x1 - x0), -(z1 - z0)) });
      t += 1;
    }
    carry = t - d;
  }
  return pts;
}

/**
 * Lay out a track around (cx, cz): the loop, flattened at one height (filled in below where the
 * ground dips, cleared above where it rises), with kerbs, a start gate, checkpoint posts, lanterns
 * and a grid for `racers`.
 */
export function buildTrack(cx: number, cz: number, racers: number, groundY: (x: number, z: number) => number, seed: number): Track {
  const r = Math.min(30, 13 + racers * 2.5);
  const width = 7;
  const points = trackLoop(cx, cz, r, seed);
  const n = points.length;
  // One height for the whole road: the middle of the ground under it.
  const heights = points.map((p) => groundY(Math.floor(p.x), Math.floor(p.z))).sort((p, q) => p - q);
  const y = heights[Math.floor(heights.length / 2)] + 1;
  // Which cells are road and kerb: distance to the nearest centre point.
  const minX = Math.floor(Math.min(...points.map((p) => p.x)) - width), maxX = Math.ceil(Math.max(...points.map((p) => p.x)) + width);
  const minZ = Math.floor(Math.min(...points.map((p) => p.z)) - width), maxZ = Math.ceil(Math.max(...points.map((p) => p.z)) + width);
  const blocks: Track["blocks"] = [];
  const half = width / 2;
  for (let z = minZ; z <= maxZ; z++)
    for (let x = minX; x <= maxX; x++) {
      let best = Infinity, bi = 0;
      for (let i = 0; i < n; i += 1) {
        const d = (points[i].x - (x + 0.5)) ** 2 + (points[i].z - (z + 0.5)) ** 2;
        if (d < best) { best = d; bi = i; }
      }
      const d = Math.sqrt(best);
      if (d > half + 1) continue;
      const kerb = d > half;
      // The surface: road, kerb (red and white in stripes), the dashed centre line, the start line.
      const block = kerb ? (Math.floor(bi / 2) % 2 ? "bricks" : "wool")
        : bi < 2 || bi > n - 2 ? (((x + z) & 1) ? "wool" : "cobblestone")
        : d < 0.5 && Math.floor(bi / 3) % 2 === 0 ? "wool" : "stone";
      blocks.push([x, y - 1, z, block]);
      // Ground below, filled in (up to a few blocks: deeper, it's a bridge); headroom above.
      for (let k = 2; k <= 6; k++) if (groundY(x, z) <= y - k) blocks.push([x, y - k, z, "dirt"]);
      for (let k = 0; k < 4; k++) blocks.push([x, y + k, z, "air"]);
      // Trees over the road go too (a canopy higher up: "clear-leaves" only takes leaves and logs).
      for (let k = 4; k < 10; k++) blocks.push([x, y + k, z, "clear-leaves"]);
    }
  // Posts beside the road at a point, and an arch over it for the start/finish gate.
  const side = (i: number, s: number, out: number): [number, number] => {
    const p = points[i], rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw); // the right of the way ahead
    return [Math.floor(p.x + rx * s * out), Math.floor(p.z + rz * s * out)];
  };
  const post = (i: number, h: number, top: string, base = "stone_bricks") => {
    for (const s of [-1, 1]) {
      const [x, z] = side(i, s, half + 1.6);
      for (let k = 0; k < h; k++) blocks.push([x, y + k, z, base]);
      blocks.push([x, y + h, z, top]);
    }
  };
  // Start/finish: a tall arch, lanterns on top, a beam across.
  post(0, 5, "lantern");
  {
    const [x0, z0] = side(0, -1, half + 1.6), [x1, z1] = side(0, 1, half + 1.6);
    const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0));
    for (let s = 0; s <= steps; s++) blocks.push([Math.round(x0 + ((x1 - x0) * s) / steps), y + 5, Math.round(z0 + ((z1 - z0) * s) / steps), (s & 1) ? "wool" : "stone_bricks"]);
  }
  // Checkpoints, about every 18 blocks (at least 5), each marked by lantern posts.
  const count = Math.max(5, Math.round(n / 18));
  const checkpoints = Array.from({ length: count }, (_, k) => Math.floor((k * n) / count));
  for (const c of checkpoints.slice(1)) post(c, 2, "frost_lamp", "log");
  // Lanterns along the outside between checkpoints.
  for (let i = 9; i < n; i += 12) if (!checkpoints.some((c) => Math.abs(c - i) < 3)) {
    const [x, z] = side(i, 1, half + 2.2);
    blocks.push([x, y, z, "log"], [x, y + 1, z, "lantern"]);
  }
  // Boost pads: glowing strips across the road on the straighter parts (not at the start).
  const pads: number[] = [];
  const bend = (i: number) => Math.abs(Math.atan2(Math.sin(points[(i + 6) % n].yaw - points[(i - 6 + n) % n].yaw), Math.cos(points[(i + 6) % n].yaw - points[(i - 6 + n) % n].yaw)));
  for (let k = 1; k <= 3; k++) {
    let best = -1, bestBend = Infinity;
    for (let i = Math.floor(((k - 0.35) * n) / 3.4); i < Math.floor(((k + 0.35) * n) / 3.4); i++) if (i > 12 && i < n - 12 && bend(i) < bestBend) { bestBend = bend(i); best = i; }
    if (best >= 0) pads.push(best);
  }
  for (const i of pads) for (let j = i - 1; j <= i + 1; j++) {
    const p = points[(j + n) % n];
    for (let s = -2; s <= 2; s++) blocks.push([Math.floor(p.x + Math.cos(p.yaw) * s), y - 1, Math.floor(p.z - Math.sin(p.yaw) * s), "neon_yellow"]);
  }
  // Item boxes: a row across the road, halfway between checkpoints.
  const boxes: { x: number; z: number }[] = [];
  for (let c = 1; c < checkpoints.length; c += 2) {
    const i = Math.floor((checkpoints[c] + (checkpoints[c + 1] ?? n)) / 2) % n;
    if (pads.some((q) => Math.abs(q - i) < 6)) continue;
    const p = points[i];
    for (const s of [-2, 0, 2]) {
      const x = Math.floor(p.x + Math.cos(p.yaw) * s), z = Math.floor(p.z - Math.sin(p.yaw) * s);
      boxes.push({ x: x + 0.5, z: z + 0.5 });
      blocks.push([x, y, z, "item_box"]);
    }
  }
  // The grid: two by two behind the line.
  const grid: TrackPoint[] = [];
  for (let k = 0; k < racers; k++) {
    const i = (n - 4 - Math.floor(k / 2) * 4 + n) % n;
    const s = k % 2 ? 1 : -1;
    const p = points[i];
    grid.push({ x: p.x + Math.cos(p.yaw) * s * 1.6, z: p.z - Math.sin(p.yaw) * s * 1.6, yaw: p.yaw });
  }
  return { centre: [cx, cz], y, width, points, checkpoints, grid, blocks, length: n, pads, boxes };
}

/** Index of the nearest centre-line point (and how far off the road's middle you are). */
export function nearestOnTrack(track: Track, x: number, z: number): { index: number; distance: number } {
  let best = Infinity, index = 0;
  for (let i = 0; i < track.points.length; i++) {
    const p = track.points[i], d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < best) { best = d; index = i; }
  }
  return { index, distance: Math.sqrt(best) };
}

/** A racer's progress: laps done, the next checkpoint (index into track.checkpoints) and their time. */
export interface RacerProgress { lap: number; next: number; finished: number | null; offTrack: number }

/**
 * Move a racer on: they reach the next checkpoint when they're within the road's width of it; the
 * start line (checkpoint 0) completes a lap once all the others are passed in order.
 */
export function advanceRacer(track: Track, r: RacerProgress, x: number, z: number): "checkpoint" | "lap" | null {
  const cp = track.points[track.checkpoints[r.next]];
  if (Math.hypot(cp.x - x, cp.z - z) > track.width * 0.5 + 2) return null;
  r.next = (r.next + 1) % track.checkpoints.length;
  if (r.next === 1) { r.lap++; return "lap"; }
  return "checkpoint";
}

/** Order racers: finished first (by time), then by laps, checkpoints and how close to the next one. */
export function standings<T extends { progress: RacerProgress; x: number; z: number }>(track: Track, racers: T[]): T[] {
  const score = (r: T) => {
    if (r.progress.finished !== null) return 1e9 - r.progress.finished;
    // Checkpoints passed this lap: the start counts as one; "next is 0" means all done, the line ahead.
    const passed = r.progress.next === 0 ? track.checkpoints.length : r.progress.next;
    const cp = track.points[track.checkpoints[r.progress.next]];
    return r.progress.lap * 1e6 + passed * 1e3 - Math.hypot(cp.x - r.x, cp.z - r.z);
  };
  return [...racers].sort((a, b) => score(b) - score(a));
}
