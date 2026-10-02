import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, watch, type FSWatcher } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";
import type { ModuleApi } from "./api";
import { Entity } from "./entities";
import type { Game } from "./game";
import { Kernel, type ServerModule } from "./kernel";

const EXAMPLES = resolve(fileURLToPath(new URL("../../../examples/modules", import.meta.url)));
const MODULE_FILE = /\.(ts|js|mjs)$/;

/**
 * Code modules that live with the world (data/<world>/modules/*.ts). Agents
 * (or people) write files there; each new or changed file arrives in the
 * running world as a world event, without a restart:
 *
 *   gathering   import the file and shadow-run it for 2 s of game time
 *               against the real world with all writes discarded
 *   arrival     swap it in between ticks (the world's state stays)
 *   aftershock  if it keeps failing, it is removed again and the previous
 *               version (if any) comes back
 */
export class WorldModules {
  readonly dir: string;
  /** file → module id, for files that are live. */
  private fileToId = new Map<string, string>();
  private watcher: FSWatcher | null = null;
  private debounce = new Map<string, NodeJS.Timeout>();
  /** Last file version (mtime) already queued or loaded, so one save = one event. */
  private seen = new Map<string, number>();
  watching = false;

  constructor(private game: Game) {
    this.dir = join(game.dir, "modules");
  }

  /** Load the world's modules at startup (directly: they were already part of the world). */
  async loadAll(): Promise<void> {
    mkdirSync(this.dir, { recursive: true });
    for (const f of readdirSync(this.dir).filter((f) => MODULE_FILE.test(f)).sort()) {
      try {
        const def = await this.importFile(join(this.dir, f));
        this.game.loadModule(def);
        this.fileToId.set(f, def.id);
        this.seen.set(f, statSync(join(this.dir, f)).mtimeMs);
      } catch (e) {
        this.game.logLine(`[modules] skipped ${f}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  watch(): void {
    if (this.watcher) return;
    this.watching = true;
    this.watcher = watch(this.dir, (_ev, name) => {
      if (!name || !MODULE_FILE.test(name)) return;
      clearTimeout(this.debounce.get(name));
      this.debounce.set(name, setTimeout(() => this.onFile(name, "file watcher"), 300));
    });
  }

  close(): void {
    this.watcher?.close();
    for (const t of this.debounce.values()) clearTimeout(t);
  }

  /** A file appeared, changed or vanished: queue the matching world event. */
  onFile(name: string, by: string): void {
    const path = join(this.dir, name);
    if (!existsSync(path)) {
      this.seen.delete(name);
      return this.submitRemoval(name, by);
    }
    const mtime = statSync(path).mtimeMs;
    if (this.seen.get(name) === mtime) return;
    this.seen.set(name, mtime);
    this.submitLoad(name, by);
  }

  private async importFile(path: string): Promise<ServerModule> {
    // Compile it ourselves and import the result from a data: URL. Every version is a fresh module
    // (Node's loaders cache files by path), and the module can't pull in other code at runtime:
    // everything it can do goes through the api it's given.
    const source = readFileSync(path, "utf8");
    let js: string;
    try {
      js = (await transform(source, { loader: path.endsWith(".ts") ? "ts" : "js", format: "esm", target: "es2022", sourcefile: basename(path) })).code;
    } catch (e) {
      const first = (e as { errors?: { text: string; location?: { line: number } }[] }).errors?.[0];
      throw new Error(first ? `${first.text}${first.location ? ` (line ${first.location.line})` : ""}` : String(e));
    }
    if (/^\s*import\s|\bimport\s*\(|\brequire\s*\(/m.test(js)) throw new Error("modules can't import other code; use the api passed to setup()");
    const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
    const def = (mod.default ?? mod.module) as ServerModule | undefined;
    if (!def || typeof def !== "object") throw new Error("the file must `export default` a module");
    for (const key of ["id", "name", "version", "author", "description"] as const)
      if (typeof def[key] !== "string" || !def[key]) throw new Error(`module is missing "${key}"`);
    if (typeof def.setup !== "function") throw new Error("module is missing setup(api)");
    if (!/^[a-z0-9_-]+:[a-z0-9_-]+$/i.test(def.id)) throw new Error(`id "${def.id}" should look like "author:name"`);
    return def;
  }

  /**
   * Shadow run: set the module up on a scratch kernel with an API whose
   * writes do nothing, then run its tick handlers and timers for a while.
   * It sees the real world but can't change it.
   */
  private dryRun(def: ServerModule, seconds = 2): string | null {
    const scratch = new Kernel({ maxErrors: 1, log: () => {} });
    let error: string | null = null;
    const real = this.game.makeApi(def.id, scratch);
    const noop = () => {};
    const ghost = (type: string, x: number, y: number, z: number) => {
      const t = this.game.reg.entityTypes.get(type);
      if (!t) throw new Error(`unknown entity type "${type}"`);
      return new Entity(-1, t, x, y, z);
    };
    const api: ModuleApi = {
      ...real,
      world: { ...real.world, setBlock: () => true, setBlockEntity: noop, get store() { return real.world.store; } },
      spawnEntity: ghost,
      spawnItem: (x, y, z) => ghost("item", x, y, z),
      damage: () => false, heal: noop, knockback: noop, teleport: noop, setTime: noop,
      openWindow: noop, closeWindow: noop, refreshWindow: noop,
      broadcast: noop, tell: noop, sendNear: noop, worldEvent: noop,
      log: noop,
    };
    try {
      scratch.load(def, () => api);
    } catch (e) {
      return e instanceof Error ? e.message.replace(/^Module \S+ failed to set up: /, "setup failed: ") : String(e);
    }
    const mod = scratch.modules.get(def.id)!;
    const dt = 0.05;
    for (let t = 0; t < seconds && !error; t += dt) {
      scratch.emit("tick", { dt, tick: this.game.tick });
      scratch.runTimers(dt);
      if (!mod.enabled || mod.lastError) error = `error during the shadow run: ${mod.lastError}`;
    }
    const ms = mod.timeMs / (seconds / dt);
    if (!error && ms > 5) error = `too slow: ${ms.toFixed(1)} ms per tick in the shadow run (budget 5 ms)`;
    return error;
  }

  private submitLoad(name: string, by: string): void {
    const path = join(this.dir, name);
    let def: ServerModule | null = null;
    let previous: ServerModule | undefined;
    const known = this.fileToId.get(name);
    const label = known ? this.game.kernel.modules.get(known)?.def.name ?? basename(name) : basename(name);
    this.game.events.submit({
      title: known ? `${label} changes` : `New: ${basename(name).replace(MODULE_FILE, "")}`,
      by,
      size: known ? "minor" : "major",
      detail: `module file ${name}`,
      check: async () => {
        try {
          def = await this.importFile(path);
        } catch (e) {
          const msg = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : JSON.stringify(e);
          return `couldn't load ${name}: ${msg.split("\n")[0]}`;
        }
        if (known && known !== def.id) return `${name} changed its id from ${known} to ${def.id}; remove it and add it again`;
        const owner = [...this.fileToId.entries()].find(([f, id]) => id === def!.id && f !== name);
        if (owner) return `another file (${owner[0]}) already provides ${def.id}`;
        return this.dryRun(def);
      },
      apply: () => {
        previous = this.game.kernel.modules.get(def!.id)?.def;
        this.game.loadModule(def!);
        this.fileToId.set(name, def!.id);
      },
      revert: () => {
        this.game.kernel.unload(def!.id);
        if (previous) this.game.loadModule(previous);
        else this.fileToId.delete(name);
      },
      monitor: () => {
        const m = this.game.kernel.modules.get(def!.id);
        return m && !m.enabled ? `${def!.id} kept failing` : null;
      },
    });
  }

  private submitRemoval(name: string, by: string): void {
    const id = this.fileToId.get(name);
    if (!id) return;
    const def = this.game.kernel.modules.get(id)?.def;
    if (!def) return;
    this.game.events.submit({
      title: `${def.name} fades away`,
      by,
      size: "major",
      detail: `module file ${name}`,
      apply: () => {
        this.game.kernel.unload(id);
        this.fileToId.delete(name);
      },
      revert: () => {
        this.game.loadModule(def);
        this.fileToId.set(name, id);
      },
    });
  }

  listExamples(): string[] {
    return existsSync(EXAMPLES) ? readdirSync(EXAMPLES).filter((f) => MODULE_FILE.test(f)).map((f) => f.replace(MODULE_FILE, "")) : [];
  }

  /** Copy an example module into the world (the watcher, or onFile, takes it from there). */
  install(example: string): string | null {
    const file = readdirSync(EXAMPLES).find((f) => f.replace(MODULE_FILE, "") === example);
    if (!file) return null;
    mkdirSync(this.dir, { recursive: true });
    copyFileSync(join(EXAMPLES, file), join(this.dir, file));
    return file;
  }

  removeById(id: string): string | null {
    const file = [...this.fileToId.entries()].find(([, v]) => v === id)?.[0];
    if (!file) return null;
    unlinkSync(join(this.dir, file));
    return file;
  }

  get files(): [string, string][] {
    return [...this.fileToId.entries()];
  }
}
