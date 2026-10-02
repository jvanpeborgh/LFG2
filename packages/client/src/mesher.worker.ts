/// <reference lib="webworker" />
import { WorldMirror, meshChunk, type BlockInfo } from "./mesher";

/** Mesh worker: keeps its own mirror of loaded chunks and builds meshes on request. */
export type WorkerIn =
  | { type: "init"; info: BlockInfo }
  | { type: "chunk"; cx: number; cy: number; cz: number; blocks: Uint16Array }
  | { type: "unload"; cx: number; cy: number; cz: number }
  | { type: "set"; changes: [number, number, number, number][] }
  | { type: "mesh"; job: number; cx: number; cy: number; cz: number };

export type WorkerOut = { type: "mesh"; job: number; cx: number; cy: number; cz: number; solid: MeshPayload; water: MeshPayload; ms: number };
type MeshPayload = ReturnType<typeof meshChunk>["solid"];

let info: BlockInfo | null = null;
let world: WorldMirror | null = null;

self.onmessage = (ev: MessageEvent<WorkerIn>) => {
  const m = ev.data;
  if (m.type === "init") {
    info = m.info;
    world = new WorldMirror(info);
    return;
  }
  if (!world || !info) return;
  switch (m.type) {
    case "chunk": world.addChunk(m.cx, m.cy, m.cz, m.blocks); break;
    case "unload": world.removeChunk(m.cx, m.cy, m.cz); break;
    case "set": for (const [x, y, z, id] of m.changes) world.set(x, y, z, id); break;
    case "mesh": {
      const t = performance.now();
      const { solid, water } = meshChunk(world, info, m.cx, m.cy, m.cz);
      const out: WorkerOut = { type: "mesh", job: m.job, cx: m.cx, cy: m.cy, cz: m.cz, solid, water, ms: performance.now() - t };
      const transfer = [solid, water].flatMap((d) => [d.positions.buffer, d.uvs.buffer, d.light.buffer, d.indices.buffer]) as ArrayBuffer[];
      (self as unknown as Worker).postMessage(out, transfer);
      break;
    }
  }
};
