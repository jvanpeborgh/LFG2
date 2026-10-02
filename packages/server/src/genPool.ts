import { Worker } from "node:worker_threads";
import { availableParallelism } from "node:os";

interface Job {
  id: number;
  cx: number;
  cy: number;
  cz: number;
  resolve: (b: Uint16Array) => void;
  reject: (e: Error) => void;
}

/** A small pool of terrain-generation worker threads. */
export class GenPool {
  private workers: { w: Worker; busy: Job | null }[] = [];
  private queue: Job[] = [];
  private nextId = 1;

  constructor(seed: number, modules: string[], size = Math.max(1, Math.min(4, availableParallelism() - 1))) {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL("./genWorkerBoot.mjs", import.meta.url), { workerData: { seed, modules } });
      const slot = { w, busy: null as Job | null };
      w.on("message", (msg: { id: number; blocks: Uint16Array }) => {
        const job = slot.busy;
        slot.busy = null;
        if (job && job.id === msg.id) job.resolve(msg.blocks);
        this.pump();
      });
      w.on("error", (err) => {
        const job = slot.busy;
        slot.busy = null;
        job?.reject(err);
        this.pump();
      });
      this.workers.push(slot);
    }
  }

  generate(cx: number, cy: number, cz: number): Promise<Uint16Array> {
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, cx, cy, cz, resolve, reject });
      this.pump();
    });
  }

  get pending(): number {
    return this.queue.length + this.workers.filter((w) => w.busy).length;
  }

  private pump(): void {
    for (const slot of this.workers) {
      if (slot.busy || this.queue.length === 0) continue;
      const job = this.queue.shift()!;
      slot.busy = job;
      slot.w.postMessage({ id: job.id, cx: job.cx, cy: job.cy, cz: job.cz });
    }
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((s) => s.w.terminate()));
  }
}
