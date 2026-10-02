import { mulberry32 } from "../random";
import type { Standards } from "../standards";
import type { SummonSpec } from "./spec";
import { VoxelGrid, modelLength, type VoxelModel, type VoxelPart } from "./voxel";

/**
 * Procedural model generators, one per body plan. They follow the art
 * standards (docs/standards/art-and-3d-assets.md): chunky readable
 * silhouettes, colours only from the world palette, countershading (darker
 * back, lighter belly) for form, eyes for anything alive, model faces +Z.
 */

type Ctx = {
  spec: SummonSpec;
  rand: () => number;
  /** Palette colour by key, with an optional step along its ramp (-1 darker, +1 lighter). */
  col: (key: string, step?: number) => string;
};

const VOXEL_SIZES = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1];

/** Smallest voxel size that keeps the longest side within the budget (more detail for small things). */
export function chooseVoxelSize(lengthBlocks: number, maxVoxels: number): number {
  return VOXEL_SIZES.find((s) => lengthBlocks / s <= maxVoxels) ?? 1;
}

function makeCtx(spec: SummonSpec, std: Standards): Ctx {
  const P = std.art.palette as Record<string, string>;
  return {
    spec,
    rand: mulberry32(spec.seed),
    col: (key, step = 0) => {
      const m = /^([a-z]+)(\d)$/.exec(key);
      if (!m) return P[key] ?? P.neutral5;
      const max = m[1] === "neutral" ? 8 : 5;
      const n = Math.max(1, Math.min(max, Number(m[2]) + step));
      return P[`${m[1]}${n}`] ?? P[key] ?? P.neutral5;
    },
  };
}

/**
 * Build the model for a spec. Deterministic: same spec + palette → same model.
 * Fins, wings and tails stick out past the body, so it measures the result and
 * rebuilds a little smaller if it came out longer than asked.
 */
export function generateModel(spec: SummonSpec, std: Standards): VoxelModel {
  // Clouds are one simple part, so they can afford a finer grid (their outline is everything).
  const maxVoxels = std.summons.maxVoxelsAlongLongestSide * (spec.body === "cloud" ? 1.4 : 1);
  const vs = chooseVoxelSize(spec.length, maxVoxels);
  let scale = 1;
  let model = build(spec, std, vs, scale);
  for (let attempt = 0; attempt < 3; attempt++) {
    const len = modelLength(model);
    if (len <= spec.length * 1.04) break;
    scale *= (spec.length / len) * 0.98;
    model = build(spec, std, vs, scale);
  }
  return model;
}

function build(spec: SummonSpec, std: Standards, vs: number, scale: number): VoxelModel {
  const ctx = makeCtx(spec, std);
  const L = Math.max(4, Math.round((spec.length / vs) * scale));
  const parts =
    spec.body === "cloud" ? cloud(ctx, L)
    : spec.body === "fish" ? fish(ctx, L)
    : spec.body === "bird" ? bird(ctx, L)
    : spec.body === "quadruped" ? quadruped(ctx, L)
    : blob(ctx, L);
  if (spec.features.includes("wings") && spec.body !== "bird") parts.push(...wings(ctx, parts[0], L));
  return { voxelSize: vs, parts: centre(parts) };
}

/** A pair of feathered wings attached to the top of the body, for things that fly but aren't birds. */
function wings(ctx: Ctx, body: VoxelPart, L: number): VoxelPart[] {
  const { col } = ctx;
  const span = Math.max(4, Math.round(L * 0.55)), chord = Math.max(3, Math.round(L * 0.28));
  const g = body.grid;
  const topY = body.origin[1] + g.h * 0.7;
  const midZ = body.origin[2] + g.d * 0.55;
  const cx = body.origin[0] + g.w / 2;
  const out: VoxelPart[] = [];
  for (const side of [1, -1] as const) {
    const w = new VoxelGrid(span + 1, 1, chord + 1);
    const c = w.color(col("neutral8")), tip = w.color(col("neutral7"));
    const root = side > 0 ? 0 : span;
    triangle(w, [0, 2], [root, 0], [root, chord], [side > 0 ? span : 0, chord * 0.7], 0, 1, c);
    w.paint((x, _y, z) => (z + (side > 0 ? x : span - x)) % 3 === 0, tip);
    const x0 = side > 0 ? cx + g.w * 0.25 : cx - g.w * 0.25 - (span + 1);
    out.push({ name: side > 0 ? "wingL" : "wingR", grid: w, origin: [x0, topY, midZ - chord / 2], pivot: [side > 0 ? x0 : x0 + span + 1, topY, midZ], anim: side > 0 ? "wingL" : "wingR" });
  }
  return out;
}

/** Put the model's feet at y=0 and centre it in x and z. */
function centre(parts: VoxelPart[]): VoxelPart[] {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const p of parts) {
    minX = Math.min(minX, p.origin[0]); maxX = Math.max(maxX, p.origin[0] + p.grid.w);
    minY = Math.min(minY, p.origin[1]);
    minZ = Math.min(minZ, p.origin[2]); maxZ = Math.max(maxZ, p.origin[2] + p.grid.d);
  }
  const ox = -(minX + maxX) / 2, oy = -minY, oz = -(minZ + maxZ) / 2;
  return parts.map((p) => ({
    ...p,
    origin: [p.origin[0] + ox, p.origin[1] + oy, p.origin[2] + oz],
    pivot: [p.pivot[0] + ox, p.pivot[1] + oy, p.pivot[2] + oz],
  }));
}

/** Fill a triangle (in the plane of two axes) with given thickness along the third axis. */
function triangle(
  g: VoxelGrid,
  axes: [0 | 1 | 2, 0 | 1 | 2],
  a: [number, number], b: [number, number], c: [number, number],
  third: number, thickness: number, color: number,
): void {
  const [ax, bx] = axes;
  const other = (3 - ax - bx) as 0 | 1 | 2;
  const minU = Math.floor(Math.min(a[0], b[0], c[0])), maxU = Math.ceil(Math.max(a[0], b[0], c[0]));
  const minV = Math.floor(Math.min(a[1], b[1], c[1])), maxV = Math.ceil(Math.max(a[1], b[1], c[1]));
  const sign = (p: [number, number], q: [number, number], r: [number, number]) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  for (let u = minU; u <= maxU; u++)
    for (let v = minV; v <= maxV; v++) {
      const p: [number, number] = [u + 0.5, v + 0.5];
      const d1 = sign(p, a, b), d2 = sign(p, b, c), d3 = sign(p, c, a);
      const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
      if (neg && pos) continue;
      for (let t = 0; t < thickness; t++) {
        const xyz = [0, 0, 0];
        xyz[ax] = u; xyz[bx] = v; xyz[other] = third + t;
        g.set(xyz[0], xyz[1], xyz[2], color);
      }
    }
}

/** The outermost solid voxel along +x or -x in a row (for placing eyes and markings on the surface). */
function surfaceX(g: VoxelGrid, y: number, z: number, side: 1 | -1): number {
  if (side > 0) { for (let x = g.w - 1; x >= 0; x--) if (g.get(x, y, z)) return x; }
  else { for (let x = 0; x < g.w; x++) if (g.get(x, y, z)) return x; }
  return -1;
}

function surfaceYDown(g: VoxelGrid, x: number, z: number): number {
  for (let y = 0; y < g.h; y++) if (g.get(x, y, z)) return y;
  return -1;
}

// ------------------------------------------------------------------ cloud

function cloud(ctx: Ctx, L: number): VoxelPart[] {
  const { rand, spec, col } = ctx;
  // Cartoon cloud: flat bottom, a row of rounded humps along its length (tallest near the middle),
  // a second, lower row behind for depth, a small bump on each dome for a cauliflower edge.
  const W = L, D = Math.max(6, Math.round(L * 0.46));
  const baseH = Math.max(2, Math.round(L * 0.1));
  const humps = 3 + (spec.length > 10 ? 1 : 0);
  const spacing = (W * 0.72) / (humps - 1);
  const maxR = spacing * 0.78;
  const g = new VoxelGrid(W + 2, Math.ceil(baseH + maxR * 2.4) + 3, D + 2);
  const main = g.color(col(spec.colors.main)), mid = g.color(col(spec.colors.belly)), under = g.color(col(spec.colors.accent));
  const floor = 1;
  // Base slab with rounded ends, narrower than the humps so the domes overhang it.
  g.ellipsoid(W / 2 + 1, floor + baseH * 0.6, D / 2 + 1, W * 0.45, baseH * 1.1, D * 0.36, main);
  for (let i = 0; i < humps; i++) {
    const x = 1 + W * 0.15 + spacing * i + (rand() - 0.5) * spacing * 0.12;
    const middle = 1 - Math.abs((x - 1) / W - 0.5) * 2;
    // Domes clearly separated by dips: radius about 60% of the spacing, the middle one tallest.
    const r = spacing * 0.64 * (0.7 + 0.3 * middle) * (0.94 + rand() * 0.12);
    const z = D / 2 + 1 + (rand() - 0.5) * D * 0.12;
    const y = floor + baseH + r * 0.85;
    g.ellipsoid(x, y, z, r, r, Math.min(r * 1.1, D * 0.46), main);
    // Low shoulder puffs between and beside the domes give the cauliflower edge without filling the dips.
    for (const side of [-1, 1]) {
      const sr = r * (0.5 + rand() * 0.1);
      g.ellipsoid(x + side * r * 0.95, floor + baseH + sr * 0.45, z + (rand() - 0.5) * D * 0.25, sr, sr, Math.min(sr * 1.2, D * 0.45), main);
    }
  }
  const storm = spec.features.includes("storm");
  // Flat bottom; shaded underside (lit from above, like everything else in the world).
  const cut = floor + 1;
  for (let y = 0; y < cut; y++) for (let z = 0; z < g.d; z++) for (let x = 0; x < g.w; x++) g.set(x, y, z, 0);
  // Storm clouds are dark underneath; fair-weather clouds just have a soft grey base.
  g.paint((_x, y) => y <= cut + Math.max(1, Math.round(storm ? (g.h - cut) * 0.28 : baseH * 0.6)), mid);
  g.paint((_x, y) => y === cut, under);
  return [{ name: "body", grid: g, origin: [0, 0, 0], pivot: [g.w / 2, 0, g.d / 2], anim: "body" }];
}

// ------------------------------------------------------------------ fish (sharks, whales, dolphins, fish)

function fish(ctx: Ctx, L: number): VoxelPart[] {
  const { spec, col } = ctx;
  const shark = spec.features.includes("teeth") || spec.features.includes("dorsal");
  const flukes = spec.features.includes("flukes");
  const big = spec.length >= 6;
  const R = Math.max(2, L * (spec.length < 1.2 ? 0.2 : big ? 0.16 : 0.13));
  const widthK = big ? 0.95 : shark ? 0.78 : 0.6;
  const dorsalH = spec.features.includes("dorsal") ? R * 1.4 : spec.length < 1.2 ? R * 0.6 : 0;
  const finT = R >= 3 ? 2 : 1;
  const W = Math.ceil(R * widthK * 2) + 3, Hh = Math.ceil(R * 2 + dorsalH) + 3;
  const g = new VoxelGrid(W, Hh, L + 1);
  const cx = W / 2, cy = R + 1;
  const main = g.color(col(spec.colors.main)), back = g.color(col(spec.colors.main, -1)), belly = g.color(col(spec.colors.belly));
  const dark = g.color(col(spec.colors.accent)), white = g.color(col("neutral8"));
  const radius = (t: number) => {
    // t: 0 at the tail end, 1 at the nose. Thickest at 60%, blunt rounded nose, thin tail stalk.
    if (t < 0.6) return R * (0.14 + 0.86 * Math.pow(Math.sin((t / 0.6) * Math.PI / 2), 0.8));
    return R * Math.pow(Math.cos(((t - 0.6) / 0.4) * Math.PI / 2), 0.55);
  };
  for (let z = 0; z <= L; z++) {
    const t = z / L, r = radius(t);
    if (r < 0.5) continue;
    // Snout tilts slightly up, belly slightly fuller: cross-section centre shifts with t.
    const yc = cy + (t > 0.8 ? (t - 0.8) * R * 0.5 : 0);
    for (let y = Math.floor(yc - r); y <= Math.ceil(yc + r); y++)
      for (let x = Math.floor(cx - r * widthK); x <= Math.ceil(cx + r * widthK); x++) {
        const dx = (x + 0.5 - cx) / (r * widthK), dy = (y + 0.5 - yc) / r;
        if (dx * dx + dy * dy > 1) continue;
        const rel = (y + 0.5 - yc) / r;
        g.set(x, y, z, rel < -0.25 ? belly : rel > 0.55 ? back : main);
      }
  }
  // Dorsal fin: swept back, on top around 45–60% of the length.
  if (dorsalH > 0) {
    const top = (z: number) => { for (let y = g.h - 1; y >= 0; y--) if (g.get(Math.floor(cx), y, z)) return y; return cy; };
    const front = Math.round(L * 0.6), rear = Math.round(L * 0.44);
    const base = top(Math.round(L * 0.52));
    triangle(g, [2, 1], [rear, base - 1], [front, base - 1], [rear - L * 0.05, base + dorsalH], Math.floor(cx) - (finT - 1), finT, back);
  }
  // Eyes: dark with a light glint, high on the head so they read from the side and the front.
  const eyeZ = Math.round(L * 0.86), eyeY = Math.round(cy + radius(0.86) * 0.3);
  for (const side of [1, -1] as const) {
    const x = surfaceX(g, eyeY, eyeZ, side);
    if (x < 0) continue;
    g.set(x, eyeY, eyeZ, dark);
    if (R >= 4) { g.set(x, eyeY + 1, eyeZ, dark); g.set(x, eyeY, eyeZ - 1, dark); g.set(x, eyeY + 1, eyeZ - 1, white); }
    // Gill slits behind the head.
    if (spec.features.includes("gills"))
      for (let k = 0; k < 3; k++) {
        const z = Math.round(L * 0.72) - k * Math.max(2, Math.round(R * 0.35));
        for (let y = Math.round(cy - radius(0.72) * 0.35); y <= Math.round(cy + radius(0.72) * 0.25); y++) {
          const gx = surfaceX(g, y, z, side);
          if (gx >= 0) g.set(gx, y, z, back);
        }
      }
  }
  // Mouth: a dark line low on each side of the head, curving down at the back; teeth along it for predators.
  if (spec.features.includes("teeth") || shark) {
    const z0 = Math.round(L * 0.78), z1 = Math.round(L * 0.94);
    for (let z = z0; z <= z1; z++) {
      const t = z / L, r = radius(t);
      const y = Math.round(cy - r * (0.42 + 0.25 * (1 - (z - z0) / Math.max(1, z1 - z0))));
      for (const side of [1, -1] as const) {
        const x = surfaceX(g, y, z, side);
        if (x < 0) continue;
        g.set(x, y, z, dark);
        if (spec.features.includes("teeth") && (z - z0) % 2 === 0 && R >= 3) g.set(x, y + 1, z, white);
      }
    }
  }
  const parts: VoxelPart[] = [{ name: "body", grid: g, origin: [0, 0, 0], pivot: [cx, cy, L * 0.5], anim: "body" }];

  // Tail fin: vertical crescent for fish and sharks (upper lobe longer for sharks), horizontal flukes for whales.
  const tl = Math.max(4, Math.round(R * 2.1));
  if (flukes) {
    const t = new VoxelGrid(Math.ceil(R * 3.2) + 2, 2, tl + 1);
    const c = t.color(col(spec.colors.main, -1));
    const mx = t.w / 2;
    triangle(t, [0, 2], [mx - 1, tl], [mx + 1, tl], [0, 0], 0, 2, c);
    triangle(t, [0, 2], [mx - 1, tl], [mx + 1, tl], [t.w - 1, 0], 0, 2, c);
    parts.push({ name: "tail", grid: t, origin: [cx - t.w / 2, cy - 1, -tl], pivot: [cx, cy, 0], anim: "tail" });
  } else {
    const up = shark ? R * 2.3 : R * 1.5, down = shark ? R * 1.3 : R * 1.5;
    const th = Math.ceil(up + down) + 3;
    const t = new VoxelGrid(finT, th, tl + 1);
    const c = t.color(col(spec.colors.main, -1));
    const by = Math.round(down) + 1;
    // Each lobe is a broad triangle from the tail stalk to its tip, with a notch between the lobes.
    triangle(t, [2, 1], [tl, by - R * 0.15], [tl - tl * 0.25, by + R * 0.7], [tl - (shark ? tl : tl * 0.85), by + up], 0, t.w, c);
    triangle(t, [2, 1], [tl, by + R * 0.15], [tl - tl * 0.25, by - R * 0.55], [tl - tl * 0.75, by - down], 0, t.w, c);
    triangle(t, [2, 1], [tl, by - R * 0.3], [tl, by + R * 0.3], [tl - tl * 0.3, by], 0, t.w, c);
    parts.push({ name: "tail", grid: t, origin: [cx - t.w / 2, cy - by, -tl], pivot: [cx, cy, 0], anim: "tail" });
  }

  // Pectoral fins: flat, angled down and back, so the fish reads from above and below.
  const fl = Math.max(3, Math.round(R * (shark ? 1.4 : 0.9) * (spec.features.includes("bigFins") ? 1.5 : 1)));
  for (const side of [1, -1] as const) {
    const f = new VoxelGrid(fl + 1, 1, fl + 1);
    const c = f.color(col(spec.colors.main, -1));
    const baseX = side > 0 ? 0 : fl;
    triangle(f, [0, 2], [baseX, fl], [baseX, fl * 0.35], [side > 0 ? fl : 0, 0], 0, 1, c);
    const z0 = Math.round(L * 0.58) - fl;
    const x0 = side > 0 ? cx + R * widthK * 0.7 : cx - R * widthK * 0.7 - (fl + 1);
    parts.push({ name: side > 0 ? "finL" : "finR", grid: f, origin: [x0, cy - R * 0.45, z0], pivot: [side > 0 ? x0 : x0 + fl + 1, cy - R * 0.45, z0 + fl], anim: side > 0 ? "finL" : "finR" });
  }
  return parts;
}

// ------------------------------------------------------------------ bird (birds, dragons)

function bird(ctx: Ctx, L: number): VoxelPart[] {
  const { spec, col } = ctx;
  const dragon = spec.features.includes("horns") || spec.features.includes("spines");
  const R = Math.max(2, L * (dragon ? 0.15 : 0.2));
  const W = Math.ceil(R * 2) + 4, H = Math.ceil(R * 3.2) + 4;
  const g = new VoxelGrid(W, H, L + 1);
  const cx = W / 2, cy = R + 1;
  const main = g.color(col(spec.colors.main)), back = g.color(col(spec.colors.main, -1)), belly = g.color(col(spec.colors.belly));
  const accent = g.color(col(spec.colors.accent)), beak = g.color(col(dragon ? spec.colors.belly : "yellow3")), white = g.color(col("neutral8"));
  const bodyEnd = dragon ? 0.7 : 0.72;
  // Body: an egg shape; dragons get a long tail tapering behind.
  const bodyLen = L * (dragon ? 0.45 : 0.6), bodyMid = L * (dragon ? 0.5 : 0.45);
  g.ellipsoid(cx, cy, bodyMid, R * 0.85, R, bodyLen / 2, (x, y) => ((y + 0.5 - cy) / R < -0.2 ? belly : (y + 0.5 - cy) / R > 0.5 ? back : main));
  if (dragon) for (let z = 0; z < L * 0.3; z++) { const r = Math.max(0.6, (z / (L * 0.3)) * R * 0.6); g.ellipsoid(cx, cy + r * 0.2, z, r, r, 1, back); }
  else { const tl = Math.round(L * 0.25); triangle(g, [0, 2], [cx - R * 0.8, 0], [cx + R * 0.8, 0], [cx, tl], Math.round(cy), 1, back); }
  // Head and neck.
  const hz = L * bodyEnd + R * 0.4, hy = cy + R * (dragon ? 1.1 : 0.8), hr = R * (dragon ? 0.75 : 0.62);
  if (dragon) for (let k = 0; k <= 6; k++) g.ellipsoid(cx, cy + (hy - cy) * k / 6, L * 0.62 + (hz - L * 0.62) * k / 6, R * 0.45, R * 0.45, R * 0.45, main);
  g.ellipsoid(cx, hy, hz, hr, hr, hr * (dragon ? 1.4 : 1), main);
  // Beak / snout.
  const bl = Math.max(2, Math.round(hr * (dragon ? 1.2 : 0.9)));
  for (let k = 0; k < bl; k++) {
    const s = Math.max(0.5, hr * 0.45 * (1 - k / bl));
    g.ellipsoid(cx, hy - hr * 0.2, Math.min(L, hz + hr * 0.8 + k), s, s * 0.8, 0.6, beak);
  }
  // Eyes.
  for (const side of [1, -1] as const) {
    const y = Math.round(hy + hr * 0.2), z = Math.round(hz + hr * 0.3);
    const x = surfaceX(g, y, z, side);
    if (x >= 0) { g.set(x, y, z, accent); if (hr >= 3) g.set(x, y + 1, z, white); }
  }
  if (spec.features.includes("horns"))
    for (const side of [1, -1] as const) triangle(g, [2, 1], [hz - hr * 0.6, hy + hr * 0.6], [hz, hy + hr * 0.6], [hz - hr * 1.4, hy + hr * 1.9], Math.round(cx + side * hr * 0.5), 1, accent);
  if (spec.features.includes("spines"))
    for (let z = Math.round(L * 0.1); z < L * 0.65; z += 3) {
      const top = (() => { for (let y = g.h - 1; y >= 0; y--) if (g.get(Math.floor(cx), y, z)) return y; return -1; })();
      if (top > 0) { g.set(Math.floor(cx), top + 1, z, accent); g.set(Math.floor(cx), top + 2, z, accent); }
    }
  const parts: VoxelPart[] = [{ name: "body", grid: g, origin: [0, 0, 0], pivot: [cx, cy, L * 0.5], anim: "body" }];
  // Wings: long flat plates with a feathered (or webbed) trailing edge.
  const span = Math.round(L * (dragon ? 0.75 : 0.9)), chord = Math.round(L * (dragon ? 0.4 : 0.32));
  for (const side of [1, -1] as const) {
    const thick = span > 20 ? 2 : 1;
    const w = new VoxelGrid(span + 1, thick, chord + 1);
    const c = w.color(col(spec.colors.main, -1)), tip = w.color(col(dragon ? spec.colors.belly : spec.colors.accent));
    const root = side > 0 ? 0 : span;
    triangle(w, [0, 2], [root, 0], [root, chord], [side > 0 ? span : 0, chord * 0.75], 0, thick, c);
    w.paint((x) => (side > 0 ? x > span * 0.75 : x < span * 0.25), tip);
    const z0 = L * 0.48 - chord / 2;
    const x0 = side > 0 ? cx + R * 0.7 : cx - R * 0.7 - (span + 1);
    parts.push({ name: side > 0 ? "wingL" : "wingR", grid: w, origin: [x0, cy + R * 0.4, z0], pivot: [side > 0 ? x0 : x0 + span + 1, cy + R * 0.4, z0 + chord / 2], anim: side > 0 ? "wingL" : "wingR" });
  }
  return parts;
}

// ------------------------------------------------------------------ quadruped

function quadruped(ctx: Ctx, L: number): VoxelPart[] {
  const { spec, col, rand } = ctx;
  const bodyL = Math.round(L * 0.7), bodyW = Math.max(3, Math.round(L * 0.38)), bodyH = Math.max(3, Math.round(L * 0.34));
  const legH = Math.max(2, Math.round(L * 0.28)), legW = Math.max(1, Math.round(bodyW * 0.3));
  const parts: VoxelPart[] = [];
  const body = new VoxelGrid(bodyW, bodyH, bodyL);
  const main = body.color(col(spec.colors.main)), belly = body.color(col(spec.colors.belly)), accent = body.color(col(spec.colors.accent));
  body.ellipsoid(bodyW / 2, bodyH / 2, bodyL / 2, bodyW / 2 + 0.4, bodyH / 2 + 0.4, bodyL / 2 + 0.4, (_x, y) => (y < bodyH * 0.3 ? belly : main));
  if (spec.features.includes("spots")) for (let i = 0; i < 6; i++) body.ellipsoid(rand() * bodyW, bodyH * (0.4 + rand() * 0.6), rand() * bodyL, bodyW * 0.25, bodyH * 0.25, bodyL * 0.12, (x, y, z) => (body.get(x, y, z) ? belly : 0));
  if (spec.features.includes("stripes")) body.paint((_x, y, z) => y > bodyH * 0.4 && z % 3 === 0, accent);
  parts.push({ name: "body", grid: body, origin: [0, legH, 0], pivot: [bodyW / 2, legH, bodyL / 2], anim: "body" });
  for (const [lx, lz, anim] of [[0, bodyL - legW - 1, "legL"], [bodyW - legW, bodyL - legW - 1, "legR"], [0, 1, "legR"], [bodyW - legW, 1, "legL"]] as const) {
    const leg = new VoxelGrid(legW, legH + 1, legW);
    leg.box(0, 0, 0, legW - 1, legH, legW - 1, leg.color(col(spec.colors.main, -1)));
    leg.box(0, 0, 0, legW - 1, 0, legW - 1, leg.color(col(spec.colors.accent)));
    parts.push({ name: `leg${lx}${lz}`, grid: leg, origin: [lx, 0, lz], pivot: [lx + legW / 2, legH + 1, lz + legW / 2], anim });
  }
  // Head with eyes, snout, ears/horns.
  const hs = Math.max(3, Math.round(bodyW * 0.7));
  const head = new VoxelGrid(hs + 2, hs + 3, hs + 2);
  const hm = head.color(col(spec.colors.main)), hdark = head.color(col(spec.colors.accent)), hlight = head.color(col(spec.colors.belly)), white = head.color(col("neutral8"));
  head.box(1, 0, 0, hs, hs - 1, hs - 1, hm);
  const snoutW = Math.max(2, Math.round(hs * 0.5));
  head.box(Math.round(1 + (hs - snoutW) / 2), 0, hs, Math.round((hs + snoutW) / 2), Math.max(1, Math.round(hs * 0.4)), hs + (spec.features.includes("snout") ? 0 : 1), spec.features.includes("snout") ? head.color(col(spec.colors.accent, 1)) : hlight);
  for (const ex of [1 + Math.round(hs * 0.2), Math.round(hs * 0.8)]) { head.set(ex, Math.round(hs * 0.6), hs - 1, hdark); if (hs >= 5) head.set(ex, Math.round(hs * 0.6) + 1, hs - 1, white); }
  if (spec.features.includes("ears")) { head.box(1, hs, 1, 1 + Math.max(0, Math.round(hs * 0.2)), hs + 1, 2, hm); head.box(hs - Math.round(hs * 0.2), hs, 1, hs, hs + 1, 2, hm); }
  if (spec.features.includes("horns")) { head.box(0, hs - 1, 1, 0, hs + 1, 1, white); head.box(hs + 1, hs - 1, 1, hs + 1, hs + 1, 1, white); }
  if (spec.features.includes("mane")) head.box(Math.round(hs / 2), hs - 1, 0, Math.round(hs / 2) + 1, hs, hs - 2, hdark);
  parts.push({ name: "head", grid: head, origin: [bodyW / 2 - (hs + 2) / 2, legH + bodyH * 0.55, bodyL - 1], pivot: [bodyW / 2, legH + bodyH * 0.6, bodyL], anim: "head" });
  // Tail.
  const tl = Math.max(2, Math.round(L * 0.2));
  const tail = new VoxelGrid(1, 1, tl);
  tail.box(0, 0, 0, 0, 0, tl - 1, tail.color(col(spec.colors.main, -1)));
  parts.push({ name: "tail", grid: tail, origin: [bodyW / 2 - 0.5, legH + bodyH * 0.7, -tl], pivot: [bodyW / 2, legH + bodyH * 0.7, 0], anim: "tail" });
  return parts;
}

// ------------------------------------------------------------------ blob (slimes, jellyfish, ghosts)

function blob(ctx: Ctx, L: number): VoxelPart[] {
  const { spec, col } = ctx;
  const tentacles = spec.features.includes("tentacles");
  const H = Math.round(L * (tentacles ? 1.3 : 0.9)), W = L;
  const g = new VoxelGrid(W + 2, H + 2, W + 2);
  const main = g.color(col(spec.colors.main)), light = g.color(col(spec.colors.belly)), dark = g.color(col(spec.colors.accent));
  const c = W / 2 + 1;
  if (tentacles) {
    const domeY = H * 0.55;
    g.ellipsoid(c, domeY, c, W / 2, H * 0.4, W / 2, (_x, y) => (y > domeY + H * 0.2 ? light : main));
    for (let y = 0; y < domeY; y++) for (let z = 0; z < g.d; z++) for (let x = 0; x < g.w; x++) if (y < domeY - 1 && g.get(x, y, z) && y < domeY - H * 0.05) g.set(x, y, z, 0);
    const n = Math.max(4, Math.round(W / 2));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const tx = Math.round(c + Math.cos(a) * W * 0.32), tz = Math.round(c + Math.sin(a) * W * 0.32);
      for (let y = Math.round(domeY) - 1; y >= 0; y--) g.set(tx + (y % 4 === 0 ? 1 : 0), y, tz, y % 3 === 0 ? light : main);
    }
  } else {
    // Rounded cube (superellipse).
    for (let y = 0; y < H; y++) for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) {
      const dx = Math.abs((x + 0.5) / W * 2 - 1), dy = Math.abs((y + 0.5) / H * 2 - 1), dz = Math.abs((z + 0.5) / W * 2 - 1);
      if (dx ** 4 + dy ** 4 + dz ** 4 <= 1) g.set(x + 1, y + 1, z + 1, y < H * 0.25 ? light : main);
    }
  }
  // Face on the +Z side.
  const fz = (() => { for (let z = g.d - 1; z >= 0; z--) if (g.get(Math.round(c), Math.round(tentacles ? H * 0.6 : H * 0.6), z)) return z; return g.d - 1; })();
  const ey = Math.round(tentacles ? H * 0.62 : H * 0.6), off = Math.max(1, Math.round(W * 0.18));
  for (const ex of [Math.round(c - off), Math.round(c + off)]) { g.set(ex, ey, fz, dark); if (W >= 8) g.set(ex, ey + 1, fz, dark); }
  if (!tentacles) for (let x = Math.round(c - off * 0.6); x <= Math.round(c + off * 0.6); x++) g.set(x, Math.round(H * 0.38), fz, dark);
  return [{ name: "body", grid: g, origin: [0, 0, 0], pivot: [c, 0, c], anim: "body" }];
}
