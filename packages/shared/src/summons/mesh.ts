import { greedyMesh, type MeshData, type VoxelGrid, type VoxelModel } from "./voxel";
import { sculptPart } from "./sculpt";

/**
 * Model styles: the same model data drawn four ways. The world sets the default
 * (art.modelStyle); a prompt or design can choose its own if the world allows it
 * (art.promptStyles). Everyone sees a creature the same way:
 *
 *   voxel     greedy-meshed cubes (the default "Chunky Daylight" look)
 *   smooth    a smooth surface through the voxels (surface nets over a softened
 *             density field), with smooth normals and, where the triangle
 *             budget allows, twice the resolution: organic, higher-polygon
 *   lowpoly   the same surface at half resolution with flat-shaded facets
 *   sculpted  for designs written as shapes: the primitives themselves as
 *             distance fields, joined with smooth blends and meshed finely.
 *             A close-up version (up to locked.closeUp.multiplier × the
 *             budget) and a distant one that fits the budget. Models without
 *             a shape fall back to smooth.
 *
 * Every style keeps the parts (so animation works), the palette colours and
 * finishes, and picks the finest detail that fits the asset's triangle budget.
 */

export type ModelStyle = "voxel" | "smooth" | "lowpoly" | "sculpted";
export const MODEL_STYLES: ModelStyle[] = ["voxel", "smooth", "lowpoly", "sculpted"];

/** Style words a prompt can use ("a low-poly fox", "a sculpted dragon"). Narrow on purpose: "soft" stays a texture word. */
const PROMPT_STYLE_WORDS: [ModelStyle, RegExp][] = [
  ["sculpted", /\b(sculpted|high[- ]?(poly|detail)|figurine|statuette|porcelain)\b/],
  ["lowpoly", /\b(low[- ]?poly|faceted|origami|papercraft|polygonal)\b/],
  ["smooth", /\b(smooth|clay|claymation|plush)\b/],
  ["voxel", /\b(voxel|blocky|pixel(ated)?)\b/],
];

/** The drawing style a prompt asks for, if any. */
export function styleFromWords(text: string): ModelStyle | undefined {
  const t = text.toLowerCase();
  return PROMPT_STYLE_WORDS.find(([, re]) => re.test(t))?.[0];
}

const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
};

/** Occupancy softened with a separable [1,2,1] blur, sampled at `scale`× the grid's resolution. */
function density(g: VoxelGrid, scale: number): { f: Float32Array; w: number; h: number; d: number } {
  // Pad by 2 so the surface closes at the edges.
  const P = 2;
  const W = g.w + P * 2, H = g.h + P * 2, D = g.d + P * 2;
  let a = new Float32Array(W * H * D);
  for (let y = 0; y < g.h; y++) for (let z = 0; z < g.d; z++) for (let x = 0; x < g.w; x++)
    if (g.get(x, y, z)) a[((y + P) * D + (z + P)) * W + (x + P)] = 1;
  const blur = (src: Float32Array, axis: 0 | 1 | 2) => {
    const out = new Float32Array(src.length);
    const stride = axis === 0 ? 1 : axis === 1 ? W * D : W;
    const len = axis === 0 ? W : axis === 1 ? H : D;
    for (let i = 0; i < src.length; i++) {
      const c = axis === 0 ? i % W : axis === 1 ? Math.floor(i / (W * D)) : Math.floor(i / W) % D;
      const l = c > 0 ? src[i - stride] : 0, r = c < len - 1 ? src[i + stride] : 0;
      out[i] = (l + 2 * src[i] + r) / 4;
    }
    return out;
  };
  const solid = a.slice();
  a = blur(blur(blur(a, 0), 1), 2);
  // Thin parts (fins, tails, one voxel thick) would blur away: every solid voxel stays inside the surface.
  for (let i = 0; i < a.length; i++) if (solid[i]) a[i] = Math.max(a[i], 0.6);
  if (scale === 1) return { f: a, w: W, h: H, d: D };
  // Resample (trilinear) to the requested resolution.
  const w = Math.max(2, Math.round(W * scale)), h = Math.max(2, Math.round(H * scale)), d = Math.max(2, Math.round(D * scale));
  const f = new Float32Array(w * h * d);
  const at = (x: number, y: number, z: number) => a[(Math.min(H - 1, y) * D + Math.min(D - 1, z)) * W + Math.min(W - 1, x)];
  const isSolid = (x: number, y: number, z: number) => solid[(Math.min(H - 1, y) * D + Math.min(D - 1, z)) * W + Math.min(W - 1, x)] > 0;
  for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
    const sx = (x + 0.5) / scale - 0.5, sy = (y + 0.5) / scale - 0.5, sz = (z + 0.5) / scale - 0.5;
    const x0 = Math.max(0, Math.floor(sx)), y0 = Math.max(0, Math.floor(sy)), z0 = Math.max(0, Math.floor(sz));
    const tx = Math.min(1, Math.max(0, sx - x0)), ty = Math.min(1, Math.max(0, sy - y0)), tz = Math.min(1, Math.max(0, sz - z0));
    const c00 = at(x0, y0, z0) * (1 - tx) + at(x0 + 1, y0, z0) * tx, c10 = at(x0, y0 + 1, z0) * (1 - tx) + at(x0 + 1, y0 + 1, z0) * tx;
    const c01 = at(x0, y0, z0 + 1) * (1 - tx) + at(x0 + 1, y0, z0 + 1) * tx, c11 = at(x0, y0 + 1, z0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1, z0 + 1) * tx;
    const v = (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz;
    // Keep samples that fall inside a solid voxel inside the surface (thin parts survive resampling).
    f[(y * d + z) * w + x] = isSolid(Math.round(sx), Math.round(sy), Math.round(sz)) ? Math.max(v, 0.6) : v;
  }
  return { f, w, h, d };
}

/** A scalar field to mesh: inside where f > iso. */
export interface Field {
  f: Float32Array;
  w: number;
  h: number;
  d: number;
  iso: number;
  /** Sample-grid coordinates (fractional) → output coordinates (grid voxel units). */
  toOut(x: number, y: number, z: number): [number, number, number];
  /** Colour (0..1) and finish of the surface at an output point. */
  paint(x: number, y: number, z: number): [number, number, number, number];
  /** Laplacian smoothing passes (0 for exact fields). */
  smooth: number;
  flat: boolean;
  /** Colour each vertex (borders follow the surface, softly) instead of each triangle (crisp, but jagged at fine detail). */
  vertexPaint?: boolean;
  /** How much light reaches a surface point (0..1) from its surroundings: creases and undersides darken (baked ambient occlusion). */
  occlusion?: (x: number, y: number, z: number, nx: number, ny: number, nz: number) => number;
}

/**
 * Surface nets: one vertex per cell the surface crosses (at the average of its edge
 * crossings), quads joining them across every sign-changing edge. Each triangle takes one
 * colour and finish from `paint` at its middle, so details stay crisp.
 */
export function meshField(F: Field): MeshData {
  const { f, w, h, d, iso } = F;
  const val = (x: number, y: number, z: number) => f[(y * d + z) * w + x];
  const vertIndex = new Int32Array(w * h * d).fill(-1);
  const vp: number[] = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const v = new Float64Array(8);
  for (let y = 0; y < h - 1; y++) for (let z = 0; z < d - 1; z++) for (let x = 0; x < w - 1; x++) {
    let inside = 0;
    for (let c = 0; c < 8; c++) { v[c] = val(x + corners[c][0], y + corners[c][1], z + corners[c][2]); if (v[c] > iso) inside++; }
    if (inside === 0 || inside === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [i, j] of edges) {
      if ((v[i] > iso) === (v[j] > iso)) continue;
      const t = (iso - v[i]) / (v[j] - v[i]);
      sx += corners[i][0] + (corners[j][0] - corners[i][0]) * t;
      sy += corners[i][1] + (corners[j][1] - corners[i][1]) * t;
      sz += corners[i][2] + (corners[j][2] - corners[i][2]) * t;
      n++;
    }
    vertIndex[(y * d + z) * w + x] = vp.length / 3;
    vp.push(...F.toOut(x + sx / n, y + sy / n, z + sz / n));
  }
  const quads: number[][] = [];
  for (let y = 1; y < h - 1; y++) for (let z = 1; z < d - 1; z++) for (let x = 1; x < w - 1; x++) {
    const a = val(x, y, z) > iso;
    for (let axis = 0; axis < 3; axis++) {
      const nx = x + (axis === 0 ? 1 : 0), ny = y + (axis === 1 ? 1 : 0), nz = z + (axis === 2 ? 1 : 0);
      if (nx >= w || ny >= h || nz >= d) continue;
      if (a === val(nx, ny, nz) > iso) continue;
      // The four cells around this edge.
      const cells = axis === 0 ? [[x, y - 1, z - 1], [x, y, z - 1], [x, y, z], [x, y - 1, z]]
        : axis === 1 ? [[x - 1, y, z - 1], [x - 1, y, z], [x, y, z], [x, y, z - 1]]
        : [[x - 1, y - 1, z], [x, y - 1, z], [x, y, z], [x - 1, y, z]];
      const ids = cells.map(([cx, cy, cz]) => vertIndex[(cy * d + cz) * w + cx]);
      if (ids.some((i) => i < 0)) continue;
      // Winding: outward from the solid side (the cell order above already turns the same way on every axis).
      quads.push(a ? ids : [...ids].reverse());
    }
  }
  if (F.smooth > 0) {
    // Laplacian smoothing over the surface for a softer, rounder look.
    const nb: number[][] = Array.from({ length: vp.length / 3 }, () => []);
    for (const q of quads) for (let i = 0; i < 4; i++) { nb[q[i]].push(q[(i + 1) % 4]); nb[q[i]].push(q[(i + 3) % 4]); }
    for (let it = 0; it < F.smooth; it++) {
      const next = vp.slice();
      nb.forEach((list, i) => {
        if (!list.length) return;
        let sx = 0, sy = 0, sz = 0;
        for (const j of list) { sx += vp[j * 3]; sy += vp[j * 3 + 1]; sz += vp[j * 3 + 2]; }
        next[i * 3] = vp[i * 3] * 0.5 + (sx / list.length) * 0.5;
        next[i * 3 + 1] = vp[i * 3 + 1] * 0.5 + (sy / list.length) * 0.5;
        next[i * 3 + 2] = vp[i * 3 + 2] * 0.5 + (sz / list.length) * 0.5;
      });
      for (let i = 0; i < vp.length; i++) vp[i] = next[i];
    }
  }
  // Triangles, with a smooth normal per vertex (or a flat one per facet).
  const tri: number[] = [];
  for (const [a, b, c, e] of quads) tri.push(a, b, c, a, c, e);
  const face = (i: number, j: number, k: number) => {
    const ux = vp[j * 3] - vp[i * 3], uy = vp[j * 3 + 1] - vp[i * 3 + 1], uz = vp[j * 3 + 2] - vp[i * 3 + 2];
    const wx = vp[k * 3] - vp[i * 3], wy = vp[k * 3 + 1] - vp[i * 3 + 1], wz = vp[k * 3 + 2] - vp[i * 3 + 2];
    return [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
  };
  const nor = new Float32Array(vp.length);
  if (!F.flat) {
    for (let t = 0; t < tri.length; t += 3) {
      const n = face(tri[t], tri[t + 1], tri[t + 2]);
      for (let k = 0; k < 3; k++) { const v3 = tri[t + k] * 3; nor[v3] += n[0]; nor[v3 + 1] += n[1]; nor[v3 + 2] += n[2]; }
    }
    for (let i = 0; i < nor.length; i += 3) { const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1; nor[i] /= l; nor[i + 1] /= l; nor[i + 2] /= l; }
  }
  // Each triangle gets its own vertices, so it can take one colour (and one finish) without smearing.
  const pos = new Float32Array(tri.length * 3), nrm = new Float32Array(tri.length * 3), col = new Float32Array(tri.length * 3);
  const fin = new Uint8Array(tri.length / 3);
  let anyFinish = false;
  const vcol = F.vertexPaint ? Array.from({ length: vp.length / 3 }, (_, i) => F.paint(vp[i * 3], vp[i * 3 + 1], vp[i * 3 + 2])) : null;
  // Baked occlusion per vertex (smooth normals) or per triangle (flat facets).
  const vocc = F.occlusion && !F.flat ? Array.from({ length: vp.length / 3 }, (_, i) => F.occlusion!(vp[i * 3], vp[i * 3 + 1], vp[i * 3 + 2], nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2])) : null;
  for (let t = 0; t < tri.length; t += 3) {
    const [i, j, k] = [tri[t], tri[t + 1], tri[t + 2]];
    const c = F.paint((vp[i * 3] + vp[j * 3] + vp[k * 3]) / 3, (vp[i * 3 + 1] + vp[j * 3 + 1] + vp[k * 3 + 1]) / 3, (vp[i * 3 + 2] + vp[j * 3 + 2] + vp[k * 3 + 2]) / 3);
    fin[t / 3] = c[3];
    if (c[3]) anyFinish = true;
    let fn: number[] | null = null;
    if (F.flat) { fn = face(i, j, k); const l = Math.hypot(fn[0], fn[1], fn[2]) || 1; fn = fn.map((x) => x / l); }
    const focc = !vocc && F.occlusion && fn ? F.occlusion((vp[i * 3] + vp[j * 3] + vp[k * 3]) / 3, (vp[i * 3 + 1] + vp[j * 3 + 1] + vp[k * 3 + 1]) / 3, (vp[i * 3 + 2] + vp[j * 3 + 2] + vp[k * 3 + 2]) / 3, fn[0], fn[1], fn[2]) : 1;
    for (let q = 0; q < 3; q++) {
      const src = tri[t + q] * 3, dst = (t + q) * 3;
      pos[dst] = vp[src]; pos[dst + 1] = vp[src + 1]; pos[dst + 2] = vp[src + 2];
      if (fn) { nrm[dst] = fn[0]; nrm[dst + 1] = fn[1]; nrm[dst + 2] = fn[2]; } else { nrm[dst] = nor[src]; nrm[dst + 1] = nor[src + 1]; nrm[dst + 2] = nor[src + 2]; }
      const vc = vcol ? vcol[tri[t + q]] : c;
      const o = vocc ? vocc[tri[t + q]] : focc;
      col[dst] = vc[0] * o; col[dst + 1] = vc[1] * o; col[dst + 2] = vc[2] * o;
    }
  }
  const indices = new Uint32Array(tri.length);
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  return { positions: pos, normals: nrm, colors: col, indices, quads: quads.length, ...(anyFinish ? { finishes: fin } : {}) };
}

/** Surface nets over a voxel grid's softened density (the smooth and low-poly styles). */
export function surfaceNets(g: VoxelGrid, scale: number, flat: boolean): MeshData {
  const { f, w, h, d } = density(g, scale);
  const P = 2 * scale;
  const rgb = g.palette.map((c) => (c ? hexToRgb(c) : [0.5, 0.5, 0.5] as [number, number, number]));
  return meshField({
    f, w, h, d, iso: 0.42, smooth: flat ? 0 : 2, flat,
    occlusion: (px, py, pz, nx, ny, nz) => voxelOcclusion(g, px, py, pz, nx, ny, nz),
    // Density samples sit at cell centres of the resampled grid.
    toOut: (x, y, z) => [(x + 0.5) / scale - P / scale, (y + 0.5) / scale - P / scale, (z + 0.5) / scale - P / scale],
    // The solid voxel nearest the point.
    paint: (px, py, pz) => {
      let best = 0, bd = Infinity;
      const cx = Math.floor(px), cy = Math.floor(py), cz = Math.floor(pz);
      for (let r = 1; r <= 2 && !best; r++)
        for (let y = cy - r; y <= cy + r; y++) for (let z = cz - r; z <= cz + r; z++) for (let x = cx - r; x <= cx + r; x++) {
          const c = g.get(x, y, z);
          if (!c) continue;
          const dd = (x + 0.5 - px) ** 2 + (y + 0.5 - py) ** 2 + (z + 0.5 - pz) ** 2;
          if (dd < bd) { bd = dd; best = c; }
        }
      const c = rgb[best] ?? [0.5, 0.5, 0.5];
      return [c[0], c[1], c[2], g.finish[best] ?? 0];
    },
  });
}

/**
 * Baked ambient occlusion from a voxel grid: how much of a small hemisphere above the point (along
 * its normal) is open. Creases, armpits and undersides darken; open surfaces stay as they are.
 */
export function voxelOcclusion(g: VoxelGrid, px: number, py: number, pz: number, nx: number, ny: number, nz: number): number {
  // A tangent frame around the normal, for samples leaning out at an angle.
  const ax = Math.abs(nx) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let tx = ny * ax[2] - nz * ax[1], ty = nz * ax[0] - nx * ax[2], tz = nx * ax[1] - ny * ax[0];
  const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
  const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
  let hit = 0, total = 0;
  for (const dist of [1.2, 2.4, 3.6]) {
    for (const [a, b] of [[0, 0], [0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7]]) {
      const sx = px + (nx + tx * a + bx * b) * dist, sy = py + (ny + ty * a + by * b) * dist, sz = pz + (nz + tz * a + bz * b) * dist;
      const wgt = 1 / dist;
      total += wgt;
      if (g.get(Math.floor(sx), Math.floor(sy), Math.floor(sz))) hit += wgt;
    }
  }
  return 1 - 0.55 * (hit / total);
}

const tris = (m: MeshData) => m.indices.length / 3;
export interface StyledMesh { parts: MeshData[]; scale: number; triangles: number }

/**
 * Mesh every part of a model in a style, at the finest detail whose total triangle count fits
 * `maxTriangles` (smooth tries 2×, then 1×, then ½×; low-poly ½×, then ⅓×). Sculpted models also
 * get a close-up version that may use `closeUpMultiplier` × the budget (`near`).
 */
export function meshModel(model: VoxelModel, style: ModelStyle, maxTriangles = Infinity, closeUpMultiplier = 1): StyledMesh & { near?: StyledMesh } {
  if (style === "voxel") {
    const parts = model.parts.map((p) => greedyMesh(p.grid));
    return { parts, scale: 1, triangles: parts.reduce((n, m) => n + tris(m), 0) };
  }
  const fit = (scales: number[], mesh: (scale: number) => MeshData[], budget: number): StyledMesh => {
    let last: StyledMesh | null = null;
    for (const scale of scales) {
      const parts = mesh(scale);
      last = { parts, scale, triangles: parts.reduce((n, m) => n + tris(m), 0) };
      if (last.triangles <= budget) return last;
    }
    return last!;
  };
  if (style === "sculpted" && model.parts.some((p) => p.sdf)) {
    const sculpt = (scale: number) => model.parts.map((p) => (p.sdf ? sculptPart(p, scale) : surfaceNets(p.grid, scale, false)));
    // Triangles grow with the square of the detail: measure once at 1×, then only mesh the
    // detail predicted to fit (stepping down if it doesn't).
    const base: StyledMesh = { parts: sculpt(1), scale: 1, triangles: 0 };
    base.triangles = base.parts.reduce((n, m) => n + tris(m), 0);
    const pick = (scales: number[], budget: number): StyledMesh => {
      // Start at the finest detail predicted to fit, and step down until one really does.
      const first = scales.findIndex((s) => base.triangles * s * s <= budget * 0.95);
      const tryScales = scales.slice(first < 0 ? scales.length - 1 : first);
      return fit(tryScales, (s) => (s === 1 ? base.parts : sculpt(s)), budget);
    };
    const far = pick([3, 2.5, 2, 1.5, 1.25, 1, 0.85, 0.75, 0.6, 0.5], maxTriangles);
    if (closeUpMultiplier <= 1) return far;
    const near = pick([6, 5, 4, 3, 2.5, 2, 1.75, 1.5, 1.25], maxTriangles * closeUpMultiplier);
    return near.triangles > far.triangles * 1.2 && near.triangles <= maxTriangles * closeUpMultiplier ? { ...far, near } : far;
  }
  const scales = style === "lowpoly" ? [0.5, 0.34] : [2, 1, 0.5];
  return fit(scales, (scale) => model.parts.map((p) => surfaceNets(p.grid, scale, style === "lowpoly")), maxTriangles);
}
