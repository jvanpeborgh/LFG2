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
import { FINISHES, VoxelGrid, type Finish, type VoxelModel, type VoxelPart } from "./voxel";
import { distanceTo, type SdfPrim } from "./sculpt";

export type Primitive = "box" | "ellipsoid" | "cylinder" | "cone" | "capsule" | "torus" | "wedge" | "tube";
export const PRIMITIVES: Primitive[] = ["box", "ellipsoid", "cylinder", "cone", "capsule", "torus", "wedge", "tube"];
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
  /** Only colour what's already there (stripes, spots, patches, a visor band): it adds no volume. */
  paint?: boolean;
  /** Also add a copy mirrored across x = 0, in the same part (eyes, cheeks, horns). */
  mirror?: boolean;
  /** How it takes the light: matte (default), gloss, metal, or glow (lit from within; shows at night). */
  finish?: Finish;
  /** In the sculpted style, how softly it joins what came before (shape units; 0 is a hard crease). */
  blend?: number;
  /** Tubes only: the path, as 2–16 points (shape units), for tails, tentacles, horns, necks, vines. */
  points?: Vec3[];
  /** Tubes only: the radius, or [at the start, at the end] for a taper. */
  radius?: number | [number, number];
  /** Rounded edges and corners, as a radius (shape units): soft boxes, pillows, rounded armour. */
  round?: number;
  /** Narrow (or widen) towards the +axis end: a number, or [x scale, z scale] there. 0.3 makes a tusk of a cylinder. */
  taper?: number | [number, number];
  /** Twist along the axis, in degrees from one end to the other (horns, drills, braids). */
  twist?: number;
  /** Repeat it: `count` copies, each moved by `offset` (and turned by `rotate`, scaled by `scale`) from the last. Spines, teeth, ribs, scales. */
  repeat?: { count: number; offset: Vec3; rotate?: Vec3; scale?: number };
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
  /** Default join softness for the sculpted style (shape units). Default: 3% of the longest side. */
  blend?: number;
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
/** A summon colour shifted along its palette ramp: "main-1" is a step darker, "belly+1" a step lighter. */
export const SHADE = /^(main|belly|accent)([+-][123])$/;

/** The palette key `steps` along the ramp from `key` (orange2 → orange1 for -1), staying on the ramp. */
export function shadeKey(key: string, steps: number, palette: Record<string, string>): string {
  const m = /^([a-z]+)(\d)$/.exec(key ?? "");
  if (!m) return key;
  for (let s = steps; s !== 0; s -= Math.sign(s)) {
    const k = `${m[1]}${Number(m[2]) + s}`;
    if (k in palette) return k;
  }
  return key;
}

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
  if (s.blend !== undefined && (typeof s.blend !== "number" || !(s.blend >= 0))) err("blend", "blend must be a number ≥ 0", "e.g. 0.05");
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
    if (p.shapes.every((q) => q?.cut || q?.paint)) err(`${at}.shapes`, "only cuts or paint: nothing to carve or colour", "add a solid primitive first");
    p.shapes.forEach((q, j) => {
      const sp = `${at}.shapes[${j}]`;
      total += Math.max(1, Number.isInteger(q?.repeat?.count) ? q.repeat!.count : 1);
      if (!q || typeof q !== "object") { err(sp, "not a primitive", "{ type, at, size, rotate?, axis?, color?, cut? }"); return; }
      if (!PRIMITIVES.includes(q.type)) err(`${sp}.type`, `unknown primitive "${q.type}"`, PRIMITIVE_SYNONYMS[String(q.type).toLowerCase()] ? `use ${PRIMITIVE_SYNONYMS[String(q.type).toLowerCase()]}` : `use one of ${PRIMITIVES.join(", ")}`);
      if (q.type === "tube") {
        if (!Array.isArray(q.points) || q.points.length < 2 || q.points.length > 16 || !q.points.every(isVec)) err(`${sp}.points`, "a tube needs 2–16 points, each three numbers", "e.g. [[0,1,-1], [0,1.3,-1.6], [0,1.8,-1.9]] for a tail curling up");
        const rs = Array.isArray(q.radius) ? q.radius : [q.radius];
        if (!rs.length || rs.length > 2 || rs.some((r) => typeof r !== "number" || !(r > 0))) err(`${sp}.radius`, "radius must be a number above 0, or [start, end]", "e.g. 0.1, or [0.15, 0.03] for a tail that thins to a tip");
      } else if (!isVec(q.at)) err(`${sp}.at`, "at must be three numbers", "the centre, e.g. [0, 1, 0.5]");
      if (q.type === "tube") { /* sized by its points and radius */ }
      else if (!isVec(q.size)) err(`${sp}.size`, "size must be three numbers", "full width, height, depth, e.g. [1, 0.6, 2]");
      else if (q.size.some((n) => n <= 0)) err(`${sp}.size`, "sizes must be above 0", "a flat fin still needs some thickness, e.g. 0.05");
      else if (Math.max(...q.size) / Math.min(...q.size) > SHAPE_LIMITS.aspect) warn(`${sp}.size`, "very thin: it may vanish at this detail", "make the thinnest side at least 1/40 of the longest");
      if (q.rotate !== undefined && !isVec(q.rotate)) err(`${sp}.rotate`, "rotate must be three numbers (degrees)", "e.g. [0, 0, 30]");
      if (q.finish !== undefined && !FINISHES.includes(q.finish)) err(`${sp}.finish`, `unknown finish "${q.finish}"`, `use ${FINISHES.join(", ")}${/shin|polish|wet|lacquer/i.test(String(q.finish)) ? ' ("gloss")' : /light|emissive|neon|lumin/i.test(String(q.finish)) ? ' ("glow")' : /steel|iron|gold|chrome|metallic/i.test(String(q.finish)) ? ' ("metal")' : ""}`);
      if (q.round !== undefined && (typeof q.round !== "number" || !(q.round >= 0))) err(`${sp}.round`, "round must be a number ≥ 0", "a corner radius, e.g. 0.1");
      const tp = q.taper === undefined ? [] : Array.isArray(q.taper) ? q.taper : [q.taper];
      if (q.taper !== undefined && (!tp.length || tp.length > 2 || tp.some((x) => typeof x !== "number" || !(x >= 0) || x > 4))) err(`${sp}.taper`, "taper is a scale 0–4 at the +axis end, or [x, z]", "e.g. 0.3 to narrow to a point-ish end");
      if (q.twist !== undefined && (typeof q.twist !== "number" || Math.abs(q.twist) > 1080)) err(`${sp}.twist`, "twist is degrees, at most ±1080", "e.g. 180");
      if (q.repeat !== undefined) {
        const r = q.repeat;
        if (!r || !Number.isInteger(r.count) || r.count < 1 || r.count > 24 || !isVec(r.offset)) err(`${sp}.repeat`, "repeat needs count (1–24) and offset [x,y,z]", '{ "count": 5, "offset": [0, 0, -0.3] } for a row of spines');
        else if ((r.rotate !== undefined && !isVec(r.rotate)) || (r.scale !== undefined && !(typeof r.scale === "number" && r.scale > 0.2 && r.scale < 3))) err(`${sp}.repeat`, "repeat.rotate is [deg x,y,z]; repeat.scale is 0.2–3", "e.g. scale 0.85 for spines that shrink towards the tail");
      }
      if (q.blend !== undefined && (typeof q.blend !== "number" || !(q.blend >= 0))) err(`${sp}.blend`, "blend must be a number ≥ 0", "e.g. 0.1 for a soft join, 0 for a crease");
      if (q.axis !== undefined && !["x", "y", "z"].includes(q.axis)) err(`${sp}.axis`, `axis "${q.axis}"`, 'use "x", "y" or "z"');
      if (q.color !== undefined && !["main", "belly", "accent"].includes(q.color) && !SHADE.test(q.color) && !(q.color in palette))
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
    case "tube": return false; // filled from its distance field
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
    shapes: p.shapes.map((q) => ({
      ...q, at: [-q.at[0], q.at[1], q.at[2]], rotate: q.rotate ? [q.rotate[0], -q.rotate[1], -q.rotate[2]] : undefined,
      ...(q.points ? { points: q.points.map(([x, y, z]) => [-x, y, z] as Vec3) } : {}),
    })),
  };
}

/** The parts after mirroring, as they'll be built. */
export function expandShape(shape: ShapeSpec): ShapePartSpec[] {
  const flip = (q: ShapePrimitive): ShapePrimitive => ({
    ...q, at: [-q.at[0], q.at[1], q.at[2]], rotate: q.rotate ? [q.rotate[0], -q.rotate[1], -q.rotate[2]] : undefined,
    ...(q.points ? { points: q.points.map(([x, y, z]) => [-x, y, z] as Vec3) } : {}),
  });
  return shape.parts
    .map((p) => ({ ...p, shapes: p.shapes.flatMap(repeated).map(fitTube).flatMap((q) => (q.mirror ? [q, flip(q)] : [q])) }))
    .flatMap((p) => (p.mirror ? [p, mirrored(p)] : [p]));
}

/** `repeat` → that many primitives, each moved, turned and scaled from the last. */
function repeated(q: ShapePrimitive): ShapePrimitive[] {
  if (!q.repeat) return [q];
  const { count, offset, rotate, scale = 1 } = q.repeat;
  const out: ShapePrimitive[] = [];
  for (let i = 0; i < count; i++) {
    const s = scale ** i;
    const d: Vec3 = [offset[0] * i, offset[1] * i, offset[2] * i];
    out.push({
      ...q, repeat: undefined,
      at: [q.at?.[0] + d[0], q.at?.[1] + d[1], q.at?.[2] + d[2]] as Vec3,
      size: q.size ? (q.size.map((n) => n * s) as Vec3) : q.size,
      ...(rotate ? { rotate: [(q.rotate?.[0] ?? 0) + rotate[0] * i, (q.rotate?.[1] ?? 0) + rotate[1] * i, (q.rotate?.[2] ?? 0) + rotate[2] * i] as Vec3 } : {}),
      ...(q.points ? { points: q.points.map(([x, y, z]) => [x + d[0], y + d[1], z + d[2]] as Vec3) } : {}),
      ...(q.radius !== undefined ? { radius: Array.isArray(q.radius) ? (q.radius.map((r) => r * s) as [number, number]) : q.radius * s } : {}),
    });
  }
  return out;
}

/** A tube's centre and size come from its points and radius (so bounds, checks and critique work alike). */
function fitTube(q: ShapePrimitive): ShapePrimitive {
  if (q.type !== "tube" || !q.points?.length) return q;
  const r = Math.max(...(Array.isArray(q.radius) ? q.radius : [q.radius ?? 0.1]));
  const mn = [0, 1, 2].map((i) => Math.min(...q.points!.map((p) => p[i])) - r), mx = [0, 1, 2].map((i) => Math.max(...q.points!.map((p) => p[i])) + r);
  return { ...q, at: [0, 1, 2].map((i) => (mn[i] + mx[i]) / 2) as Vec3, size: [0, 1, 2].map((i) => mx[i] - mn[i]) as Vec3, rotate: undefined };
}

/** Bounds of the whole shape in its own units. */
export function shapeBounds(shape: ShapeSpec): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of expandShape(shape)) for (const q of p.shapes) {
    if (q.cut || q.paint) continue;
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
  const colorOf = (c?: string) => {
    const m = c ? SHADE.exec(c) : null;
    if (m) return P[shadeKey(roles[m[1]], Number(m[2]), P)] ?? P[roles[m[1]]] ?? P.neutral5;
    return P[roles[c ?? "main"] ?? c ?? ""] ?? P[c ?? ""] ?? P[spec.colors.main] ?? P.neutral5;
  };
  const { min, max } = shapeBounds(shape);
  const longest = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const vs = chooseVoxelSize(spec.length, std.summons.maxVoxelsAlongLongestSide);
  const k = spec.length / longest / vs; // shape units → voxels
  const blend = shape.blend ?? longest * 0.03;
  const parts: VoxelPart[] = [];
  for (const p of expandShape(shape)) {
    const placed = p.shapes.map(place);
    const solid = placed.filter((pl) => !pl.q.cut && !pl.q.paint);
    if (!solid.length) continue;
    const lo = [0, 1, 2].map((i) => Math.floor(Math.min(...solid.map((pl) => pl.min[i])) * k) - 1);
    const hi = [0, 1, 2].map((i) => Math.ceil(Math.max(...solid.map((pl) => pl.max[i])) * k) + 1);
    const g = new VoxelGrid(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
    // The same primitives as distance fields, in this grid's coordinates (the sculpted style, and the
    // voxel fill of tubes and modified primitives).
    const sdf: SdfPrim[] = placed.map(({ q, rot, min: mn, max: mx }) => {
      // A detail never melts: its join is at most a fifth of its own smallest side (eyes stay eyes).
      // Paint fades only when asked (its blend is the width of the fade).
      const b = q.paint ? (q.blend ?? 0) * k : Math.min((q.blend ?? blend) * k, q.blend === undefined ? Math.min(...q.size) * k * 0.2 : Infinity);
      const rgb = hexRgb(colorOf(q.color));
      const tr = Array.isArray(q.taper) ? q.taper : q.taper !== undefined ? [q.taper, q.taper] : undefined;
      const rad = q.type === "tube" ? (Array.isArray(q.radius) ? q.radius : [q.radius ?? 0.1, q.radius ?? 0.1]) : undefined;
      return {
        type: q.type, axis: q.axis ?? "y", rot, rgb, finish: Math.max(0, FINISHES.indexOf(q.finish ?? "matte")), cut: !!q.cut, blend: b, ...(q.paint ? { paint: true } : {}),
        c: [q.at[0] * k - lo[0], q.at[1] * k - lo[1], q.at[2] * k - lo[2]],
        // Small details stay small (sculpted meshes them exactly); only specks are rounded up.
        half: q.size.map((n) => Math.max(0.2, (n * k) / 2)) as Vec3,
        min: [mn[0] * k - lo[0] - b - 1, mn[1] * k - lo[1] - b - 1, mn[2] * k - lo[2] - b - 1],
        max: [mx[0] * k - lo[0] + b + 1, mx[1] * k - lo[1] + b + 1, mx[2] * k - lo[2] + b + 1],
        ...(q.round ? { round: q.round * k } : {}),
        ...(tr ? { taper: [tr[0], tr[1]] as [number, number] } : {}),
        ...(q.twist ? { twist: (q.twist * Math.PI) / 180 } : {}),
        // Tubes at least ~1 voxel thick: thinner ones could pass between voxel centres and vanish.
        ...(q.type === "tube" && q.points && rad ? {
          pts: q.points.flatMap((pt) => [pt[0] * k - lo[0], pt[1] * k - lo[1], pt[2] * k - lo[2]]),
          // Sculpted surfaces resolve thinner tubes than voxels can: the voxel fill below widens them.
          radii: q.points.map((_, i) => Math.max(0.4, (rad[0] + (rad[1] - rad[0]) * (i / Math.max(1, q.points!.length - 1))) * k)),
        } : {}),
      };
    });
    for (const [pi, pl] of placed.entries()) {
      const { q, rot } = pl;
      const finish = Math.max(0, FINISHES.indexOf(q.finish ?? "matte"));
      const c = q.cut ? 0 : g.color(colorOf(q.color), finish);
      if (q.paint) {
        // Paint: recolour solid voxels inside it, add nothing.
        const sp = sdf[pi];
        const x0 = Math.max(0, Math.floor(sp.min[0])), x1 = Math.min(g.w - 1, Math.ceil(sp.max[0]));
        const y0 = Math.max(0, Math.floor(sp.min[1])), y1 = Math.min(g.h - 1, Math.ceil(sp.max[1]));
        const z0 = Math.max(0, Math.floor(sp.min[2])), z1 = Math.min(g.d - 1, Math.ceil(sp.max[2]));
        for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++)
          if (g.get(x, y, z) && distanceTo(sp, x + 0.5, y + 0.5, z + 0.5) <= 1e-6) g.set(x, y, z, c);
        continue;
      }
      if (q.type === "tube" || q.round || q.taper !== undefined || q.twist) {
        // Measured with the distance field, at voxel centres.
        const sp = sdf[pi];
        const x0 = Math.max(0, Math.floor(sp.min[0])), x1 = Math.min(g.w - 1, Math.ceil(sp.max[0]));
        const y0 = Math.max(0, Math.floor(sp.min[1])), y1 = Math.min(g.h - 1, Math.ceil(sp.max[1]));
        const z0 = Math.max(0, Math.floor(sp.min[2])), z1 = Math.min(g.d - 1, Math.ceil(sp.max[2]));
        // Thinner than two voxels somewhere (a tapered leg on a small creature): take voxels whose
        // centre is within half a voxel, so it stays connected instead of falling between centres.
        const tol = q.type === "tube" ? Math.max(1e-6, 0.9 - Math.min(...(sp.radii ?? [1]))) : Math.min(...q.size) * k < 2 ? 0.5 : 1e-6;
        for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++)
          if (distanceTo(sp, x + 0.5, y + 0.5, z + 0.5) <= tol) g.set(x, y, z, c);
        continue;
      }
      const x0 = Math.max(0, Math.floor(pl.min[0] * k) - lo[0]), x1 = Math.min(g.w - 1, Math.ceil(pl.max[0] * k) - lo[0]);
      const y0 = Math.max(0, Math.floor(pl.min[1] * k) - lo[1]), y1 = Math.min(g.h - 1, Math.ceil(pl.max[1] * k) - lo[1]);
      const z0 = Math.max(0, Math.floor(pl.min[2] * k) - lo[2]), z1 = Math.min(g.d - 1, Math.ceil(pl.max[2] * k) - lo[2]);
      // A side thinner than two voxels (a fin, a wing) keeps one layer: along it, any voxel that overlaps
      // the primitive counts as its middle, so it can't fall between voxel centres.
      const thin = q.size.map((n) => n * k < 2);
      // A detail smaller than two voxels every way (an eye, an ear tip on a small creature) is one
      // voxel at its centre: widening it on every side would swallow the head it sits on.
      if (thin.every(Boolean)) {
        const cx = Math.floor(q.at[0] * k) - lo[0], cy = Math.floor(q.at[1] * k) - lo[1], cz = Math.floor(q.at[2] * k) - lo[2];
        if (cx >= 0 && cy >= 0 && cz >= 0 && cx < g.w && cy < g.h && cz < g.d) g.set(cx, cy, cz, c);
        continue;
      }
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
    const part: VoxelPart = { name: p.name, grid: g, origin: [lo[0], lo[1], lo[2]], pivot: [pv[0] * k, pv[1] * k, pv[2] * k], anim: p.anim ?? (p.name === "body" ? "body" : undefined), sdf };
    parts.push(...(p.anim === "tail" ? segmentChain(part, parts.length) : [part]));
  }
  return { voxelSize: vs, parts: centreOnFeet(parts) };
}

/**
 * A tail drawn with a tube becomes a chain of up to 4 segments along the tube, each hanging from the
 * one before, so it can swing with follow-through (each segment a beat behind the last) instead of
 * as one stiff piece. Voxels and the other primitives go to the nearest segment.
 */
function segmentChain(part: VoxelPart, firstIndex: number): VoxelPart[] {
  const tube = part.sdf?.find((q) => q.type === "tube" && q.pts && q.pts.length >= 9 && !q.cut);
  if (!tube) return [part];
  const P = tube.pts!, R = tube.radii!;
  const n = P.length / 3, nseg = Math.min(4, n - 1);
  const chainOf = (j: number) => Math.min(nseg - 1, Math.floor((j * nseg) / (n - 1)));
  /** The polyline segment nearest a point (grid coordinates). */
  const nearest = (x: number, y: number, z: number) => {
    let best = 0, bd = Infinity;
    for (let j = 0; j < n - 1; j++) {
      const ax = P[j * 3], ay = P[j * 3 + 1], az = P[j * 3 + 2];
      const dx = P[j * 3 + 3] - ax, dy = P[j * 3 + 4] - ay, dz = P[j * 3 + 5] - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / (dx * dx + dy * dy + dz * dz || 1)));
      const d = Math.hypot(x - ax - dx * t, y - ay - dy * t, z - az - dz * t);
      if (d < bd) { bd = d; best = j; }
    }
    return best;
  };
  const g = part.grid;
  const grids = Array.from({ length: nseg }, () => {
    const c = new VoxelGrid(g.w, g.h, g.d);
    c.palette.push(...g.palette.slice(1));
    c.finish.push(...g.finish.slice(1));
    return c;
  });
  for (let y = 0; y < g.h; y++) for (let z = 0; z < g.d; z++) for (let x = 0; x < g.w; x++) {
    const v = g.get(x, y, z);
    if (v) grids[chainOf(nearest(x + 0.5, y + 0.5, z + 0.5))].set(x, y, z, v);
  }
  // Each segment's distance field: its stretch of the tube, plus the primitives nearest it.
  const sdfFor = (c: number) => part.sdf!.flatMap((q) => {
    if (q !== tube) return chainOf(nearest(q.c[0], q.c[1], q.c[2])) === c ? [q] : [];
    const js = Array.from({ length: n - 1 }, (_, j) => j).filter((j) => chainOf(j) === c);
    const a = js[0], b = js[js.length - 1] + 1;
    return [{ ...q, pts: P.slice(a * 3, b * 3 + 3), radii: R.slice(a, b + 1) }];
  });
  return grids.map((grid, c) => {
    const j = Array.from({ length: n - 1 }, (_, i) => i).find((i) => chainOf(i) === c)!;
    const at: [number, number, number] = [part.origin[0] + P[j * 3], part.origin[1] + P[j * 3 + 1], part.origin[2] + P[j * 3 + 2]];
    return {
      name: c ? `${part.name} ${c + 1}` : part.name, grid, origin: part.origin, anim: "tail" as const, sdf: sdfFor(c),
      pivot: c ? at : part.pivot, chain: c, ...(c ? { parent: firstIndex + c - 1 } : {}),
    };
  });
}

const hexRgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];

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
    if (p.anim === "tail" && model.parts.some((q) => q.name.startsWith(`${p.name} `) && q.chain)) return; // a chained tail: checked by its segments
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
      const src = shape.parts.findIndex((q) => q.name === p.name.replace(/ \(mirror\)$/, "").replace(/ \d+$/, ""));
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
