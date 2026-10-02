import { parentPort, workerData } from "node:worker_threads";
import { DEFAULT_STANDARDS, VANILLA_CONTENT, VanillaGenerator, buildRegistry } from "@lfg/shared";

/** Terrain generation off the main thread, so the world keeps ticking while players explore. */
const { seed, modules } = workerData as { seed: number; modules: string[] };
const reg = buildRegistry(modules.length ? modules : [VANILLA_CONTENT.id], DEFAULT_STANDARDS);
const gen = new VanillaGenerator(seed, reg);

parentPort!.on("message", (msg: { id: number; cx: number; cy: number; cz: number }) => {
  const blocks = gen.generate(msg.cx, msg.cy, msg.cz);
  parentPort!.postMessage({ id: msg.id, blocks }, [blocks.buffer as ArrayBuffer]);
});
