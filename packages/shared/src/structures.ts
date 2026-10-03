/**
 * Structures: buildings written by an agent (or a person) in the shape language, in blocks.
 *
 * A structure is primitives (box, cylinder, cone, wedge, tube…) placed in block units around the
 * ground at its centre (y = 0 is the first block above ground), each made of a block. `hollow`
 * makes rooms (a one-block shell, or `wall` thick), `cut` carves doors and windows, and later
 * primitives replace earlier ones. Under it, a foundation fills down to the land. It's raised like
 * any epic build: from the ground up, as a world event, temporary unless other players adopt it,
 * and never over player work.
 */
import type { Standards } from "./standards";
import { distanceTo, type SdfPrim } from "./summons/sculpt";
import type { ShapeIssue } from "./summons/shape";
import { VoxelGrid, type VoxelModel } from "./summons/voxel";

type Vec3 = [number, number, number];
export type StructurePrimitiveType = "box" | "cylinder" | "cone" | "wedge" | "ellipsoid" | "capsule" | "torus" | "tube";

export interface StructurePrimitive {
  type: StructurePrimitiveType;
  /** Centre, in blocks (x, z from the structure's centre; y from the ground). Not used by tubes. */
  at?: Vec3;
  /** Full size in blocks. Not used by tubes. */
  size?: Vec3;
  rotate?: Vec3;
  axis?: "x" | "y" | "z";
  /** Tubes: the path in blocks, and the radius (or [start, end]). Arches, pipes, branches. */
  points?: Vec3[];
  radius?: number | [number, number];
  /** What it's made of: a block name (planks, log, stone_bricks, bricks, sandstone, glass, wool, cobblestone, stone, torch…). */
  block?: string;
  /** Only the outside (rooms): `true` for a one-block shell, or the wall thickness. */
  hollow?: boolean | number;
  /** Carve this out (doors, windows, archways). */
  cut?: boolean;
  /** `count` copies, each moved by `offset` (blocks): pillars, windows, battlements. */
  repeat?: { count: number; offset: Vec3 };
  /** Also add a copy mirrored across x = 0. */
  mirror?: boolean;
}

export interface StructureInput {
  id?: string;
  title: string;
  description?: string;
  primitives: StructurePrimitive[];
  /** What the foundation under it is made of (default cobblestone). */
  foundation?: string;
}

export interface StructureRaster {
  /** Block name at each position, relative to the centre on the ground ("air" carves). */
  blocks: Map<string, string>;
  min: Vec3;
  max: Vec3;
  /** Side of the square it claims, in blocks. */
  footprint: number;
  tier: number;
  foundation: string;
}

export const STRUCTURE_LIMITS = { primitives: 200, side: 40, height: 48, blocks: 40_000 };
/** Blocks a structure may be made of. */
export const STRUCTURE_BLOCKS = ["planks", "log", "stone", "cobblestone", "stone_bricks", "bricks", "sandstone", "glass", "wool", "torch", "dirt", "grass", "gravel", "sand", "leaves", "air"];
const STRUCTURE_ID = /^[a-z0-9][a-z0-9_-]{1,31}$/;

export function structureId(input: StructureInput): string {
  return input.id ?? String(input.title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 32);
}

/** Its tier from how much ground it claims (a hut or house is 2, a tower 3, a hall 4, a palace 5). */
export function structureTier(footprint: number, height: number): number {
  const s = Math.max(footprint, height * 0.6);
  return s <= 12 ? 2 : s <= 18 ? 3 : s <= 30 ? 4 : 5;
}

function rotation(deg: Vec3 | undefined): number[] {
  const [a, b, c] = (deg ?? [0, 0, 0]).map((d) => (d * Math.PI) / 180);
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
  return [cc * cb, cc * sb * sa - sc * ca, cc * sb * ca + sc * sa, sc * cb, sc * sb * sa + cc * ca, sc * sb * ca - cc * sa, -sb, cb * sa, cb * ca];
}

/** Check a structure and turn it into blocks. `isBlock` says which block names exist in this world. */
export function buildStructure(input: unknown, isBlock: (name: string) => boolean = (n) => STRUCTURE_BLOCKS.includes(n)): { raster?: StructureRaster; issues: ShapeIssue[] } {
  const issues: ShapeIssue[] = [];
  const err = (path: string, message: string, hint: string) => issues.push({ path, level: "error", message, hint });
  const warn = (path: string, message: string, hint: string) => issues.push({ path, level: "warning", message, hint });
  const s = input as StructureInput;
  const isVec = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));
  if (!s || typeof s !== "object") { err("", "a structure is a JSON object", '{ "title": "...", "primitives": [ ... ] }'); return { issues }; }
  if (JSON.stringify(s).length > 64_000) { err("", "the structure is too large", "use repeat for rows instead of listing every piece"); return { issues }; }
  if (typeof s.title !== "string" || !s.title.trim() || s.title.length > 40) err("title", "needs a title (1–40 characters)", 'e.g. "Lantern Watchtower"');
  if (!STRUCTURE_ID.test(typeof s.title === "string" || s.id ? structureId(s) : "")) err("id", "id isn't usable", "2–32 lowercase letters, numbers, _ or -");
  if (!Array.isArray(s.primitives) || !s.primitives.length) { err("primitives", "no primitives", "start with a floor, walls (a hollow box) and a roof"); return { issues }; }
  const foundation = s.foundation ?? "cobblestone";
  if (!isBlock(foundation)) err("foundation", `no block called "${foundation}"`, `use one of ${STRUCTURE_BLOCKS.join(", ")}`);
  // Expand repeats and mirrors.
  const prims: { q: StructurePrimitive; path: string }[] = [];
  s.primitives.forEach((q, i) => {
    const path = `primitives[${i}]`;
    if (!q || typeof q !== "object") { err(path, "not a primitive", "{ type, at, size, block, hollow?, cut? }"); return; }
    const n = q.repeat ? q.repeat.count : 1;
    if (q.repeat && (!Number.isInteger(q.repeat.count) || q.repeat.count < 1 || q.repeat.count > 64 || !isVec(q.repeat.offset))) { err(`${path}.repeat`, "repeat needs count (1–64) and offset [x,y,z]", '{ "count": 4, "offset": [4, 0, 0] } for a row of pillars'); return; }
    for (let r = 0; r < n; r++) {
      const d = q.repeat ? q.repeat.offset.map((o) => o * r) as Vec3 : [0, 0, 0] as Vec3;
      const moved: StructurePrimitive = { ...q, repeat: undefined, at: q.at ? [q.at[0] + d[0], q.at[1] + d[1], q.at[2] + d[2]] : q.at, points: q.points?.map((p) => [p[0] + d[0], p[1] + d[1], p[2] + d[2]] as Vec3) };
      prims.push({ q: moved, path });
      if (q.mirror) prims.push({ q: { ...moved, at: moved.at ? [-moved.at[0], moved.at[1], moved.at[2]] : moved.at, rotate: moved.rotate ? [moved.rotate[0], -moved.rotate[1], -moved.rotate[2]] : undefined, points: moved.points?.map((p) => [-p[0], p[1], p[2]] as Vec3) }, path });
    }
  });
  if (prims.length > STRUCTURE_LIMITS.primitives) err("primitives", `${prims.length} primitives after repeats (most is ${STRUCTURE_LIMITS.primitives})`, "use bigger pieces");
  const TYPES: StructurePrimitiveType[] = ["box", "cylinder", "cone", "wedge", "ellipsoid", "capsule", "torus", "tube"];
  for (const { q, path } of prims) {
    if (!TYPES.includes(q.type)) err(`${path}.type`, `unknown primitive "${q.type}"`, `use ${TYPES.join(", ")}`);
    if (q.type === "tube") {
      if (!Array.isArray(q.points) || q.points.length < 2 || !q.points.every(isVec)) err(`${path}.points`, "a tube needs 2+ points", "e.g. an arch: [[-3,0,0],[-3,4,0],[0,6,0],[3,4,0],[3,0,0]]");
    } else {
      if (!isVec(q.at)) err(`${path}.at`, "at must be three numbers (blocks)", "the centre; y = 0 is the first block above ground");
      if (!isVec(q.size) || q.size!.some((n) => n < 1)) err(`${path}.size`, "size must be three numbers, each at least 1 (blocks)", "e.g. [9, 6, 7] for a small house");
    }
    if (!q.cut && (typeof q.block !== "string" || !isBlock(q.block))) err(`${path}.block`, `${q.block === undefined ? "no block" : `no block called "${q.block}"`}`, `use one of ${STRUCTURE_BLOCKS.filter((b) => b !== "air").join(", ")}`);
  }
  if (issues.some((i) => i.level === "error")) return { issues };

  // Rasterize at block centres with the same distance functions as the sculpted style.
  const blocks = new Map<string, string>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  for (const { q } of prims) {
    const sp: SdfPrim = q.type === "tube"
      ? { type: "tube", axis: "y", c: [0, 0, 0], half: [1, 1, 1], rot: [1, 0, 0, 0, 1, 0, 0, 0, 1], rgb: [0, 0, 0], finish: 0, cut: !!q.cut, blend: 0, min: [0, 0, 0], max: [0, 0, 0],
        pts: q.points!.flatMap((p) => p), radii: q.points!.map((_, i, a) => { const r = Array.isArray(q.radius) ? q.radius : [q.radius ?? 0.5, q.radius ?? 0.5]; return Math.max(0.5, r[0] + (r[1] - r[0]) * (i / Math.max(1, a.length - 1))); }) }
      : { type: q.type, axis: q.axis ?? "y", c: [q.at![0], q.at![1], q.at![2]], half: q.size!.map((n) => n / 2) as Vec3, rot: rotation(q.rotate), rgb: [0, 0, 0], finish: 0, cut: !!q.cut, blend: 0, min: [0, 0, 0], max: [0, 0, 0] };
    // Bounds: generous around the centre (or the points).
    const pts = q.type === "tube" ? q.points! : [q.at!];
    const reach = q.type === "tube" ? Math.max(...(Array.isArray(q.radius) ? q.radius : [q.radius ?? 0.5])) + 1 : Math.hypot(...q.size!) / 2 + 1;
    const lo = [0, 1, 2].map((i) => Math.floor(Math.min(...pts.map((p) => p[i])) - reach)), hi = [0, 1, 2].map((i) => Math.ceil(Math.max(...pts.map((p) => p[i])) + reach));
    const shell = q.hollow === true ? 1 : typeof q.hollow === "number" ? Math.max(1, q.hollow) : 0;
    for (let y = Math.max(-2, lo[1]); y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) for (let x = lo[0]; x <= hi[0]; x++) {
      // A block's coordinates are its centre (y = 0 is the first block above ground); only blocks
      // strictly inside count, so odd sizes centred on whole numbers come out exactly that size.
      const d = distanceTo(sp, x, y, z);
      if (d >= 0) continue;
      if (q.cut) { blocks.set(key(x, y, z), "air"); continue; }
      if (shell && d <= -shell) { blocks.set(key(x, y, z), "air"); continue; } // inside a room
      blocks.set(key(x, y, z), q.block!);
    }
  }
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let solid = 0;
  for (const [k, b] of blocks) {
    if (b === "air") continue;
    solid++;
    const p = k.split(",").map(Number);
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p[i]); max[i] = Math.max(max[i], p[i]); }
  }
  if (!solid) { err("primitives", "nothing solid is left", "cuts remove blocks; add walls or a floor"); return { issues }; }
  const footprint = Math.max(max[0] - min[0], max[2] - min[2]) + 1;
  const height = max[1] - Math.min(0, min[1]) + 1;
  if (footprint > STRUCTURE_LIMITS.side) err("primitives", `${footprint} blocks across (most is ${STRUCTURE_LIMITS.side})`, "make it smaller, or split it into several structures");
  if (height > STRUCTURE_LIMITS.height) err("primitives", `${height} blocks tall (most is ${STRUCTURE_LIMITS.height})`, "lower it");
  if (solid > STRUCTURE_LIMITS.blocks) err("primitives", `${solid} blocks (most is ${STRUCTURE_LIMITS.blocks})`, "make walls hollow; fill less");
  if (min[1] > 0) warn("primitives", `the lowest block is at y = ${min[1]}: it floats above the ground`, "start the floor or walls at y = 0");
  // A way in: an opening at ground level in the outer wall (warn if a closed room has none).
  // An opening: an empty block near the ground with open air (nothing of the structure) beside it.
  const enclosed = solid > 20 && max[1] >= 3 && [...blocks.values()].some((b) => b === "air");
  const opening = [...blocks].some(([k, b]) => {
    if (b !== "air") return false;
    const [x, y, z] = k.split(",").map(Number);
    return y <= 2 && y >= 0 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => !blocks.has(key(x + dx, y, z + dz)));
  });
  if (enclosed && !opening)
    warn("primitives", "no door: there's no opening at ground level in an outside wall", 'cut one: { "type": "box", "at": [0, 1, <wall z>], "size": [2, 3, 2], "cut": true }');
  if (issues.some((i) => i.level === "error")) return { issues };
  return { issues, raster: { blocks, min, max, footprint, tier: structureTier(footprint, height), foundation } };
}

/** Colours for previewing blocks as a model (the world's material colours). */
export function blockPreviewColor(name: string, std: Standards): string {
  const P = std.art.palette as Record<string, string>, M = std.art.materials as Record<string, string>;
  const mat: Record<string, string> = {
    planks: M.wood, log: M.bark, stone: M.stone, cobblestone: "neutral4", stone_bricks: "neutral5", bricks: "red2", sandstone: M.sand, glass: M.glass,
    wool: M.wool, torch: "yellow5", dirt: M.dirt, grass: M.grass, gravel: "neutral4", sand: M.sand, leaves: M.leaves,
  };
  return P[mat[name] ?? "neutral5"] ?? P.neutral5 ?? "#888888";
}

/** A structure as a model (one voxel per block), for previews in the model viewer. */
export function structureModel(r: StructureRaster, std: Standards): VoxelModel {
  const lowest = Math.min(0, r.min[1]);
  const g = new VoxelGrid(r.max[0] - r.min[0] + 1, r.max[1] - lowest + 1, r.max[2] - r.min[2] + 1);
  for (const [k, b] of r.blocks) {
    if (b === "air") continue;
    const [x, y, z] = k.split(",").map(Number);
    g.set(x - r.min[0], y - lowest, z - r.min[2], g.color(blockPreviewColor(b, std), b === "torch" ? 3 : b === "glass" ? 1 : 0));
  }
  return { voxelSize: 1, parts: [{ name: "body", grid: g, origin: [r.min[0], lowest, r.min[2]], pivot: [0, 0, 0] }] };
}

/**
 * The blocks to place for a structure whose centre is (cx, cz), standing on the ground there: the
 * land under it is levelled (foundation filled down, the space inside cleared).
 */
export function structurePlan(
  r: StructureRaster, cx: number, cz: number,
  ground: (x: number, z: number) => number,
  id: (name: string) => number,
): { blocks: Map<string, number>; center: [number, number, number] } {
  const base = ground(cx, cz) + 1;
  const out = new Map<string, number>();
  const air = id("air"), found = id(r.foundation);
  const cols = new Set<string>();
  for (const [k, b] of r.blocks) {
    const [x, y, z] = k.split(",").map(Number);
    out.set(`${cx + x},${base + y},${cz + z}`, b === "air" ? air : id(b));
    if (b !== "air" && y <= 0) cols.add(`${x},${z}`);
  }
  // Foundations down to the land under the lowest blocks; clear what stands in the way above it.
  for (const c of cols) {
    const [x, z] = c.split(",").map(Number);
    const g = ground(cx + x, cz + z);
    for (let y = g + 1; y < base + Math.min(0, r.min[1]); y++) if (!out.has(`${cx + x},${y},${cz + z}`)) out.set(`${cx + x},${y},${cz + z}`, found);
  }
  return { blocks: out, center: [cx, base, cz] };
}

/** A working structure to start from: a stone watchtower with a lantern on top. */
export const EXAMPLE_STRUCTURE: StructureInput = {
  title: "Lantern Watchtower",
  description: "a round stone watchtower with a wooden balcony and a lantern on top",
  primitives: [
    { type: "cylinder", at: [0, 6, 0], size: [7, 13, 7], block: "stone_bricks", hollow: true },
    { type: "cylinder", at: [0, 0, 0], size: [7, 1, 7], block: "cobblestone" },
    { type: "box", at: [0, 2, 3], size: [1, 3, 3], cut: true },
    { type: "box", at: [3, 7, 0], size: [3, 2, 1], cut: true, mirror: true },
    { type: "cylinder", at: [0, 12, 0], size: [11, 1, 11], block: "planks" },
    { type: "cylinder", at: [0, 13, 0], size: [11, 1, 11], block: "log", hollow: true },
    { type: "cone", at: [0, 17, 0], size: [9, 7, 9], block: "bricks" },
    { type: "box", at: [0, 13, 0], size: [1, 1, 1], block: "torch" },
  ],
};
