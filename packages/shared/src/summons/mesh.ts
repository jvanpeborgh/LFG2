import { greedyMesh, type MeshData, type VoxelGrid, type VoxelModel } from "./voxel";

/**
 * Model styles: the same model data drawn three ways, chosen per world
 * (art.modelStyle):
 *
 *   voxel    greedy-meshed cubes (the default "Chunky Daylight" look)
 *   smooth   a smooth surface through the voxels (surface nets over a softened
 *            density field), with smooth normals and, where the triangle
 *            budget allows, twice the resolution: organic, higher-polygon
 *   lowpoly  the same surface at half resolution with flat-shaded facets
 *
 * Every style keeps the parts (so animation works) and the palette colours,
 * and picks the finest detail that fits the asset's triangle budget.
 */

export type ModelStyle = "voxel" | "smooth" | "lowpoly";
export const MODEL_STYLES: ModelStyle[] = ["voxel", "smooth", "lowpoly"];

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

/**
 * Surface nets over the softened density: one vertex per cell the surface
 * crosses, placed at the average of its edge crossings; quads joining them.
 * Colours come from the nearest solid voxel. Returns positions in voxel units
 * relative to the grid corner (like greedyMesh).
 */
export function surfaceNets(g: VoxelGrid, scale: number, flat: boolean): MeshData {
  const ISO = 0.42;
  const { f, w, h, d } = density(g, scale);
  const P = 2 * scale;
  const val = (x: number, y: number, z: number) => f[(y * d + z) * w + x];
  const rgb = g.palette.map((c) => (c ? hexToRgb(c) : [0.5, 0.5, 0.5] as [number, number, number]));
  const vertIndex = new Int32Array(w * h * d).fill(-1);
  const vp: number[] = [], vc: number[] = [];
  // Colour of the solid voxel nearest a point (in grid voxel units).
  const colorAt = (px: number, py: number, pz: number): [number, number, number] => {
    let best = 0, bd = Infinity;
    const cx = Math.floor(px), cy = Math.floor(py), cz = Math.floor(pz);
    for (let r = 1; r <= 2 && !best; r++)
      for (let y = cy - r; y <= cy + r; y++) for (let z = cz - r; z <= cz + r; z++) for (let x = cx - r; x <= cx + r; x++) {
        const c = g.get(x, y, z);
        if (!c) continue;
        const dd = (x + 0.5 - px) ** 2 + (y + 0.5 - py) ** 2 + (z + 0.5 - pz) ** 2;
        if (dd < bd) { bd = dd; best = c; }
      }
    return rgb[best] ?? [0.5, 0.5, 0.5];
  };
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let y = 0; y < h - 1; y++) for (let z = 0; z < d - 1; z++) for (let x = 0; x < w - 1; x++) {
    const v = corners.map(([a, b, c]) => val(x + a, y + b, z + c));
    let inside = 0;
    for (const s of v) if (s > ISO) inside++;
    if (inside === 0 || inside === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [i, j] of edges) {
      if ((v[i] > ISO) === (v[j] > ISO)) continue;
      const t = (ISO - v[i]) / (v[j] - v[i]);
      sx += corners[i][0] + (corners[j][0] - corners[i][0]) * t;
      sy += corners[i][1] + (corners[j][1] - corners[i][1]) * t;
      sz += corners[i][2] + (corners[j][2] - corners[i][2]) * t;
      n++;
    }
    // Cell → grid voxel units (density samples sit at cell centres of the resampled grid).
    const px = (x + 0.5 + sx / n) / scale - P / scale, py = (y + 0.5 + sy / n) / scale - P / scale, pz = (z + 0.5 + sz / n) / scale - P / scale;
    vertIndex[(y * d + z) * w + x] = vp.length / 3;
    vp.push(px, py, pz);
    vc.push(...colorAt(px, py, pz));
  }
  // Quads across every sign-changing grid edge.
  const quads: number[][] = [];
  for (let y = 1; y < h - 1; y++) for (let z = 1; z < d - 1; z++) for (let x = 1; x < w - 1; x++) {
    const a = val(x, y, z) > ISO;
    for (let axis = 0; axis < 3; axis++) {
      const nx = x + (axis === 0 ? 1 : 0), ny = y + (axis === 1 ? 1 : 0), nz = z + (axis === 2 ? 1 : 0);
      if (nx >= w || ny >= h || nz >= d) continue;
      const b = val(nx, ny, nz) > ISO;
      if (a === b) continue;
      // The four cells around this edge.
      const cells = axis === 0 ? [[x, y - 1, z - 1], [x, y, z - 1], [x, y, z], [x, y - 1, z]]
        : axis === 1 ? [[x - 1, y, z - 1], [x - 1, y, z], [x, y, z], [x, y, z - 1]]
        : [[x - 1, y - 1, z], [x, y - 1, z], [x, y, z], [x - 1, y, z]];
      const ids = cells.map(([cx, cy, cz]) => vertIndex[(cy * d + cz) * w + cx]);
      if (ids.some((i) => i < 0)) continue;
      // Winding: outward from the solid side (the cell order above already turns the same way on every axis).
      const flip = a;
      quads.push(flip ? ids : [...ids].reverse());
    }
  }
  if (!flat) {
    // A little Laplacian smoothing over the surface for a softer, rounder look.
    const nb: number[][] = Array.from({ length: vp.length / 3 }, () => []);
    for (const q of quads) for (let i = 0; i < 4; i++) { nb[q[i]].push(q[(i + 1) % 4]); nb[q[i]].push(q[(i + 3) % 4]); }
    for (let it = 0; it < 2; it++) {
      const next = vp.slice();
      nb.forEach((list, i) => {
        if (!list.length) return;
        let sx = 0, sy = 0, sz = 0;
        for (const j of list) { sx += vp[j * 3]; sy += vp[j * 3 + 1]; sz += vp[j * 3 + 2]; }
        next[i * 3] = vp[i * 3] * 0.5 + (sx / list.length) * 0.5;
        next[i * 3 + 1] = vp[i * 3 + 1] * 0.5 + (sy / list.length) * 0.5;
        next[i * 3 + 2] = vp[i * 3 + 2] * 0.5 + (sz / list.length) * 0.5;
      });
      vp.splice(0, vp.length, ...next);
    }
    // Smooth normals: accumulate face normals per vertex.
    const nor = new Float32Array(vp.length);
    const idx: number[] = [];
    for (const [a, b, c, e] of quads) {
      for (const [i, j, k] of [[a, b, c], [a, c, e]]) {
        const ux = vp[j * 3] - vp[i * 3], uy = vp[j * 3 + 1] - vp[i * 3 + 1], uz = vp[j * 3 + 2] - vp[i * 3 + 2];
        const wx = vp[k * 3] - vp[i * 3], wy = vp[k * 3 + 1] - vp[i * 3 + 1], wz = vp[k * 3 + 2] - vp[i * 3 + 2];
        const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        for (const v of [i, j, k]) { nor[v * 3] += nx; nor[v * 3 + 1] += ny; nor[v * 3 + 2] += nz; }
        idx.push(i, j, k);
      }
    }
    for (let i = 0; i < nor.length; i += 3) {
      const l = Math.hypot(nor[i], nor[i + 1], nor[i + 2]) || 1;
      nor[i] /= l; nor[i + 1] /= l; nor[i + 2] /= l;
    }
    // Smooth shading, but each triangle takes one colour (from the voxel nearest its middle), so eyes,
    // stripes and trims stay crisp instead of smearing across the surface.
    const pos: number[] = [], nrm: number[] = [], col: number[] = [], out: number[] = [];
    for (let t = 0; t < idx.length; t += 3) {
      const [i, j, k] = [idx[t], idx[t + 1], idx[t + 2]];
      const c = colorAt((vp[i * 3] + vp[j * 3] + vp[k * 3]) / 3, (vp[i * 3 + 1] + vp[j * 3 + 1] + vp[k * 3 + 1]) / 3, (vp[i * 3 + 2] + vp[j * 3 + 2] + vp[k * 3 + 2]) / 3);
      for (const v of [i, j, k]) {
        out.push(pos.length / 3);
        pos.push(vp[v * 3], vp[v * 3 + 1], vp[v * 3 + 2]);
        nrm.push(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]);
        col.push(c[0], c[1], c[2]);
      }
    }
    return { positions: new Float32Array(pos), normals: new Float32Array(nrm), colors: new Float32Array(col), indices: new Uint32Array(out), quads: quads.length };
  }
  // Flat facets: every triangle gets its own vertices, one normal and one colour (the low-poly look).
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  for (const [a, b, c, e] of quads) for (const [i, j, k] of [[a, b, c], [a, c, e]]) {
    const ux = vp[j * 3] - vp[i * 3], uy = vp[j * 3 + 1] - vp[i * 3 + 1], uz = vp[j * 3 + 2] - vp[i * 3 + 2];
    const wx = vp[k * 3] - vp[i * 3], wy = vp[k * 3 + 1] - vp[i * 3 + 1], wz = vp[k * 3 + 2] - vp[i * 3 + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const base = pos.length / 3;
    for (const v of [i, j, k]) { pos.push(vp[v * 3], vp[v * 3 + 1], vp[v * 3 + 2]); nor.push(nx, ny, nz); }
    const c = colorAt((vp[i * 3] + vp[j * 3] + vp[k * 3]) / 3, (vp[i * 3 + 1] + vp[j * 3 + 1] + vp[k * 3 + 1]) / 3, (vp[i * 3 + 2] + vp[j * 3 + 2] + vp[k * 3 + 2]) / 3);
    for (let t = 0; t < 3; t++) col.push(c[0], c[1], c[2]);
    idx.push(base, base + 1, base + 2);
  }
  return { positions: new Float32Array(pos), normals: new Float32Array(nor), colors: new Float32Array(col), indices: new Uint32Array(idx), quads: quads.length };
}

const tris = (m: MeshData) => m.indices.length / 3;

/**
 * Mesh every part of a model in a style, at the finest detail whose total
 * triangle count fits `maxTriangles` (smooth tries 2×, then 1×, then ½×;
 * low-poly tries ½×, then ⅓×).
 */
export function meshModel(model: VoxelModel, style: ModelStyle, maxTriangles = Infinity): { parts: MeshData[]; scale: number; triangles: number } {
  if (style === "voxel") {
    const parts = model.parts.map((p) => greedyMesh(p.grid));
    return { parts, scale: 1, triangles: parts.reduce((n, m) => n + tris(m), 0) };
  }
  const scales = style === "smooth" ? [2, 1, 0.5] : [0.5, 0.34];
  let last: { parts: MeshData[]; scale: number; triangles: number } | null = null;
  for (const scale of scales) {
    const parts = model.parts.map((p) => surfaceNets(p.grid, scale, style === "lowpoly"));
    const triangles = parts.reduce((n, m) => n + tris(m), 0);
    last = { parts, scale, triangles };
    if (triangles <= maxTriangles) return last;
  }
  return last!;
}
