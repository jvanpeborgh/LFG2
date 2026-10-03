import type { Entity, DamageSource } from "./entities";
import type { Player } from "./player";

/** Every event the kernel can emit. Handlers may mutate the payload (e.g. set `cancelled`). */
export interface GameEvents {
  "player:join": { player: Player; firstTime: boolean };
  "player:leave": { player: Player };
  "player:respawn": { player: Player };
  "player:moved": { player: Player; onGround: boolean; inWater: boolean; fromY: number };
  "intent:dig": { player: Player; action: "start" | "cancel" | "finish"; x: number; y: number; z: number };
  "intent:place": { player: Player; x: number; y: number; z: number; nx: number; ny: number; nz: number; yaw: number; handled: boolean };
  "intent:useBlock": { player: Player; x: number; y: number; z: number; block: number; handled: boolean };
  "intent:useItem": { player: Player; handled: boolean };
  "intent:attack": { player: Player; target: Entity };
  "intent:drop": { player: Player; all: boolean };
  "intent:cast": { player: Player; spell: string };
  "block:changed": { x: number; y: number; z: number; id: number; prev: number; removedEntity?: import("./world").BlockEntity };
  "block:neighbor": { x: number; y: number; z: number; id: number };
  "block:randomTick": { x: number; y: number; z: number; id: number };
  "block:broken": { player?: Player; x: number; y: number; z: number; block: number };
  "entity:damage": { entity: Entity; amount: number; source: DamageSource; cancelled: boolean };
  "entity:death": { entity: Entity; source: DamageSource };
  "window:click": { player: Player };
  tick: { dt: number; tick: number };
}

export type EventName = keyof GameEvents;

/** A server module: the unit agents write, swap and remove. The base game is made of these. */
export interface ServerModule {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  /** Called once when the module is enabled. Register handlers via the api. */
  setup(api: import("./api").ModuleApi): void;
}

interface Handler {
  module: string;
  priority: number;
  fn: (payload: never) => void;
}

interface Timer {
  module: string;
  every: number;
  left: number;
  fn: (dt: number) => void;
}

export interface Command {
  module: string;
  name: string;
  usage: string;
  help: string;
  admin: boolean;
  run(player: Player | null, args: string[]): string | void;
}

interface LoadedModule {
  def: ServerModule;
  enabled: boolean;
  errors: number[];
  timeMs: number;
  lastError?: string;
}

export interface KernelOptions {
  /** Errors within the window before a module is switched off. */
  maxErrors: number;
  errorWindowMs: number;
  onModuleDisabled?: (id: string, reason: string) => void;
  log?: (msg: string) => void;
}

/**
 * The trusted kernel's module host. Every handler a module registers is
 * tagged with the module id, so a module can be switched off, reloaded or
 * blamed. A handler that throws only loses its own work; a module that keeps
 * throwing is disabled automatically (crash-prevention layer 3).
 */
export class Kernel {
  readonly modules = new Map<string, LoadedModule>();
  private handlers = new Map<EventName, Handler[]>();
  private timers: Timer[] = [];
  readonly commands = new Map<string, Command>();
  readonly services = new Map<string, { module: string; value: unknown }>();
  private opts: KernelOptions;

  constructor(opts: Partial<KernelOptions> = {}) {
    this.opts = { maxErrors: 20, errorWindowMs: 10_000, ...opts };
  }

  private log(msg: string): void {
    (this.opts.log ?? console.log)(msg);
  }

  on<E extends EventName>(module: string, event: E, fn: (e: GameEvents[E]) => void, priority = 0): void {
    const list = this.handlers.get(event) ?? [];
    list.push({ module, priority, fn: fn as (p: never) => void });
    list.sort((a, b) => a.priority - b.priority);
    this.handlers.set(event, list);
  }

  every(module: string, seconds: number, fn: (dt: number) => void): void {
    this.timers.push({ module, every: seconds, left: seconds, fn });
  }

  command(cmd: Command): void {
    this.commands.set(cmd.name, cmd);
  }

  provide(module: string, name: string, value: unknown): void {
    this.services.set(name, { module, value });
  }

  use<T>(name: string): T | undefined {
    const s = this.services.get(name);
    if (!s) return undefined;
    if (!this.modules.get(s.module)?.enabled && s.module !== "kernel") return undefined;
    return s.value as T;
  }

  emit<E extends EventName>(event: E, payload: GameEvents[E]): GameEvents[E] {
    const list = this.handlers.get(event);
    if (!list) return payload;
    for (const h of list) {
      const mod = this.modules.get(h.module);
      if (mod && !mod.enabled) continue;
      this.guard(h.module, () => (h.fn as (p: GameEvents[E]) => void)(payload));
    }
    return payload;
  }

  runTimers(dt: number): void {
    for (const t of this.timers) {
      const mod = this.modules.get(t.module);
      if (mod && !mod.enabled) continue;
      t.left -= dt;
      if (t.left <= 0) {
        const elapsed = t.every - t.left;
        t.left += t.every;
        if (t.left < 0) t.left = t.every; // don't spiral after a long stall
        this.guard(t.module, () => t.fn(elapsed));
      }
    }
  }

  /** Run module code with error containment and time accounting. */
  guard(module: string, fn: () => void): void {
    const mod = this.modules.get(module);
    const start = performance.now();
    try {
      fn();
    } catch (err) {
      this.reportError(module, err);
    } finally {
      if (mod) mod.timeMs += performance.now() - start;
    }
  }

  reportError(module: string, err: unknown): void {
    const mod = this.modules.get(module);
    const text = err instanceof Error ? `${err.message}\n${err.stack?.split("\n").slice(1, 4).join("\n")}` : String(err);
    this.log(`[module ${module}] error: ${text}`);
    if (!mod) return;
    const now = Date.now();
    mod.lastError = err instanceof Error ? err.message : String(err);
    mod.errors.push(now);
    mod.errors = mod.errors.filter((t) => now - t < this.opts.errorWindowMs);
    if (mod.enabled && mod.errors.length >= this.opts.maxErrors) {
      mod.enabled = false;
      const reason = `${mod.errors.length} errors in ${this.opts.errorWindowMs / 1000}s (last: ${mod.lastError})`;
      this.log(`[kernel] disabled module ${module}: ${reason}`);
      this.opts.onModuleDisabled?.(module, reason);
    }
  }

  load(def: ServerModule, makeApi: (id: string) => import("./api").ModuleApi): void {
    if (this.modules.has(def.id)) this.unload(def.id);
    const mod: LoadedModule = { def, enabled: true, errors: [], timeMs: 0 };
    this.modules.set(def.id, mod);
    try {
      def.setup(makeApi(def.id));
    } catch (err) {
      this.reportError(def.id, err);
      mod.enabled = false;
      this.unregister(def.id);
      throw new Error(`Module ${def.id} failed to set up: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Remove everything a module registered. World state it created stays. */
  unload(id: string): void {
    this.unregister(id);
    this.modules.delete(id);
  }

  private unregister(id: string): void {
    for (const [ev, list] of this.handlers) this.handlers.set(ev, list.filter((h) => h.module !== id));
    this.timers = this.timers.filter((t) => t.module !== id);
    for (const [name, c] of this.commands) if (c.module === id) this.commands.delete(name);
    for (const [name, s] of this.services) if (s.module === id) this.services.delete(name);
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const mod = this.modules.get(id);
    if (!mod) return false;
    mod.enabled = enabled;
    if (enabled) mod.errors = [];
    return true;
  }

  /** Per-module CPU time since the last call (ms), then reset. */
  takeTimings(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, m] of this.modules) {
      out[id] = m.timeMs;
      m.timeMs = 0;
    }
    return out;
  }
}
