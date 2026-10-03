/**
 * Shapes: a small language for models written by an agent (or a person) instead of a body-plan generator.
 *
 * A shape is named parts made of primitives (box, ellipsoid, cylinder, cone, capsule, torus, wedge),
 * each placed, sized, rotated and coloured. Later primitives paint over earlier ones; `cut` carves
 * them away. The game scales the whole shape so its longest side is the summon's length, turns it
 * into voxels (so every model style, budget check and playtest works the same), and centres it on
 * its feet. Axes: +Y up, +Z forward (where it looks and moves), +X its left.
 *
 * Mistakes come back as issues with a JSON path and a hint for fixing them, so an agent can
 * repair a design in a few turns instead of guessing.
 */
import type { Standards } from "../standards";
import { chooseVoxelSize } from "./generate";
import type { SummonSpec } from "./spec";
import { VoxelGrid, type VoxelModel, type VoxelPart } from "./voxel";

export type Primitive = "box" | "ellipsoid" | "cylinder" | "cone" | "capsule" | "torus" | "wedge";
export const PRIMITIVES: Primitive[] = ["box", "ellipsoid", "cylinder", "cone", "capsule", "torus", "wedge"];
export type AnimRole = NonNullable<VoxelPart["anim"]>;
export const ANIM_ROLES: AnimRole[] = ["body", "head", "jaw", "tail", "finL", "finR", "wingL", "wingR", "legL", "legR", "armL", "armR"];
type Vec3 = [number, number, number];

export interface ShapePrimitive {
  type: Primitive;
  /** Centre, in the shape's own units. */
  at: Vec3;
  /**
   * Full width (x), height (y) and depth (z), before rotating. A torus is a ring around its axis
   * (outside size across, tube as thick as the size along the axis); a wedge is a ramp, full
   * height at the back (−z) down to an edge at the front (+z).
   */
  size: Vec3;
  /** Degrees about x, then y, then z. */
  rotate?: Vec3;
  /** Which way a cylinder, cone or capsule runs (and a torus's hole): default "y". A cone points to +axis. */
  axis?: "x" | "y" | "z";
  /** "main", "belly" or "accent" (the summon's colours), or a palette key such as "red3" or "neutral1". */
  color?: string;
  /** Carve this primitive out of what came before, instead of adding it. */
  cut?: boolean;
  /** Also add a copy mirrored across x = 0, in the same part (eyes, cheeks, horns). */
  mirror?: boolean;
}

export interface ShapePartSpec {
  name: string;
  /** How it moves: tails sway, wings flap, legs walk... Without one, it moves with the body. */
  anim?: AnimRole;
  /** Where it turns (a wing at the shoulder, a leg at the hip). Defaults to the centre of the part. */
  pivot?: Vec3;
  /** Also add a copy mirrored across x = 0 (left ↔ right roles swap): write one wing, get two. */
  mirror?: boolean;
  shapes: ShapePrimitive[];
}

export interface ShapeSpec {
  parts: ShapePartSpec[];
}

export interface ShapeIssue {
  /** JSON path into the shape, e.g. "parts[1].shapes[0].size". */
  path: string;
  level: "error" | "warning";
  message: string;
  /** What to change. */
  hint: string;
}

/** Words agents reach for, and what to use instead. */
const PRIMITIVE_SYNONYMS: Record<string, string> = {
  sphere: "ellipsoid (equal sizes make a sphere)", ball: "ellipsoid", oval: "ellipsoid", egg: "ellipsoid", cube: "box", cuboid: "box", block: "box",
  tube: "cylinder", pipe: "cylinder", disc: "cylinder (a short one)", disk: "cylinder (a short one)", pyramid: "cone", spike: "cone", horn: "cone",
  ring: "torus", donut: "torus", doughnut: "torus", ramp: "wedge", prism: "wedge", pill: "capsule", rod: "capsule",
};
/** Colour words, and the palette ramp to use for them. */
export const COLOR_SYNONYMS: Record<string, string> = {
  purple: "violet", magenta: "pink", cyan: "teal", turquoise: "teal", aqua: "teal", lime: "green", gold: "yellow", golden: "yellow",
  brown: "orange (orange1–2 are browns)", tan: "orange", beige: "yellow", white: "neutral (neutral8 is white)", black: "neutral (neutral1 is black)",
  grey: "neutral", gray: "neutral", silver: "neutral", crimson: "red", scarlet: "red", navy: "blue",
  moss: "green", leaf: "green", forest: "green", grass: "green", olive: "green", emerald: "green", jade: "teal", sky: "blue", azure: "blue",
  rose: "pink", rust: "orange", copper: "orange", amber: "orange", sand: "yellow", cream: "yellow", lavender: "violet", plum: "violet", stone: "neutral", bone: "neutral",
};
export function colorHint(word: string, palette: Record<string, string>): string {
  const base = word.replace(/\d+$/, "").toLowerCase();
  const ramp = COLOR_SYNONYMS[base]?.split(" ")[0] ?? base;
  const keys = Object.keys(palette).filter((k) => k.startsWith(ramp));
  const extra = COLOR_SYNONYMS[base] ? ` (${base} is ${COLOR_SYNONYMS[base]})` : "";
  return keys.length ? `try ${keys.join(", ")}${extra}` : 'use "main", "belly", "accent" or a palette key like "red3"; get_design_guide lists them';
}

export const SHAPE_LIMITS = { parts: 16, primitives: 96, aspect: 40 };

/** Check a shape before building it: everything an agent can get wrong, with where and how to fix it. */
export function validateShape(shape: unknown, std: Standards): ShapeIssue[] {
  const issues: ShapeIssue[] = [];
  const err = (path: string, message: string, hint: string) => issues.push({ path, level: "error", message, hint });
  const warn = (path: string, message: string, hint: string) => issues.push({ path, level: "warning", message, hint });
  const s = shape as ShapeSpec;
  if (!s || typeof s !== "object" || !Array.isArray(s.parts)) {
    err("", "a shape needs a parts list", 'write { "parts": [ { "name": "body", "anim": "body", "shapes": [ ... ] } ] }');
    return issues;
  }
  if (!s.parts.length) err("parts", "no parts", "add at least one part with one primitive");
  if (s.parts.length > SHAPE_LIMITS.parts) err("parts", `${s.parts.length} parts (most is ${SHAPE_LIMITS.parts})`, "merge parts that move together into one part");
  let total = 0;
  const names = new Set<string>();
  const palette = std.art.palette as Record<string, string>;
  const isVec = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));
  s.parts.forEach((p, i) => {
    const at = `parts[${i}]`;
    if (!p || typeof p !== "object") { err(at, "not a part", "each part is { name, anim?, pivot?, mirror?, shapes }"); return; }
    if (typeof p.name !== "string" || !p.name) err(`${at}.name`, "missing name", 'name every part, e.g. "body", "tail", "wing"');
    else if (names.has(p.name)) err(`${at}.name`, `two parts called "${p.name}"`, "give each part its own name");
    else names.add(p.name);
    const sided = typeof p.anim === "string" && ANIM_ROLES.includes(`${p.anim.replace(/s$/, "")}L` as AnimRole);
    if (p.anim !== undefined && !ANIM_ROLES.includes(p.anim))
      err(`${at}.anim`, `unknown role "${p.anim}"`, sided ? `use "${p.anim.replace(/s$/, "")}L" on the +x side (with "mirror": true for the other side)` : `use one of ${ANIM_ROLES.join(", ")}, or leave it out`);
    if (p.pivot !== undefined && !isVec(p.pivot)) err(`${at}.pivot`, "pivot must be three numbers", "e.g. [0.4, 1.2, 0]: where the part joins the body");
    if (p.mirror && p.anim && ANIM_ROLES.includes(p.anim) && !/[LR]$/.test(p.anim)) warn(`${at}.mirror`, `a mirrored "${p.anim}" part moves the same on both sides`, "use a left role (wingL, finL, legL, armL) on the +x side; the copy gets the right one");
    if (!Array.isArray(p.shapes) || !p.shapes.length) { err(`${at}.shapes`, "no primitives", "add at least one, e.g. { type: \"ellipsoid\", at: [0,1,0], size: [1,1,2], color: \"main\" }"); return; }
    if (p.shapes.every((q) => q?.cut)) err(`${at}.shapes`, "only cuts: nothing to carve from", "add a solid primitive before the cuts");
    p.shapes.forEach((q, j) => {
      const sp = `${at}.shapes[${j}]`;
      total++;
      if (!q || typeof q !== "object") { err(sp, "not a primitive", "{ type, at, size, rotate?, axis?, color?, cut? }"); return; }
      if (!PRIMITIVES.includes(q.type)) err(`${sp}.type`, `unknown primitive "${q.type}"`, PRIMITIVE_SYNONYMS[String(q.type).toLowerCase()] ? `use ${PRIMITIVE_SYNONYMS[String(q.type).toLowerCase()]}` : `use one of ${PRIMITIVES.join(", ")}`);
      if (!isVec(q.at)) err(`${sp}.at`, "at must be three numbers", "the centre, e.g. [0, 1, 0.5]");
      if (!isVec(q.size)) err(`${sp}.size`, "size must be three numbers", "full width, height, depth, e.g. [1, 0.6, 2]");
      else if (q.size.some((n) => n <= 0)) err(`${sp}.size`, "sizes must be above 0", "a flat fin still needs some thickness, e.g. 0.05");
      else if (Math.max(...q.size) / Math.min(...q.size) > SHAPE_LIMITS.aspect) warn(`${sp}.size`, "very thin: it may vanish at this detail", "make the thinnest side at least 1/40 of the longest");
      if (q.rotate !== undefined && !isVec(q.rotate)) err(`${sp}.rotate`, "rotate must be three numbers (degrees)", "e.g. [0, 0, 30]");
      if (q.axis !== undefined && !["x", "y", "z"].includes(q.axis)) err(`${sp}.axis`, `axis "${q.axis}"`, 'use "x", "y" or "z"');
      if (q.color !== undefined && !["main", "belly", "accent"].includes(q.color) && !(q.color in palette))
        err(`${sp}.color`, `"${q.color}" is not a world colour`, colorHint(String(q.color), palette));
    });
  });
  if (total > SHAPE_LIMITS.primitives) err("parts", `${total} primitives (most is ${SHAPE_LIMITS.primitives})`, "use fewer, larger primitives; detail comes from the model style");
  if (!s.parts.some((p) => p?.anim === "body" || p?.name === "body")) warn("parts", 'no "body" part', 'name the main mass "body" (anim "body") so it sways and rocks with the movement');
  return issues;
}

// ---------------------------------------------------------------- building

/** Signed inside test in the primitive's own frame, centred, sized to a unit box (−0.5..0.5). */
function inside(type: Primitive, axis: "x" | "y" | "z", x: number, y: number, z: number, size: Vec3): boolean {
  // Rotate so the primitive's axis is local y.
  let [u, v, w] = axis === "x" ? [y, x, z] : axis === "z" ? [x, z, y] : [x, y, z];
  const [su, sv, sw] = axis === "x" ? [size[1], size[0], size[2]] : axis === "z" ? [size[0], size[2], size[1]] : size;
  u /= su; v /= sv; w /= sw;
  if (Math.abs(u) > 0.5 || Math.abs(v) > 0.5 || Math.abs(w) > 0.5) return false;
  switch (type) {
    case "box": return true;
    case "ellipsoid": return u * u + v * v + w * w <= 0.25;
    case "cylinder": return u * u + w * w <= 0.25;
    case "cone": { const r = 0.5 * (0.5 - v); return u * u + w * w <= r * r; }
    case "capsule": {
      // Rounded ends: the caps are half-ellipsoids whose height is the radius along the axis.
      const capH = Math.min(0.5, (Math.min(su, sw) / 2) / sv);
      const c = Math.max(-0.5 + capH, Math.min(0.5 - capH, v));
      const dv = (v - c) / (capH * 2);
      return u * u + w * w + dv * dv <= 0.25;
    }
    case "torus": {
      // A ring around the axis: its tube is half the radius wide and as tall as the size along the axis.
      const radial = Math.hypot(u * 2, w * 2);
      return ((radial - 0.5) / 0.5) ** 2 + (v * 2) ** 2 <= 1;
    }
    case "wedge": return v <= 0.5 - (w + 0.5); // a ramp: full height at the back (−z), down to nothing at the front
  }
}

function rotation(deg: Vec3 | undefined): number[] {
  const [a, b, c] = (deg ?? [0, 0, 0]).map((d) => (d * Math.PI) / 180);
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
  // R = Rz · Ry · Rx (applied x first), row-major.
  return [
    cc * cb, cc * sb * sa - sc * ca, cc * sb * ca + sc * sa,
    sc * cb, sc * sb * sa + cc * ca, sc * sb * ca - cc * sa,
    -sb, cb * sa, cb * ca,
  ];
}

interface Placed { q: ShapePrimitive; rot: number[]; min: Vec3; max: Vec3 }

function place(q: ShapePrimitive): Placed {
  const rot = rotation(q.rotate);
  // Bounds of the rotated box.
  const h = q.size.map((n) => n / 2);
  const ext = [0, 1, 2].map((r) => Math.abs(rot[r * 3]) * h[0] + Math.abs(rot[r * 3 + 1]) * h[1] + Math.abs(rot[r * 3 + 2]) * h[2]);
  return { q, rot, min: [q.at[0] - ext[0], q.at[1] - ext[1], q.at[2] - ext[2]], max: [q.at[0] + ext[0], q.at[1] + ext[1], q.at[2] + ext[2]] };
}

function mirrored(p: ShapePartSpec): ShapePartSpec {
  const swap = (a?: AnimRole) => (a ? (a.replace(/L$/, "§").replace(/R$/, "L").replace("§", "R") as AnimRole) : a);
  return {
    name: `${p.name} (mirror)`,
    anim: swap(p.anim),
    pivot: p.pivot ? [-p.pivot[0], p.pivot[1], p.pivot[2]] : undefined,
    shapes: p.shapes.map((q) => ({ ...q, at: [-q.at[0], q.at[1], q.at[2]], rotate: q.rotate ? [q.rotate[0], -q.rotate[1], -q.rotate[2]] : undefined })),
  };
}

/** The parts after mirroring, as they'll be built. */
export function expandShape(shape: ShapeSpec): ShapePartSpec[] {
  const flip = (q: ShapePrimitive): ShapePrimitive => ({ ...q, at: [-q.at[0], q.at[1], q.at[2]], rotate: q.rotate ? [q.rotate[0], -q.rotate[1], -q.rotate[2]] : undefined });
  return shape.parts
    .map((p) => ({ ...p, shapes: p.shapes.flatMap((q) => (q.mirror ? [q, flip(q)] : [q])) }))
    .flatMap((p) => (p.mirror ? [p, mirrored(p)] : [p]));
}

/** Bounds of the whole shape in its own units. */
export function shapeBounds(shape: ShapeSpec): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of expandShape(shape)) for (const q of p.shapes) {
    if (q.cut) continue;
    const pl = place(q);
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], pl.min[i]); max[i] = Math.max(max[i], pl.max[i]); }
  }
  return { min, max };
}

/**
 * Build a shape into a voxel model, scaled so its longest side is `spec.length` blocks.
 * Same shape + palette → the same model, on the server and on every client.
 */
export function buildShape(shape: ShapeSpec, spec: SummonSpec, std: Standards): VoxelModel {
  const P = std.art.palette as Record<string, string>;
  const roles: Record<string, string> = { main: spec.colors.main, belly: spec.colors.belly, accent: spec.colors.accent };
  const colorOf = (c?: string) => P[roles[c ?? "main"] ?? c ?? ""] ?? P[c ?? ""] ?? P[spec.colors.main] ?? P.neutral5;
  const { min, max } = shapeBounds(shape);
  const longest = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const vs = chooseVoxelSize(spec.length, std.summons.maxVoxelsAlongLongestSide);
  const k = spec.length / longest / vs; // shape units → voxels
  const parts: VoxelPart[] = [];
  for (const p of expandShape(shape)) {
    const placed = p.shapes.map(place);
    const solid = placed.filter((pl) => !pl.q.cut);
    if (!solid.length) continue;
    const lo = [0, 1, 2].map((i) => Math.floor(Math.min(...solid.map((pl) => pl.min[i])) * k) - 1);
    const hi = [0, 1, 2].map((i) => Math.ceil(Math.max(...solid.map((pl) => pl.max[i])) * k) + 1);
    const g = new VoxelGrid(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
    for (const pl of placed) {
      const { q, rot } = pl;
      const c = q.cut ? 0 : g.color(colorOf(q.color));
      const x0 = Math.max(0, Math.floor(pl.min[0] * k) - lo[0]), x1 = Math.min(g.w - 1, Math.ceil(pl.max[0] * k) - lo[0]);
      const y0 = Math.max(0, Math.floor(pl.min[1] * k) - lo[1]), y1 = Math.min(g.h - 1, Math.ceil(pl.max[1] * k) - lo[1]);
      const z0 = Math.max(0, Math.floor(pl.min[2] * k) - lo[2]), z1 = Math.min(g.d - 1, Math.ceil(pl.max[2] * k) - lo[2]);
      // A side thinner than two voxels (a fin, a wing) keeps one layer: along it, any voxel that overlaps
      // the primitive counts as its middle, so it can't fall between voxel centres.
      const thin = q.size.map((n) => n * k < 2);
      const size = q.size.map((n, i) => (thin[i] ? Math.max(n, 1 / k) : n)) as Vec3;
      const flat = (c: number, i: number) => (thin[i] && Math.abs(c) <= size[i] / 2 + 0.5 / k ? 0 : c);
      for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        // Voxel centre in shape units, relative to the primitive's centre, then into its frame (inverse rotation = transpose).
        const dx = (x + lo[0] + 0.5) / k - q.at[0], dy = (y + lo[1] + 0.5) / k - q.at[1], dz = (z + lo[2] + 0.5) / k - q.at[2];
        const lx = rot[0] * dx + rot[3] * dy + rot[6] * dz;
        const ly = rot[1] * dx + rot[4] * dy + rot[7] * dz;
        const lz = rot[2] * dx + rot[5] * dy + rot[8] * dz;
        if (inside(q.type, q.axis ?? "y", flat(lx, 0), flat(ly, 1), flat(lz, 2), size)) g.set(x, y, z, c);
      }
    }
    const pv = p.pivot ?? [0, 1, 2].map((i) => (lo[i] + hi[i]) / 2 / k);
    parts.push({ name: p.name, grid: g, origin: [lo[0], lo[1], lo[2]], pivot: [pv[0] * k, pv[1] * k, pv[2] * k], anim: p.anim ?? (p.name === "body" ? "body" : undefined) });
  }
  return { voxelSize: vs, parts: centreOnFeet(parts) };
}

function centreOnFeet(parts: VoxelPart[]): VoxelPart[] {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of parts) {
    minX = Math.min(minX, p.origin[0]); maxX = Math.max(maxX, p.origin[0] + p.grid.w);
    minY = Math.min(minY, p.origin[1]);
    minZ = Math.min(minZ, p.origin[2]); maxZ = Math.max(maxZ, p.origin[2] + p.grid.d);
  }
  // Grids carry a one-voxel margin; feet go on the lowest filled voxel.
  let low = Infinity;
  for (const p of parts) for (let y = 0; y < p.grid.h && p.origin[1] + y < low; y++) {
    let any = false;
    for (let z = 0; z < p.grid.d && !any; z++) for (let x = 0; x < p.grid.w && !any; x++) any = p.grid.get(x, y, z) > 0;
    if (any) low = p.origin[1] + y;
  }
  const ox = -(minX + maxX) / 2, oy = -(Number.isFinite(low) ? low : minY), oz = -(minZ + maxZ) / 2;
  return parts.map((p) => ({ ...p, origin: [p.origin[0] + ox, p.origin[1] + oy, p.origin[2] + oz], pivot: [p.pivot[0] + ox, p.pivot[1] + oy, p.pivot[2] + oz] }));
}

/** After building: problems you can only see in the result (pieces floating apart, parts carved away). */
export function inspectShapeModel(shape: ShapeSpec, model: VoxelModel): ShapeIssue[] {
  const issues: ShapeIssue[] = [];
  const built = expandShape(shape);
  built.forEach((p, i) => {
    const part = model.parts.find((q) => q.name === p.name);
    const src = shape.parts.findIndex((q) => q.name === p.name.replace(/ \(mirror\)$/, ""));
    const path = `parts[${src < 0 ? i : src}]`;
    if (!part || !part.grid.data.some((v) => v > 0)) issues.push({ path, level: "error", message: `"${p.name}" came out empty`, hint: "it's smaller than one voxel or cut away completely: make it bigger or move the cuts" });
  });
  // Each part should touch another (within a voxel): a floating wing looks broken when it flaps.
  const occ = (p: VoxelPart) => {
    const s = new Set<string>();
    for (let y = 0; y < p.grid.h; y++) for (let z = 0; z < p.grid.d; z++) for (let x = 0; x < p.grid.w; x++)
      if (p.grid.get(x, y, z)) s.add(`${Math.round(p.origin[0] + x)},${Math.round(p.origin[1] + y)},${Math.round(p.origin[2] + z)}`);
    return s;
  };
  if (model.parts.length > 1) {
    const sets = model.parts.map(occ);
    model.parts.forEach((p, i) => {
      let touches = false;
      for (const key of sets[i]) {
        const [x, y, z] = key.split(",").map(Number);
        for (let dx = -1; dx <= 1 && !touches; dx++) for (let dy = -1; dy <= 1 && !touches; dy++) for (let dz = -1; dz <= 1 && !touches; dz++)
          touches = sets.some((s, j) => j !== i && s.has(`${x + dx},${y + dy},${z + dz}`));
        if (touches) break;
      }
      const src = shape.parts.findIndex((q) => q.name === p.name.replace(/ \(mirror\)$/, ""));
      if (!touches) issues.push({ path: `parts[${src}]`, level: "warning", message: `"${p.name}" doesn't touch any other part`, hint: "move it (or its first primitive) so it overlaps the body a little" });
    });
  }
  return issues;
}

/** A starting point for agents: a small, valid shape to copy and change. */
export const EXAMPLE_SHAPE: ShapeSpec = {
  parts: [
    { name: "body", anim: "body", shapes: [
      { type: "ellipsoid", at: [0, 1, 0], size: [1, 0.95, 2.2], color: "main" },
      { type: "ellipsoid", at: [0, 0.82, 0.1], size: [0.84, 0.6, 1.9], color: "belly" },
      { type: "wedge", at: [0, 1.55, -0.15], size: [0.1, 0.45, 0.7], color: "accent" },
      { type: "ellipsoid", at: [0.36, 1.12, 0.72], size: [0.24, 0.26, 0.24], color: "neutral8", mirror: true },
      { type: "ellipsoid", at: [0.45, 1.13, 0.78], size: [0.12, 0.15, 0.12], color: "neutral1", mirror: true },
      { type: "ellipsoid", at: [0, 0.86, 1.08], size: [0.36, 0.1, 0.1], color: "neutral2", cut: true },
    ] },
    { name: "tail", anim: "tail", pivot: [0, 1, -1.05], shapes: [
      { type: "ellipsoid", at: [0, 1.25, -1.35], size: [0.1, 0.7, 0.42], rotate: [40, 0, 0], color: "accent" },
      { type: "ellipsoid", at: [0, 0.78, -1.35], size: [0.1, 0.7, 0.42], rotate: [-40, 0, 0], color: "accent" },
    ] },
    { name: "fin", anim: "finL", mirror: true, pivot: [0.42, 0.85, 0.25], shapes: [
      { type: "ellipsoid", at: [0.68, 0.78, 0.18], size: [0.6, 0.08, 0.34], rotate: [0, 30, -25], color: "accent" },
    ] },
  ],
};
