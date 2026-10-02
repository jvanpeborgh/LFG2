import { CHUNK_BITS, CHUNK_MASK, CHUNK_SIZE, ChunkMap, Chunk, WORLD_HEIGHT, chunkKey, type BlockDef } from "@lfg/shared";

/**
 * Chunk meshing with smooth lighting and ambient occlusion. Pure functions
 * over a mirror of the world, so it runs inside Web Workers.
 */

/** How far light from outside the chunk is considered (torch light reaches 14 blocks). */
export const LIGHT_PAD = 14;
const S = CHUNK_SIZE;
const P = S + LIGHT_PAD * 2; // padded edge length
const P2 = P * P;

export interface BlockInfo {
  /** 0 none, 1 cube, 2 cutout cube, 3 cross, 4 liquid, 5 translucent cube */
  render: Uint8Array;
  opaque: Uint8Array;
  light: Uint8Array;
  /** Light passes but is reduced by 1 extra (water, leaves, ice). */
  attenuates: Uint8Array;
  /** Tile index per face: [top, bottom, side, front] × blockId */
  tiles: Uint16Array;
}

const RENDER_CODE: Record<BlockDef["render"], number> = { none: 0, cube: 1, cutout: 2, cross: 3, liquid: 4, translucent: 5 };

export function buildBlockInfo(blocks: BlockDef[], tileOf: (name: string) => number): BlockInfo {
  const n = blocks.length;
  const info: BlockInfo = {
    render: new Uint8Array(n),
    opaque: new Uint8Array(n),
    light: new Uint8Array(n),
    attenuates: new Uint8Array(n),
    tiles: new Uint16Array(n * 4),
  };
  for (const b of blocks) {
    info.render[b.id] = RENDER_CODE[b.render];
    info.opaque[b.id] = b.opaque ? 1 : 0;
    info.light[b.id] = b.light;
    info.attenuates[b.id] = b.liquid || b.tags.includes("leaves") || b.render === "translucent" ? 1 : 0;
    if (b.render !== "none") {
      info.tiles[b.id * 4] = tileOf(b.faces.top);
      info.tiles[b.id * 4 + 1] = tileOf(b.faces.bottom);
      info.tiles[b.id * 4 + 2] = tileOf(b.faces.side);
      info.tiles[b.id * 4 + 3] = tileOf(b.faces.front ?? b.faces.side);
    }
  }
  return info;
}

/** A world mirror that also keeps a per-column height map for sky light. */
export class WorldMirror extends ChunkMap {
  /** Per (cx,cz): highest light-blocking y for each of the 32×32 columns (-1 if none). */
  readonly heights = new Map<string, Int16Array>();

  constructor(private info: BlockInfo) {
    super();
  }

  addChunk(cx: number, cy: number, cz: number, blocks: Uint16Array): void {
    this.setChunk(new Chunk(cx, cy, cz, blocks));
    this.recomputeColumn(cx, cz);
  }

  removeChunk(cx: number, cy: number, cz: number): void {
    this.deleteChunk(cx, cy, cz);
    this.recomputeColumn(cx, cz);
  }

  set(x: number, y: number, z: number, id: number): void {
    if (!this.setBlock(x, y, z, id)) return;
    const cx = x >> CHUNK_BITS, cz = z >> CHUNK_BITS;
    const h = this.heights.get(`${cx},${cz}`);
    if (!h) return;
    const i = (z & CHUNK_MASK) * S + (x & CHUNK_MASK);
    const blocks = this.info.opaque[id] || this.info.attenuates[id];
    if (blocks && y > h[i]) h[i] = y;
    else if (!blocks && y === h[i]) {
      let yy = y - 1;
      while (yy >= 0) {
        const b = this.getBlock(x, yy, z);
        if (this.info.opaque[b] || this.info.attenuates[b]) break;
        yy--;
      }
      h[i] = yy;
    }
  }

  private recomputeColumn(cx: number, cz: number): void {
    const h = new Int16Array(S * S).fill(-1);
    const { opaque, attenuates } = this.info;
    for (let cy = WORLD_HEIGHT / S - 1; cy >= 0; cy--) {
      const c = this.getChunk(cx, cy, cz);
      if (!c) continue;
      const b = c.blocks;
      for (let lz = 0; lz < S; lz++)
        for (let lx = 0; lx < S; lx++) {
          const i = lz * S + lx;
          if (h[i] >= 0) continue;
          for (let ly = S - 1; ly >= 0; ly--) {
            const id = b[(ly << 10) | (lz << 5) | lx];
            if (opaque[id] || attenuates[id]) { h[i] = cy * S + ly; break; }
          }
        }
    }
    this.heights.set(`${cx},${cz}`, h);
  }

  heightAt(x: number, z: number): number {
    const h = this.heights.get(`${x >> CHUNK_BITS},${z >> CHUNK_BITS}`);
    return h ? h[(z & CHUNK_MASK) * S + (x & CHUNK_MASK)] : WORLD_HEIGHT;
  }

  /** True if this chunk and the chunks around it are loaded, so the mesh won't need redoing. */
  neighborsReady(cx: number, cy: number, cz: number): boolean {
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const y = cy + dy;
          if (y < 0 || y >= WORLD_HEIGHT / S) continue;
          if (!this.chunks.has(chunkKey(cx + dx, y, cz + dz))) return false;
        }
    return true;
  }
}

export interface MeshData {
  positions: Float32Array;
  uvs: Float32Array;
  /** sky light, block light, shade (AO × face shading) per vertex */
  light: Float32Array;
  indices: Uint32Array;
}

export interface ChunkMeshes {
  solid: MeshData;
  water: MeshData;
}

class MeshBuilder {
  pos: number[] = [];
  uv: number[] = [];
  light: number[] = [];
  idx: number[] = [];
  count = 0;

  quad(
    verts: number[], // 12 numbers: 4 corners
    uvs: number[], // 8 numbers
    lights: number[], // 12 numbers: sky, block, shade × 4
    flip: boolean,
  ): void {
    const b = this.count;
    for (let i = 0; i < 12; i++) this.pos.push(verts[i]);
    for (let i = 0; i < 8; i++) this.uv.push(uvs[i]);
    for (let i = 0; i < 12; i++) this.light.push(lights[i]);
    if (flip) this.idx.push(b + 1, b + 2, b + 3, b + 1, b + 3, b);
    else this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    this.count += 4;
  }

  build(): MeshData {
    return {
      positions: new Float32Array(this.pos),
      uvs: new Float32Array(this.uv),
      light: new Float32Array(this.light),
      indices: new Uint32Array(this.idx),
    };
  }
}

// Faces: normal, the four corners (unit cube, counter-clockwise seen from outside), uv corners, shade.
interface FaceDef {
  n: [number, number, number];
  corners: [number, number, number][];
  /** Which tile slot: 0 top, 1 bottom, 2 side */
  slot: number;
  shade: number;
}

const FACES: FaceDef[] = [
  { n: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], slot: 0, shade: 1.0 },
  { n: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], slot: 1, shade: 0.5 },
  { n: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], slot: 2, shade: 0.7 },
  { n: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], slot: 2, shade: 0.7 },
  { n: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], slot: 3, shade: 0.85 },
  { n: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], slot: 2, shade: 0.85 },
];

/** Per face, per corner: padded-index offsets (from the cell in front of the face) of side1, side2, diagonal. */
const FACE_OFFSETS: Int32Array[] = FACES.map((f) => {
  const out = new Int32Array(12);
  f.corners.forEach(([cx0, cy0, cz0], c) => {
    const dx = cx0 * 2 - 1, dy = cy0 * 2 - 1, dz = cz0 * 2 - 1;
    const a = f.n[0] !== 0 ? [0, dy, 0] : [dx, 0, 0];
    const b = f.n[1] !== 0 || f.n[0] !== 0 ? [0, 0, dz] : [0, dy, 0];
    const off = (v: number[]) => v[1] * P2 + v[2] * P + v[0];
    out[c * 3] = off(a);
    out[c * 3 + 1] = off(b);
    out[c * 3 + 2] = off([a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
  });
  return out;
});

const AO_CURVE = [0.5, 0.68, 0.84, 1.0];
const ATLAS_TILES = 16;
const UV_EPS = 0.0005;

function tileUV(tile: number): [number, number, number, number] {
  const tx = tile % ATLAS_TILES, ty = Math.floor(tile / ATLAS_TILES);
  const u0 = tx / ATLAS_TILES + UV_EPS, v0 = ty / ATLAS_TILES + UV_EPS;
  return [u0, v0, u0 + 1 / ATLAS_TILES - UV_EPS * 2, v0 + 1 / ATLAS_TILES - UV_EPS * 2];
}

/**
 * Build the meshes for one chunk. The padded block volume and light volumes
 * cover the chunk plus LIGHT_PAD blocks around it.
 */
export function meshChunk(world: WorldMirror, info: BlockInfo, cx: number, cy: number, cz: number): ChunkMeshes {
  const ox = cx * S - LIGHT_PAD, oy = cy * S - LIGHT_PAD, oz = cz * S - LIGHT_PAD;
  const blocks = new Uint16Array(P * P * P);
  // Copy blocks from the (up to 27) chunks overlapping the padded region.
  for (let ncy = cy - 1; ncy <= cy + 1; ncy++)
    for (let ncz = cz - 1; ncz <= cz + 1; ncz++)
      for (let ncx = cx - 1; ncx <= cx + 1; ncx++) {
        const c = world.getChunk(ncx, ncy, ncz);
        if (!c) continue;
        const bx = ncx * S - ox, by = ncy * S - oy, bz = ncz * S - oz;
        const x0 = Math.max(0, bx), x1 = Math.min(P, bx + S);
        const y0 = Math.max(0, by), y1 = Math.min(P, by + S);
        const z0 = Math.max(0, bz), z1 = Math.min(P, bz + S);
        if (x0 >= x1 || y0 >= y1 || z0 >= z1) continue;
        const src = c.blocks;
        for (let y = y0; y < y1; y++)
          for (let z = z0; z < z1; z++) {
            const srcRow = ((y - by) << 10) | ((z - bz) << 5);
            const dstRow = y * P2 + z * P;
            for (let x = x0; x < x1; x++) blocks[dstRow + x] = src[srcRow + (x - bx)];
          }
      }

  const { opaque, attenuates, light: emit, render, tiles } = info;
  const sky = new Uint8Array(P * P * P);
  const blk = new Uint8Array(P * P * P);
  const queue = new Int32Array(P * P * P);

  const propagate = (L: Uint8Array, head: number, tail: number) => {
    while (head < tail) {
      const i = queue[head++];
      const l = L[i];
      if (l <= 1) continue;
      const x = i % P, z = ((i / P) | 0) % P, y = (i / P2) | 0;
      for (let k = 0; k < 6; k++) {
        let j: number;
        if (k === 0) { if (x === 0) continue; j = i - 1; }
        else if (k === 1) { if (x === P - 1) continue; j = i + 1; }
        else if (k === 2) { if (z === 0) continue; j = i - P; }
        else if (k === 3) { if (z === P - 1) continue; j = i + P; }
        else if (k === 4) { if (y === 0) continue; j = i - P2; }
        else { if (y === P - 1) continue; j = i + P2; }
        const id = blocks[j];
        if (opaque[id]) continue;
        const nl = l - 1 - attenuates[id];
        if (nl > L[j]) { L[j] = nl; queue[tail++] = j; }
      }
    }
  };

  // Sky light: everything above the column's height map is fully lit, then spreads sideways and down.
  const hm = new Int32Array(P * P);
  for (let z = 0; z < P; z++) for (let x = 0; x < P; x++) hm[z * P + x] = world.heightAt(ox + x, oz + z) - oy;
  let tail = 0;
  for (let z = 0; z < P; z++)
    for (let x = 0; x < P; x++) {
      const h = hm[z * P + x];
      const yStart = Math.max(0, h + 1);
      // Neighbouring columns that are taller get light spilled into them from this column.
      const nMax = Math.max(
        x > 0 ? hm[z * P + x - 1] : -1, x < P - 1 ? hm[z * P + x + 1] : -1,
        z > 0 ? hm[(z - 1) * P + x] : -1, z < P - 1 ? hm[(z + 1) * P + x] : -1,
      );
      for (let y = P - 1; y >= yStart; y--) {
        const i = y * P2 + z * P + x;
        sky[i] = 15;
        if (y === yStart || y <= nMax) queue[tail++] = i;
      }
    }
  propagate(sky, 0, tail);

  // Block light from emitters (torches).
  tail = 0;
  for (let i = 0; i < blocks.length; i++) {
    const e = emit[blocks[i]];
    if (e > 0) { blk[i] = e; queue[tail++] = i; }
  }
  propagate(blk, 0, tail);

  const solid = new MeshBuilder();
  const water = new MeshBuilder();
  const at = (x: number, y: number, z: number) => (y + LIGHT_PAD) * P2 + (z + LIGHT_PAD) * P + (x + LIGHT_PAD);
  const worldBottom = cy === 0;

  const aoVals = [0, 0, 0, 0];
  const verts: number[] = new Array(12);
  const uvs: number[] = new Array(8);
  const lights: number[] = new Array(12);

  for (let y = 0; y < S; y++)
    for (let z = 0; z < S; z++)
      for (let x = 0; x < S; x++) {
        const i = at(x, y, z);
        const id = blocks[i];
        const r = render[id];
        if (r === 0) continue;

        if (r === 3) {
          // Cross plants: two diagonal quads, emitted in both windings so they show from both sides.
          const t = tileUV(tiles[id * 4 + 2]);
          const sl = sky[i] / 15, bl = blk[i] / 15;
          for (const [ax, az, bx, bz] of [[0.15, 0.15, 0.85, 0.85], [0.15, 0.85, 0.85, 0.15]]) {
            const v = [x + ax, y, z + az, x + bx, y, z + bz, x + bx, y + 1, z + bz, x + ax, y + 1, z + az];
            const u = [t[0], t[3], t[2], t[3], t[2], t[1], t[0], t[1]];
            const li = [sl, bl, 0.95, sl, bl, 0.95, sl, bl, 1, sl, bl, 1];
            solid.quad(v, u, li, false);
            const vr = [v[3], v[4], v[5], v[0], v[1], v[2], v[9], v[10], v[11], v[6], v[7], v[8]];
            const ur = [u[2], u[3], u[0], u[1], u[6], u[7], u[4], u[5]];
            solid.quad(vr, ur, li, false);
          }
          continue;
        }

        const isLiquid = r === 4;
        const target = isLiquid || r === 5 ? water : solid;
        for (let fi = 0; fi < 6; fi++) {
          const f = FACES[fi];
          const nx = x + f.n[0], ny = y + f.n[1], nz = z + f.n[2];
          if (worldBottom && ny < 0) continue;
          const j = at(nx, ny, nz);
          const nid = blocks[j];
          if (opaque[nid]) continue;
          // Same transparent block next to itself (water, glass, ice): no face between them.
          // (Leaves are the exception: their inner faces show through the gaps.)
          if (nid === id && !(r === 2 && attenuates[id])) continue;
          if (isLiquid && render[nid] === 4) continue;
          const t = tileUV(tiles[id * 4 + f.slot]);
          // Water surface sits a little lower than a full block.
          const top = isLiquid && blocks[at(x, y + 1, z)] !== id ? 0.875 : 1;
          const fd = FACE_OFFSETS[fi];
          for (let c = 0; c < 4; c++) {
            const corner = f.corners[c];
            verts[c * 3] = x + corner[0];
            verts[c * 3 + 1] = y + (corner[1] === 1 ? top : 0);
            verts[c * 3 + 2] = z + corner[2];
            // The two in-plane neighbours and the diagonal neighbour around this vertex (always inside the padding).
            const k1 = j + fd[c * 3], k2 = j + fd[c * 3 + 1], kc = j + fd[c * 3 + 2];
            const o1 = opaque[blocks[k1]], o2 = opaque[blocks[k2]], oc = opaque[blocks[kc]];
            const ao = o1 && o2 ? 0 : 3 - (o1 + o2 + oc);
            aoVals[c] = ao;
            // Smooth light: average of the open cells around the vertex.
            let sSum = sky[j], bSum = blk[j], n = 1;
            if (!o1) { sSum += sky[k1]; bSum += blk[k1]; n++; }
            if (!o2) { sSum += sky[k2]; bSum += blk[k2]; n++; }
            if (!oc && !(o1 && o2)) { sSum += sky[kc]; bSum += blk[kc]; n++; }
            lights[c * 3] = sSum / n / 15;
            lights[c * 3 + 1] = bSum / n / 15;
            lights[c * 3 + 2] = (isLiquid ? 1 : AO_CURVE[ao]) * f.shade;
          }
          // Flip the quad diagonal to avoid AO artefacts.
          const flip = aoVals[0] + aoVals[2] < aoVals[1] + aoVals[3];
          // UVs: corners 0,1 are the bottom of the face for sides; map so textures are upright.
          if (f.n[1] === 0) {
            uvs[0] = t[0]; uvs[1] = t[3]; uvs[2] = t[2]; uvs[3] = t[3];
            uvs[4] = t[2]; uvs[5] = t[1]; uvs[6] = t[0]; uvs[7] = t[1];
            if (isLiquid && top < 1) { const dv = (t[3] - t[1]) * (1 - top); uvs[5] += dv; uvs[7] += dv; }
          } else {
            uvs[0] = t[0]; uvs[1] = t[1]; uvs[2] = t[2]; uvs[3] = t[1];
            uvs[4] = t[2]; uvs[5] = t[3]; uvs[6] = t[0]; uvs[7] = t[3];
          }
          target.quad(verts, uvs, lights, flip);
        }
      }
  return { solid: solid.build(), water: water.build() };
}
