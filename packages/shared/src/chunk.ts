/** Voxel storage: the world is split into 32³ chunks of 16-bit block ids. */

export const CHUNK_BITS = 5;
export const CHUNK_SIZE = 1 << CHUNK_BITS; // 32
export const CHUNK_MASK = CHUNK_SIZE - 1;
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE;

/** World height in blocks (0..WORLD_HEIGHT-1). */
export const WORLD_HEIGHT = 128;
export const WORLD_CHUNKS_Y = WORLD_HEIGHT / CHUNK_SIZE;

export function chunkKey(cx: number, cy: number, cz: number): string {
  return `${cx},${cy},${cz}`;
}

export function parseChunkKey(key: string): [number, number, number] {
  const [x, y, z] = key.split(",").map(Number);
  return [x, y, z];
}

export function blockIndex(lx: number, ly: number, lz: number): number {
  return (ly << (CHUNK_BITS * 2)) | (lz << CHUNK_BITS) | lx;
}

export class Chunk {
  readonly blocks: Uint16Array;
  /** Increases on every change; used to know when to re-mesh / save. */
  version = 0;

  constructor(
    readonly cx: number,
    readonly cy: number,
    readonly cz: number,
    blocks?: Uint16Array,
  ) {
    this.blocks = blocks ?? new Uint16Array(CHUNK_VOLUME);
  }

  get(lx: number, ly: number, lz: number): number {
    return this.blocks[blockIndex(lx, ly, lz)];
  }

  set(lx: number, ly: number, lz: number, id: number): void {
    this.blocks[blockIndex(lx, ly, lz)] = id;
    this.version++;
  }

  isEmpty(): boolean {
    for (let i = 0; i < CHUNK_VOLUME; i++) if (this.blocks[i] !== 0) return false;
    return true;
  }

  get key(): string {
    return chunkKey(this.cx, this.cy, this.cz);
  }
}

/** Run-length encoding: pairs of (count:u16, id:u16). Compact for terrain. */
export function encodeRLE(blocks: Uint16Array): Uint16Array {
  const out: number[] = [];
  let i = 0;
  while (i < blocks.length) {
    const id = blocks[i];
    let run = 1;
    while (i + run < blocks.length && blocks[i + run] === id && run < 0xffff) run++;
    out.push(run, id);
    i += run;
  }
  return Uint16Array.from(out);
}

export function decodeRLE(data: Uint16Array, length = CHUNK_VOLUME): Uint16Array {
  const out = new Uint16Array(length);
  let o = 0;
  for (let i = 0; i + 1 < data.length; i += 2) {
    const run = data[i];
    const id = data[i + 1];
    if (o + run > length) throw new Error("RLE data overflows chunk");
    out.fill(id, o, o + run);
    o += run;
  }
  if (o !== length) throw new Error(`RLE data decoded ${o} of ${length} blocks`);
  return out;
}

/** Anything that can answer "which block is at x,y,z". */
export interface BlockQuery {
  getBlock(x: number, y: number, z: number): number;
}

/** A sparse set of loaded chunks with world-coordinate access. */
export class ChunkMap implements BlockQuery {
  readonly chunks = new Map<string, Chunk>();
  /** Block id returned for unloaded chunks. Solid by default so nothing falls out of the world. */
  unloadedBlock = 0;

  getChunk(cx: number, cy: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cy, cz));
  }

  setChunk(chunk: Chunk): void {
    this.chunks.set(chunk.key, chunk);
  }

  deleteChunk(cx: number, cy: number, cz: number): void {
    this.chunks.delete(chunkKey(cx, cy, cz));
  }

  getBlock(x: number, y: number, z: number): number {
    if (y < 0) return this.unloadedBlock;
    if (y >= WORLD_HEIGHT) return 0;
    const c = this.chunks.get(chunkKey(x >> CHUNK_BITS, y >> CHUNK_BITS, z >> CHUNK_BITS));
    if (!c) return this.unloadedBlock;
    return c.get(x & CHUNK_MASK, y & CHUNK_MASK, z & CHUNK_MASK);
  }

  /** Returns false if the chunk isn't loaded. */
  setBlock(x: number, y: number, z: number, id: number): boolean {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const c = this.chunks.get(chunkKey(x >> CHUNK_BITS, y >> CHUNK_BITS, z >> CHUNK_BITS));
    if (!c) return false;
    c.set(x & CHUNK_MASK, y & CHUNK_MASK, z & CHUNK_MASK, id);
    return true;
  }

  isLoaded(x: number, y: number, z: number): boolean {
    return this.chunks.has(chunkKey(x >> CHUNK_BITS, y >> CHUNK_BITS, z >> CHUNK_BITS));
  }
}
