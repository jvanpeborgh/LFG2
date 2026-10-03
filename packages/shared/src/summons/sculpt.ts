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
  type: "box" | "ellipsoid" | "cylinder" | "cone" | "capsule" | "torus" | "wedge" | "tube";
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
  /** Paint only: colours the surface where it overlaps, adds no volume. */
  paint?: boolean;
  /** Smooth-join radius, in voxels (0: a hard join). */
  blend: number;
  /** Bounds in grid coordinates, grown by the blend. */
  min: [number, number, number];
  max: [number, number, number];
  /** Tubes: points along the path (x, y, z, … in grid coordinates) and the radius at each. */
  pts?: number[];
  radii?: number[];
  /** Rounded edges (voxels), a taper towards +axis (scale of the two other sides there), a twist along the axis (radians). */
  round?: number;
  taper?: [number, number];
  twist?: number;
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
  if (!p.twist && !p.taper && !p.round) return shapeDistance(p.type, u, v, w, a, b, c);
  // Modifiers bend space before measuring: twist turns the cross-section along the axis, taper
  // scales it, and rounding shrinks the shape and grows it back with round edges.
  const t = Math.min(1, Math.max(0, (v / b + 1) / 2));
  if (p.twist) {
    const ang = p.twist * (t - 0.5), cs = Math.cos(ang), sn = Math.sin(ang);
    const uu = u * cs - w * sn;
    w = u * sn + w * cs;
    u = uu;
  }
  let fix = 1;
  if (p.taper) {
    const su = 1 + (p.taper[0] - 1) * t, sw = 1 + (p.taper[1] - 1) * t;
    u /= Math.max(0.05, su);
    w /= Math.max(0.05, sw);
    fix = Math.max(0.05, Math.min(su, sw, 1));
  }
  const r = Math.min(p.round ?? 0, a * 0.9, b * 0.9, c * 0.9);
  return shapeDistance(p.type, u, v, w, a - r, b - r, c - r) * fix - r;
}

function shapeDistance(type: SdfPrim["type"], u: number, v: number, w: number, a: number, b: number, c: number): number {
  switch (type) {
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
    case "tube": return Infinity; // measured along its path (tubeDistance)
  }
}

/** Distance to a tube: round cones between consecutive points, each with its own radius. */
function tubeDistance(p: SdfPrim, x: number, y: number, z: number): number {
  const q = p.pts!, rr = p.radii!;
  let best = Infinity;
  for (let seg = 0; seg + 1 < rr.length; seg++) {
    const i = seg * 3;
    const ax = q[i], ay = q[i + 1], az = q[i + 2], bx = q[i + 3], by = q[i + 4], bz = q[i + 5];
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const l2 = dx * dx + dy * dy + dz * dz || 1e-9;
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / l2));
    const r = rr[i / 3] + (rr[i / 3 + 1] - rr[i / 3]) * t;
    const d = len3(x - (ax + dx * t), y - (ay + dy * t), z - (az + dz * t)) - r;
    if (d < best) best = d;
  }
  return best;
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
export function distanceTo(p: SdfPrim, x: number, y: number, z: number): number {
  if (p.type === "tube") return tubeDistance(p, x, y, z);
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
    if (p.paint) continue;
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
  const all = part.sdf!;
  // Details too small for the sampling grid (a small creature's eyes and nose: a few samples
  // across) would melt into the surface and smear their colour; they become little meshes of
  // their own, exact at any size.
  const extent = Math.max(part.grid.w, part.grid.h, part.grid.d);
  const solid = all.filter((p) => !p.cut && !p.paint);
  // Only details in a colour of their own (eyes, noses): a same-coloured bump (a brow, a paw) is
  // part of the surface and should blend into it.
  const skin = solid[0]?.rgb;
  const same = (p: SdfPrim) => !!skin && Math.abs(p.rgb[0] - skin[0]) + Math.abs(p.rgb[1] - skin[1]) + Math.abs(p.rgb[2] - skin[2]) < 0.06;
  const details = solid.length > 2 ? solid.filter((p) => p.type === "ellipsoid" && !same(p) && Math.max(...p.half) * scale < 2.6 && Math.max(...p.half) < extent * 0.2) : [];
  const prims = details.length ? all.filter((p) => !details.includes(p)) : all;
  const { f, w, h, d, step, o } = sample(prims, part.grid, scale);
  const surface = meshField({
    f, w, h, d, iso: 0, smooth: 1, flat: false, vertexPaint: true,
    // Baked occlusion from the distance field: step out along the normal; where the field says
    // something is closer than the step, light is blocked (creases, under the chin, between legs).
    occlusion: (x, y, z, nx, ny, nz) => {
      let occ = 0, wgt = 0.5;
      for (let i = 1; i <= 5; i++) {
        const hgt = i * 0.9;
        const dd = partDistance(prims, x + nx * hgt, y + ny * hgt, z + nz * hgt);
        occ += wgt * Math.max(0, hgt - (dd === Infinity ? hgt : dd)) / hgt;
        wgt *= 0.6;
      }
      return Math.max(0.45, 1 - occ * 0.9);
    },
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
      // Measured in samples, not voxels: at fine detail (small creatures) a fixed half-voxel would
      // reach through an eye and smear it across the face.
      const k = Math.min(1, step * 1.4);
      const depth = 0.45 * k;
      const qx = x - nx * depth, qy = y - ny * depth, qz = z - nz * depth;
      // Anti-aliased borders: the topmost primitive within `soft` of the point blends over the
      // colour beneath it, by how far inside it the point is, instead of switching per vertex.
      const soft = 0.35 * k;
      let top: SdfPrim | null = null, topD = Infinity, topSoft = soft, base: SdfPrim | null = null, near: SdfPrim | null = null, nd = Infinity;
      for (const p of prims) {
        if (p.cut) continue;
        // Paint with a blend fades in over that distance: countershading, gradients, soft markings.
        const ps = p.paint && p.blend > soft ? p.blend : soft;
        const lb = outside(p, qx, qy, qz);
        if (lb > ps && lb > nd) continue;
        const dq = distanceTo(p, qx, qy, qz);
        if (dq <= ps) {
          // A later primitive paints over: the previous top becomes the base if it really contains the point.
          if (top && topD <= 0) base = top;
          top = p; topD = dq; topSoft = ps;
        }
        if (dq < nd) { nd = dq; near = p; }
      }
      if (!top) top = near;
      if (!top) return [0.5, 0.5, 0.5, 0];
      const under = base ?? (top !== near && near ? near : null);
      const wgt = under ? Math.min(1, Math.max(0, (topSoft - topD) / (2 * topSoft))) : 1;
      const q = wgt >= 0.5 || !under ? top : under;
      // A faint mottle (low-frequency value noise), so large surfaces read as skin, fur or stone
      // rather than plastic. Glowing surfaces stay even.
      const m = q.finish === 3 ? 1 : 1 + 0.07 * mottle(x * 0.3 * step, y * 0.3 * step, z * 0.3 * step);
      if (!under || wgt >= 1) return [top.rgb[0] * m, top.rgb[1] * m, top.rgb[2] * m, top.finish];
      return [
        (under.rgb[0] + (top.rgb[0] - under.rgb[0]) * wgt) * m, (under.rgb[1] + (top.rgb[1] - under.rgb[1]) * wgt) * m, (under.rgb[2] + (top.rgb[2] - under.rgb[2]) * wgt) * m, q.finish,
      ];
    },
  });
  return details.length ? withEllipsoids(surface, details, scale) : surface;
}

/** Smooth value noise in [-1, 1] (trilinear over hashed lattice values). */
function mottle(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const h = (i: number, j: number, k: number) => {
    let n = (i * 374761393 + j * 668265263 + k * 2147483647) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) & 0xffff) / 32767.5 - 1;
  };
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
    l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}

/** Append small ellipsoid meshes (in the part's grid coordinates) to a sculpted surface. */
function withEllipsoids(m: MeshData, prims: SdfPrim[], scale: number): MeshData {
  const pos: number[] = [], nrm: number[] = [], col: number[] = [], fin: number[] = [];
  for (const p of prims) {
    // As round as it needs to be at this size: 6 segments for a speck, 12 for a big eye.
    const SEG = Math.max(6, Math.min(12, Math.round(Math.max(...p.half) * scale * 5))), RINGS = Math.max(4, Math.round(SEG * 0.6));
    const R = p.rot, [a, b, c] = p.half;
    const vert = (th: number, ph: number) => {
      const u = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
      const l = [u[0] * a, u[1] * b, u[2] * c];
      let n = [u[0] / a, u[1] / b, u[2] / c];
      const g = [0, 1, 2].map((i) => p.c[i] + R[i * 3] * l[0] + R[i * 3 + 1] * l[1] + R[i * 3 + 2] * l[2]);
      n = [0, 1, 2].map((i) => R[i * 3] * n[0] + R[i * 3 + 1] * n[1] + R[i * 3 + 2] * n[2]);
      const nl = Math.hypot(n[0], n[1], n[2]) || 1;
      return { g, n: n.map((x) => x / nl) };
    };
    for (let r = 0; r < RINGS; r++) for (let sgm = 0; sgm < SEG; sgm++) {
      const t0 = (r / RINGS) * Math.PI, t1 = ((r + 1) / RINGS) * Math.PI;
      const p0 = (sgm / SEG) * Math.PI * 2, p1 = ((sgm + 1) / SEG) * Math.PI * 2;
      const q = [vert(t0, p0), vert(t1, p0), vert(t1, p1), vert(t0, p1)];
      for (const tri of [[q[0], q[1], q[2]], [q[0], q[2], q[3]]]) {
        // Wind each triangle to face outwards (along its vertices' normals).
        const [A, B, C] = tri;
        const ux = B.g[0] - A.g[0], uy = B.g[1] - A.g[1], uz = B.g[2] - A.g[2];
        const wx = C.g[0] - A.g[0], wy = C.g[1] - A.g[1], wz = C.g[2] - A.g[2];
        const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
        if (fx * fx + fy * fy + fz * fz < 1e-14) continue;
        const out = fx * (A.n[0] + B.n[0] + C.n[0]) + fy * (A.n[1] + B.n[1] + C.n[1]) + fz * (A.n[2] + B.n[2] + C.n[2]) >= 0;
        for (const V of out ? [A, B, C] : [A, C, B]) { pos.push(...V.g); nrm.push(...V.n); col.push(...p.rgb); }
        fin.push(p.finish);
      }
    }
  }
  const n0 = m.positions.length / 3, n1 = pos.length / 3;
  const positions = new Float32Array((n0 + n1) * 3); positions.set(m.positions); positions.set(pos, n0 * 3);
  const normals = new Float32Array((n0 + n1) * 3); normals.set(m.normals); normals.set(nrm, n0 * 3);
  const colors = new Float32Array((n0 + n1) * 3); colors.set(m.colors); colors.set(col, n0 * 3);
  const indices = new Uint32Array(n0 + n1); for (let i = 0; i < indices.length; i++) indices[i] = i;
  const anyFinish = !!m.finishes || fin.some((x) => x);
  const finishes = anyFinish ? new Uint8Array((n0 + n1) / 3) : undefined;
  if (finishes) { if (m.finishes) finishes.set(m.finishes); finishes.set(fin, n0 / 3); }
  return { positions, normals, colors, indices, quads: m.quads + n1 / 6, ...(finishes ? { finishes } : {}) };
}
