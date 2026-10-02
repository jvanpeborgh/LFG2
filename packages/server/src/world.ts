import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import {
  CHUNK_BITS, CHUNK_MASK, CHUNK_SIZE, Chunk, ChunkMap, WORLD_CHUNKS_Y, WORLD_HEIGHT, chunkKey, decodeRLE, encodeRLE,
  type BlockTable, type Registry, type Slot,
} from "@lfg/shared";
import type { GenPool } from "./genPool";

export interface BlockChange {
  x: number;
  y: number;
  z: number;
  id: number;
  prev: number;
  /** Block entity that was removed with the old block (chest contents, ...). */
  removedEntity?: BlockEntity;
}

/** Data attached to a block position (chest contents, furnace state, ...). */
export interface BlockEntity {
  kind: string;
  /** Named slot groups (a chest has "items"; a furnace has "input", "fuel", "output"). */
  slots: Record<string, Slot[]>;
  data: Record<string, number>;
}

export interface LevelMeta {
  seed: number;
  time: number;
  spawn: [number, number, number];
  created: string;
}

const posKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

/**
 * The authoritative voxel world: loaded chunks, generation, persistence and
 * change tracking. All block writes go through setBlock so they can be sent to
 * clients, saved, and (later) undone.
 */
export class WorldStore extends ChunkMap {
  readonly dirty = new Set<string>();
  readonly changes: BlockChange[] = [];
  readonly blockEntities = new Map<string, BlockEntity>();
  private loading = new Map<string, Promise<Chunk>>();
  /** Neighbour positions to re-check at the end of the tick (support, gravity). */
  readonly neighborQueue: [number, number, number][] = [];
  meta: LevelMeta;

  constructor(
    readonly dir: string,
    readonly reg: Registry,
    readonly table: BlockTable,
    private pool: GenPool,
    meta: LevelMeta,
  ) {
    super();
    this.unloadedBlock = 0;
    this.meta = meta;
    mkdirSync(join(dir, "chunks"), { recursive: true });
    mkdirSync(join(dir, "players"), { recursive: true });
    const bePath = join(dir, "blockentities.json");
    if (existsSync(bePath)) {
      const raw = JSON.parse(readFileSync(bePath, "utf8")) as Record<string, BlockEntity>;
      for (const [k, v] of Object.entries(raw)) this.blockEntities.set(k, v);
    }
  }

  static loadMeta(dir: string, seed: number): LevelMeta | null {
    const p = join(dir, "level.json");
    if (!existsSync(p)) return null;
    const m = JSON.parse(readFileSync(p, "utf8")) as LevelMeta;
    return { ...m, seed: m.seed ?? seed };
  }

  /** Get a chunk, loading it from disk or generating it if needed. */
  ensureChunk(cx: number, cy: number, cz: number): Promise<Chunk> {
    const key = chunkKey(cx, cy, cz);
    const have = this.chunks.get(key);
    if (have) return Promise.resolve(have);
    const inflight = this.loading.get(key);
    if (inflight) return inflight;
    const p = (async () => {
      const file = join(this.dir, "chunks", `${cx}_${cy}_${cz}.bin`);
      let blocks: Uint16Array;
      if (existsSync(file)) {
        const buf = readFileSync(file);
        blocks = decodeRLE(new Uint16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
      } else {
        blocks = await this.pool.generate(cx, cy, cz);
      }
      // Another request may have finished first.
      const existing = this.chunks.get(key);
      if (existing) return existing;
      const chunk = new Chunk(cx, cy, cz, blocks);
      this.setChunk(chunk);
      return chunk;
    })();
    this.loading.set(key, p);
    p.finally(() => this.loading.delete(key));
    return p;
  }

  /** Load the full column of chunks around a block position (used for spawn). */
  async ensureArea(x: number, z: number, radiusChunks: number): Promise<void> {
    const cx0 = x >> CHUNK_BITS, cz0 = z >> CHUNK_BITS;
    const jobs: Promise<Chunk>[] = [];
    for (let dz = -radiusChunks; dz <= radiusChunks; dz++)
      for (let dx = -radiusChunks; dx <= radiusChunks; dx++)
        for (let cy = 0; cy < WORLD_CHUNKS_Y; cy++) jobs.push(this.ensureChunk(cx0 + dx, cy, cz0 + dz));
    await Promise.all(jobs);
  }

  /** Change a block. Returns false if the chunk isn't loaded or nothing changed. */
  setBlockTracked(x: number, y: number, z: number, id: number): boolean {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const chunk = this.getChunk(x >> CHUNK_BITS, y >> CHUNK_BITS, z >> CHUNK_BITS);
    if (!chunk) return false;
    const lx = x & CHUNK_MASK, ly = y & CHUNK_MASK, lz = z & CHUNK_MASK;
    const prev = chunk.get(lx, ly, lz);
    if (prev === id) return false;
    chunk.set(lx, ly, lz, id);
    this.dirty.add(chunk.key);
    // Block entities don't survive their block being replaced.
    const key = posKey(x, y, z);
    const removedEntity = this.blockEntities.get(key);
    if (removedEntity) this.blockEntities.delete(key);
    this.changes.push({ x, y, z, id, prev, removedEntity });
    this.neighborQueue.push([x, y, z], [x + 1, y, z], [x - 1, y, z], [x, y + 1, z], [x, y - 1, z], [x, y, z + 1], [x, y, z - 1]);
    return true;
  }

  getBlockEntity(x: number, y: number, z: number): BlockEntity | undefined {
    return this.blockEntities.get(posKey(x, y, z));
  }

  setBlockEntity(x: number, y: number, z: number, be: BlockEntity): void {
    this.blockEntities.set(posKey(x, y, z), be);
  }

  /** Highest non-air block at a column among loaded chunks (or -1). */
  surfaceY(x: number, z: number): number {
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) if (this.table.solid[this.getBlock(x, y, z)]) return y;
    return -1;
  }

  /** Pick n random block positions in each given chunk (for random ticks). */
  *randomPositions(chunkKeys: Iterable<string>, perChunk: number, rand: () => number): Generator<[number, number, number, number]> {
    for (const key of chunkKeys) {
      const c = this.chunks.get(key);
      if (!c) continue;
      for (let i = 0; i < perChunk; i++) {
        const lx = Math.floor(rand() * CHUNK_SIZE), ly = Math.floor(rand() * CHUNK_SIZE), lz = Math.floor(rand() * CHUNK_SIZE);
        const id = c.get(lx, ly, lz);
        if (id !== 0) yield [c.cx * CHUNK_SIZE + lx, c.cy * CHUNK_SIZE + ly, c.cz * CHUNK_SIZE + lz, id];
      }
    }
  }

  /** Save dirty chunks, block entities and level metadata. */
  save(): number {
    let n = 0;
    for (const key of this.dirty) {
      const c = this.chunks.get(key);
      if (!c) continue;
      const rle = encodeRLE(c.blocks);
      writeAtomic(join(this.dir, "chunks", `${c.cx}_${c.cy}_${c.cz}.bin`), Buffer.from(rle.buffer, rle.byteOffset, rle.byteLength));
      n++;
    }
    this.dirty.clear();
    writeAtomic(join(this.dir, "blockentities.json"), JSON.stringify(Object.fromEntries(this.blockEntities)));
    writeAtomic(join(this.dir, "level.json"), JSON.stringify(this.meta, null, 2));
    return n;
  }

  /** Drop chunks no one needs (after saving them). */
  unloadExcept(keep: Set<string>): number {
    let n = 0;
    for (const key of [...this.chunks.keys()]) {
      if (keep.has(key)) continue;
      if (this.dirty.has(key)) continue; // save first
      this.chunks.delete(key);
      n++;
    }
    return n;
  }
}

export function writeAtomic(path: string, data: string | Buffer): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}
