/**
 * The sculpted style: a shape's primitives as signed distance fields, combined in order
 * (smooth unions, smooth cuts) and meshed finely with surface nets. Joins blend into each other
 * instead of meeting at a crease (a neck flowing into a body), surfaces are exact rather than
 * traced from voxels, and colours and finishes come from whichever primitive owns the surface.
 *
 * Primitives are stored on each voxel part in that part's grid coordinates (voxel units from its
 * corner), so the sculpted mesh lines up exactly with the voxel model used for gameplay.
 */
import { meshField } from "./mesh";
import type { MeshData, VoxelPart } from "./voxel";

export interface SdfPrim {
  type: "box" | "ellipsoid" | "cylinder" | "cone" | "capsule" | "torus" | "wedge";
  axis: "x" | "y" | "z";
  /** Centre, in the part's grid coordinates. */
  c: [number, number, number];
  /** Half sizes (local x, y, z), in voxels. */
  half: [number, number, number];
  /** Rotation, row-major (local → grid). */
  rot: number[];
  rgb: [number, number, number];
  finish: number;
  cut: boolean;
  /** Smooth-join radius, in voxels (0: a hard join). */
  blend: number;
  /** Bounds in grid coordinates, grown by the blend. */
  min: [number, number, number];
  max: [number, number, number];
}

function len3(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

/** Distance from a point in the primitive's local frame to its surface (negative inside). */
export function primDistance(p: SdfPrim, lx: number, ly: number, lz: number): number {
  // Turn the frame so the primitive's axis is v (the second coordinate), like the voxel builder.
  let u = lx, v = ly, w = lz, a = p.half[0], b = p.half[1], c = p.half[2];
  if (p.axis === "x") { u = ly; v = lx; a = p.half[1]; b = p.half[0]; }
  else if (p.axis === "z") { v = lz; w = ly; b = p.half[2]; c = p.half[1]; }
  switch (p.type) {
    case "box": {
      const qx = Math.abs(u) - a, qy = Math.abs(v) - b, qz = Math.abs(w) - c;
      return len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
    }
    case "ellipsoid": return ellipsoid(u, v, w, a, b, c);
    case "cylinder": return box2((Math.hypot(u / a, w / c) - 1) * Math.min(a, c), Math.abs(v) - b);
    case "cone": {
      // Base at −axis, tip at +axis.
      const r = Math.min(a, c);
      const s = Math.min(1, Math.max(0, (b - v) / (2 * b)));
      const slope = 1 / Math.sqrt(1 + (r / (2 * b)) ** 2);
      return box2((Math.hypot(u / a, w / c) - s) * r * slope, Math.abs(v) - b);
    }
    case "capsule": {
      const hc = Math.min(b, Math.min(a, c));
      const vv = v - Math.max(-(b - hc), Math.min(b - hc, v));
      return ellipsoid(u, vv, w, a, hc, c);
    }
    case "torus": {
      const rad = Math.hypot(u / a, w / c);
      return (Math.hypot((rad - 0.5) / 0.5, v / b) - 1) * Math.min(0.5 * Math.min(a, c), b);
    }
    case "wedge": {
      const qx = Math.abs(u) - a, qy = Math.abs(v) - b, qz = Math.abs(w) - c;
      const boxD = len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
      // Full height at the back (−z), down to an edge at the front: inside where v/b + w/c ≤ 0.
      const plane = (v / b + w / c) / Math.sqrt(1 / (b * b) + 1 / (c * c));
      return Math.max(boxD, plane);
    }
  }
}

function box2(r: number, ax: number): number {
  return Math.hypot(Math.max(r, 0), Math.max(ax, 0)) + Math.min(Math.max(r, ax), 0);
}

function ellipsoid(x: number, y: number, z: number, rx: number, ry: number, rz: number): number {
  const k0 = len3(x / rx, y / ry, z / rz), k1 = len3(x / (rx * rx), y / (ry * ry), z / (rz * rz));
  return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(rx, ry, rz);
}

const smin = (a: number, b: number, k: number) => {
  if (a === Infinity) return b;
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
};

/** Distance to one primitive from a point in grid coordinates. */
function distanceTo(p: SdfPrim, x: number, y: number, z: number): number {
  const dx = x - p.c[0], dy = y - p.c[1], dz = z - p.c[2], r = p.rot;
  return primDistance(p, r[0] * dx + r[3] * dy + r[6] * dz, r[1] * dx + r[4] * dy + r[7] * dz, r[2] * dx + r[5] * dy + r[8] * dz);
}

/** How far a point is outside a primitive's bounds (a lower bound on its distance). */
function outside(p: SdfPrim, x: number, y: number, z: number): number {
  const ox = Math.max(p.min[0] - x, 0, x - p.max[0]), oy = Math.max(p.min[1] - y, 0, y - p.max[1]), oz = Math.max(p.min[2] - z, 0, z - p.max[2]);
  return len3(ox, oy, oz);
}

/** The part's signed distance at a point: primitives combined in order (later cuts carve). */
export function partDistance(prims: SdfPrim[], x: number, y: number, z: number): number {
  let d = Infinity;
  for (const p of prims) {
    const lb = outside(p, x, y, z);
    if (!p.cut) {
      if (lb > d + p.blend) continue; // can't change the union
      d = smin(d, distanceTo(p, x, y, z), p.blend);
    } else {
      if (d === Infinity || lb >= p.blend - d) continue; // too far away to carve anything here
      d = -smin(-d, distanceTo(p, x, y, z), p.blend);
    }
  }
  return d;
}

/**
 * The part's distance field sampled `scale` times per voxel. Exact distances are only worked out
 * near the surface: a coarse pass (one sample per voxel) is interpolated everywhere else.
 */
function sample(prims: SdfPrim[], g: { w: number; h: number; d: number }, scale: number) {
  const o = -1;
  const cw = g.w + 3, ch = g.h + 3, cd = g.d + 3;
  const coarse = new Float32Array(cw * ch * cd);
  for (let y = 0; y < ch; y++) for (let z = 0; z < cd; z++) for (let x = 0; x < cw; x++) {
    const dist = partDistance(prims, o + x, o + y, o + z);
    coarse[(y * cd + z) * cw + x] = dist === Infinity ? 1e3 : dist;
  }
  const step = 1 / scale;
  const w = Math.ceil((g.w + 2) * scale) + 1, h = Math.ceil((g.h + 2) * scale) + 1, d = Math.ceil((g.d + 2) * scale) + 1;
  const f = new Float32Array(w * h * d);
  const C = (x: number, y: number, z: number) => coarse[(Math.min(ch - 1, y) * cd + Math.min(cd - 1, z)) * cw + Math.min(cw - 1, x)];
  const BAND = 1.8;
  for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
    const px = x * step, py = y * step, pz = z * step; // relative to the coarse grid's origin
    const x0 = Math.floor(px), y0 = Math.floor(py), z0 = Math.floor(pz);
    const tx = px - x0, ty = py - y0, tz = pz - z0;
    const c00 = C(x0, y0, z0) * (1 - tx) + C(x0 + 1, y0, z0) * tx, c10 = C(x0, y0 + 1, z0) * (1 - tx) + C(x0 + 1, y0 + 1, z0) * tx;
    const c01 = C(x0, y0, z0 + 1) * (1 - tx) + C(x0 + 1, y0, z0 + 1) * tx, c11 = C(x0, y0 + 1, z0 + 1) * (1 - tx) + C(x0 + 1, y0 + 1, z0 + 1) * tx;
    let dist = (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz;
    if (Math.abs(dist) < BAND) { const e = partDistance(prims, o + px, o + py, o + pz); dist = e === Infinity ? 1e3 : e; }
    f[(y * d + z) * w + x] = -dist;
  }
  return { f, w, h, d, step, o };
}

/** Mesh a part from its primitives, sampling `scale` times per voxel. */
export function sculptPart(part: VoxelPart, scale: number): MeshData {
  const prims = part.sdf!;
  const { f, w, h, d, step, o } = sample(prims, part.grid, scale);
  return meshField({
    f, w, h, d, iso: 0, smooth: 1, flat: false, vertexPaint: true,
    toOut: (x, y, z) => [o + x * step, o + y * step, o + z * step],
    // Like the voxel model: step a little inside the surface (against the normal) and take the last
    // solid primitive that contains that point (later ones paint over earlier ones). Borders follow
    // the primitives' own shapes instead of flickering where surfaces nearly coincide.
    paint: (x, y, z) => {
      const e = 0.25;
      let nx = partDistance(prims, x + e, y, z) - partDistance(prims, x - e, y, z);
      let ny = partDistance(prims, x, y + e, z) - partDistance(prims, x, y - e, z);
      let nz = partDistance(prims, x, y, z + e) - partDistance(prims, x, y, z - e);
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const depth = 0.45;
      const qx = x - nx * depth, qy = y - ny * depth, qz = z - nz * depth;
      let owner: SdfPrim | null = null, near: SdfPrim | null = null, nd = Infinity;
      for (const p of prims) {
        if (p.cut) continue;
        const lb = outside(p, qx, qy, qz);
        if (lb > 0 && lb > nd) continue;
        const dq = distanceTo(p, qx, qy, qz);
        if (dq <= 0) owner = p;
        if (dq < nd) { nd = dq; near = p; }
      }
      const q = owner ?? near;
      return q ? [q.rgb[0], q.rgb[1], q.rgb[2], q.finish] : [0.5, 0.5, 0.5, 0];
    },
  });
}
