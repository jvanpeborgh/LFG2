import * as THREE from "three";
import { CHUNK_BITS, CHUNK_SIZE, Chunk, ChunkMap, WORLD_CHUNKS_Y, chunkKey, type Registry } from "@lfg/shared";
import { LIGHT_PAD, buildBlockInfo, type BlockInfo } from "./mesher";
import type { WorkerIn, WorkerOut } from "./mesher.worker";
import MesherWorker from "./mesher.worker?worker";

interface ChunkView {
  solid: THREE.Mesh | null;
  water: THREE.Mesh | null;
}

/**
 * The client's copy of the world: chunk data (for physics, raycasts and
 * prediction) plus meshes, built by a pool of workers that mirror the chunks.
 */
export class ClientWorld extends ChunkMap {
  readonly info: BlockInfo;
  readonly group = new THREE.Group();
  private workers: Worker[] = [];
  private busy: number[] = [];
  private views = new Map<string, ChunkView>();
  private dirty = new Set<string>();
  private inflight = new Map<string, number>();
  private jobSeq = 1;
  meshStats = { meshed: 0, avgMs: 0 };

  constructor(
    readonly reg: Registry,
    tileOf: (name: string) => number,
    private solidMat: THREE.Material,
    private waterMat: THREE.Material,
  ) {
    super();
    this.unloadedBlock = 0;
    this.info = buildBlockInfo(reg.blocks, tileOf);
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    for (let i = 0; i < n; i++) {
      const w = new MesherWorker();
      w.onmessage = (ev: MessageEvent<WorkerOut>) => this.onMeshed(i, ev.data);
      this.post(w, { type: "init", info: this.info });
      this.workers.push(w);
      this.busy.push(0);
    }
  }

  private post(w: Worker, m: WorkerIn, transfer: Transferable[] = []): void {
    w.postMessage(m, transfer);
  }

  addChunk(cx: number, cy: number, cz: number, blocks: Uint16Array): void {
    this.setChunk(new Chunk(cx, cy, cz, blocks));
    for (const w of this.workers) {
      const copy = blocks.slice();
      this.post(w, { type: "chunk", cx, cy, cz, blocks: copy }, [copy.buffer]);
    }
    // This chunk and its neighbours may now be ready to mesh.
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) this.markDirty(cx + dx, cy + dy, cz + dz);
  }

  removeChunk(cx: number, cy: number, cz: number): void {
    this.deleteChunk(cx, cy, cz);
    for (const w of this.workers) this.post(w, { type: "unload", cx, cy, cz });
    const key = chunkKey(cx, cy, cz);
    this.dropView(key);
    this.dirty.delete(key);
  }

  /** Apply block changes (from the server or local prediction). */
  applyChanges(changes: [number, number, number, number][]): void {
    const real = changes.filter(([x, y, z, id]) => this.getBlock(x, y, z) !== id && this.isLoaded(x, y, z));
    if (real.length === 0) return;
    for (const [x, y, z, id] of real) this.setBlock(x, y, z, id);
    for (const w of this.workers) this.post(w, { type: "set", changes: real });
    for (const [x, y, z] of real) {
      const cx = x >> CHUNK_BITS, cy = y >> CHUNK_BITS, cz = z >> CHUNK_BITS;
      // Light can change up to LIGHT_PAD blocks away, so neighbours near the change are re-meshed too.
      const lx = x - cx * CHUNK_SIZE, ly = y - cy * CHUNK_SIZE, lz = z - cz * CHUNK_SIZE;
      const rx = [lx < LIGHT_PAD ? -1 : 0, lx >= CHUNK_SIZE - LIGHT_PAD ? 1 : 0];
      const ry = [ly < LIGHT_PAD ? -1 : 0, ly >= CHUNK_SIZE - LIGHT_PAD ? 1 : 0];
      const rz = [lz < LIGHT_PAD ? -1 : 0, lz >= CHUNK_SIZE - LIGHT_PAD ? 1 : 0];
      for (let dx = rx[0]; dx <= rx[1]; dx++)
        for (let dy = ry[0]; dy <= ry[1]; dy++)
          for (let dz = rz[0]; dz <= rz[1]; dz++) this.markDirty(cx + dx, cy + dy, cz + dz, true);
      // Sky light below an opened/closed column can change all the way down.
      for (let yy = cy - 1; yy >= 0; yy--) this.markDirty(cx, yy, cz, true);
    }
  }

  private markDirty(cx: number, cy: number, cz: number, urgent = false): void {
    if (cy < 0 || cy >= WORLD_CHUNKS_Y) return;
    const key = chunkKey(cx, cy, cz);
    if (!this.chunks.has(key)) return;
    this.dirty.add(key);
    if (urgent) this.urgent.add(key);
  }
  private urgent = new Set<string>();

  private neighborsReady(cx: number, cy: number, cz: number): boolean {
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const y = cy + dy;
          if (y < 0 || y >= WORLD_CHUNKS_Y) continue;
          if (!this.chunks.has(chunkKey(cx + dx, y, cz + dz))) return false;
        }
    return true;
  }

  /** Hand out mesh jobs, nearest first. Call every frame. */
  update(px: number, py: number, pz: number): void {
    if (this.dirty.size === 0) return;
    const pcx = px / CHUNK_SIZE, pcy = py / CHUNK_SIZE, pcz = pz / CHUNK_SIZE;
    const ready: [number, string, number, number, number][] = [];
    for (const key of this.dirty) {
      if (this.inflight.has(key)) continue;
      const [cx, cy, cz] = key.split(",").map(Number);
      if (!this.neighborsReady(cx, cy, cz)) continue;
      const d = (cx + 0.5 - pcx) ** 2 + (cy + 0.5 - pcy) ** 2 * 0.5 + (cz + 0.5 - pcz) ** 2 - (this.urgent.has(key) ? 1000 : 0);
      ready.push([d, key, cx, cy, cz]);
    }
    ready.sort((a, b) => a[0] - b[0]);
    for (const [, key, cx, cy, cz] of ready) {
      const wi = this.busy.indexOf(Math.min(...this.busy));
      if (this.busy[wi] >= 2) break;
      const job = this.jobSeq++;
      this.busy[wi]++;
      this.inflight.set(key, job);
      this.dirty.delete(key);
      this.urgent.delete(key);
      this.post(this.workers[wi], { type: "mesh", job, cx, cy, cz });
    }
  }

  private onMeshed(worker: number, m: WorkerOut): void {
    this.busy[worker]--;
    const key = chunkKey(m.cx, m.cy, m.cz);
    if (this.inflight.get(key) === m.job) this.inflight.delete(key);
    if (!this.chunks.has(key)) return;
    this.meshStats.meshed++;
    this.meshStats.avgMs = this.meshStats.avgMs * 0.95 + m.ms * 0.05;
    this.dropView(key);
    const make = (d: WorkerOut["solid"], mat: THREE.Material, order: number): THREE.Mesh | null => {
      if (d.indices.length === 0) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(d.positions, 3));
      g.setAttribute("uv", new THREE.BufferAttribute(d.uvs, 2));
      g.setAttribute("light", new THREE.BufferAttribute(d.light, 3));
      g.setIndex(new THREE.BufferAttribute(d.indices, 1));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.position.set(m.cx * CHUNK_SIZE, m.cy * CHUNK_SIZE, m.cz * CHUNK_SIZE);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.renderOrder = order;
      this.group.add(mesh);
      return mesh;
    };
    this.views.set(key, { solid: make(m.solid, this.solidMat, 0), water: make(m.water, this.waterMat, 1) });
  }

  private dropView(key: string): void {
    const v = this.views.get(key);
    if (!v) return;
    for (const mesh of [v.solid, v.water]) {
      if (!mesh) continue;
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    this.views.delete(key);
  }

  get pendingMeshes(): number {
    return this.dirty.size + this.inflight.size;
  }

  get meshCount(): number {
    return this.views.size;
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    for (const key of [...this.views.keys()]) this.dropView(key);
  }
}
