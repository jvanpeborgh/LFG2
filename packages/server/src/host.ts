import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { WebSocket } from "ws";
import { START_TIMES, setupRules, setupTheme, type WorldSetup } from "@lfg/shared";
import { Game, type GameOptions } from "./game";
import type { LinkRegistry } from "./links";
import { writeAtomic } from "./world";

/** What the host remembers about each world (data/worlds.json). */
export interface WorldEntry {
  name: string;
  title: string;
  description: string;
  /** Who created it (null for the server's default world). They're its admin. */
  owner: string | null;
  /** Closed worlds are being set up: only the owner can join. */
  open: boolean;
  createdAt: string;
  preset?: string;
}

export interface WorldInfo extends WorldEntry {
  players: number;
  loaded: boolean;
}

export interface HostOptions {
  dataDir: string;
  defaultWorld: string;
  /** Options every world's Game gets (modules, view distance, event timing…). */
  game: Partial<Omit<GameOptions, "dataDir" | "worldName" | "joinCheck" | "welcome">> & Pick<GameOptions, "modules">;
  links?: LinkRegistry;
  maxWorlds?: number;
  maxPerOwner?: number;
  /** Unload worlds nobody has been in for this long (the default world stays). */
  idleMinutes?: number;
}

const NAME = /^[a-z0-9][a-z0-9-]{2,23}$/;

/**
 * Several worlds on one server: the default one, plus worlds players create
 * (for example from a chat through the MCP server) and set up before anyone
 * else joins: a look, starting time, day length, PvP and other world rules.
 * Worlds load when someone joins and unload when they've been empty a while.
 */
export class WorldHost {
  readonly games = new Map<string, Game>();
  private loading = new Map<string, Promise<Game>>();
  private entries: Record<string, WorldEntry> = {};
  private idleSince = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;

  constructor(readonly opts: HostOptions) {
    const f = this.file;
    if (existsSync(f)) {
      try { this.entries = JSON.parse(readFileSync(f, "utf8")); } catch { /* keep going */ }
    }
    if (!this.entries[opts.defaultWorld]) {
      this.entries[opts.defaultWorld] = { name: opts.defaultWorld, title: opts.defaultWorld, description: "", owner: null, open: true, createdAt: new Date().toISOString() };
    }
  }

  private get file(): string {
    return join(this.opts.dataDir, "worlds.json");
  }

  private save(): void {
    mkdirSync(this.opts.dataDir, { recursive: true });
    writeAtomic(this.file, JSON.stringify(this.entries, null, 2));
  }

  entry(name: string): WorldEntry | undefined {
    return this.entries[name];
  }

  list(): WorldInfo[] {
    return Object.values(this.entries).map((e) => ({ ...e, players: this.games.get(e.name)?.players.size ?? 0, loaded: this.games.has(e.name) }));
  }

  private makeGame(e: WorldEntry, seed?: number): Game {
    const g = this.opts.game;
    return new Game({
      ...g,
      dataDir: this.opts.dataDir,
      worldName: e.name,
      seed: seed ?? g.seed ?? Math.floor(Math.random() * 2 ** 31),
      links: this.opts.links,
      onKernel: (game) => this.registerCommands(game, e.name),
      // Created worlds: their owner is the admin. The default world keeps the server's admin list.
      admins: e.owner ? [e.owner.toLowerCase()] : g.admins ?? [],
      joinCheck: (name) => {
        const cur = this.entries[e.name];
        if (cur.open || !cur.owner || cur.owner.toLowerCase() === name.toLowerCase()) return null;
        return `${cur.title} is still being set up by ${cur.owner}; it opens soon`;
      },
      welcome: () => {
        const cur = this.entries[e.name];
        if (!cur.owner && !cur.description) return null;
        return `Welcome to ${cur.title}${cur.owner ? ` (made by ${cur.owner})` : ""}${cur.description ? `: ${cur.description}` : ""}${cur.open ? "" : " · not open yet: only you can be here while you set it up"}`;
      },
    });
  }

  /** The running game for a world, loading it if needed (null if there's no such world). */
  async get(name: string): Promise<Game | null> {
    const g = this.games.get(name);
    if (g) return g;
    const e = this.entries[name];
    if (!e) return null;
    let p = this.loading.get(name);
    if (!p) {
      p = (async () => {
        const game = this.makeGame(e);
        await game.init();
        game.start();
        this.games.set(name, game);
        return game;
      })();
      this.loading.set(name, p);
      p.finally(() => this.loading.delete(name)).catch(() => {});
    }
    return p;
  }

  /** Create a world (closed until its owner opens it) and apply its setup. */
  async create(name: string, owner: string, setup: WorldSetup = {}): Promise<{ ok: true; world: WorldInfo; notes: string[] } | { ok: false; error: string }> {
    const n = name.trim().toLowerCase();
    if (!NAME.test(n)) return { ok: false, error: "world names are 3–24 letters, numbers or dashes (e.g. neon-isles)" };
    if (this.entries[n]) return { ok: false, error: `there's already a world called ${n}` };
    if (Object.keys(this.entries).length >= (this.opts.maxWorlds ?? 10)) return { ok: false, error: "this server has as many worlds as it allows" };
    if (Object.values(this.entries).filter((e) => e.owner?.toLowerCase() === owner.toLowerCase()).length >= (this.opts.maxPerOwner ?? 2))
      return { ok: false, error: `you already have ${this.opts.maxPerOwner ?? 2} worlds` };
    const entry: WorldEntry = { name: n, title: (setup.title ?? n).slice(0, 40), description: (setup.description ?? "").slice(0, 200), owner, open: false, createdAt: new Date().toISOString(), preset: setup.preset };
    // Check the setup against a fresh copy of the rules before creating anything.
    const game = this.makeGame(entry, setup.seed);
    const check = setupRules(setup, game.std);
    if (check.errors.length) return { ok: false, error: check.errors.join("; ") };
    this.entries[n] = entry;
    this.save();
    await game.init();
    const notes = this.applySetup(game, setup);
    game.start();
    this.games.set(n, game);
    return { ok: true, world: this.list().find((w) => w.name === n)!, notes };
  }

  /** Change a closed world's setup (after it opens, changes go through world events in game). */
  configure(name: string, by: string, setup: WorldSetup): { ok: boolean; notes: string[]; error?: string } {
    const e = this.entries[name];
    const game = this.games.get(name);
    if (!e || !game) return { ok: false, notes: [], error: "no such world (or it isn't loaded)" };
    if (e.owner?.toLowerCase() !== by.toLowerCase()) return { ok: false, notes: [], error: "only the world's creator can set it up" };
    if (e.open) return { ok: false, notes: [], error: "it's open now: change rules in game with /rule (they arrive as world events)" };
    const check = setupRules(setup, game.std);
    if (check.errors.length) return { ok: false, notes: [], error: check.errors.join("; ") };
    if (setup.title) e.title = setup.title.slice(0, 40);
    if (setup.description !== undefined) e.description = setup.description.slice(0, 200);
    if (setup.preset) e.preset = setup.preset;
    this.save();
    return { ok: true, notes: this.applySetup(game, setup) };
  }

  private applySetup(game: Game, setup: WorldSetup): string[] {
    const notes: string[] = [];
    const { changes } = setupRules(setup, game.std);
    for (const [k, v] of changes) game.rules.applyNow(k, v);
    if (changes.length) notes.push(`${changes.length} rule${changes.length > 1 ? "s" : ""} set${setup.preset ? ` (the ${setup.preset} look)` : ""}`);
    const theme = setupTheme(setup);
    if (theme) {
      game.world.meta.theme = { title: theme.title, keywords: theme.keywords, build: theme.build, raidTheme: theme.raidTheme, creatures: theme.creatures, referenceColors: theme.referenceColors, prompt: setup.theme ?? "" };
      notes.push(`the ${theme.title} theme`);
      setup = { ...setup, startTime: setup.startTime ?? theme.startTime };
    }
    if (setup.startTime && START_TIMES[setup.startTime] !== undefined) {
      game.world.meta.time = START_TIMES[setup.startTime] * game.std.art.lighting.dayLengthMinutes * 60;
      for (const p of game.players.values()) p.send({ t: "time", time: game.world.meta.time, dayLength: game.std.art.lighting.dayLengthMinutes * 60 });
      notes.push(`starts at ${setup.startTime}`);
    }
    if (setup.pvp !== undefined) {
      game.world.meta.pvp = setup.pvp;
      notes.push(`PvP ${setup.pvp ? "on" : "off"}`);
    }
    game.saveAll();
    return notes;
  }

  open(name: string, by: string): { ok: boolean; error?: string } {
    const e = this.entries[name];
    if (!e) return { ok: false, error: "no such world" };
    if (e.owner?.toLowerCase() !== by.toLowerCase()) return { ok: false, error: "only the world's creator can open it" };
    e.open = true;
    this.save();
    const g = this.games.get(name);
    if (g) for (const p of g.players.values()) p.send({ t: "chat", kind: "event", text: `🌍 ${e.title} is open: others can join now` });
    return { ok: true };
  }

  /** Hand a socket to the right world (messages that arrive while it loads are replayed). */
  connect(socket: WebSocket, world: string): void {
    const buffered: [unknown, boolean][] = [];
    const hold = (data: unknown, isBinary: boolean) => buffered.push([data, isBinary]);
    socket.on("message", hold);
    this.get(world).then((g) => {
      socket.off("message", hold);
      if (!g) {
        socket.send(JSON.stringify({ t: "reject", reason: `There's no world called "${world}"` }));
        socket.close();
        return;
      }
      g.handleConnection(socket);
      for (const [d, b] of buffered) socket.emit("message", d, b);
    }, (err) => {
      socket.send(JSON.stringify({ t: "reject", reason: `Couldn't load ${world}: ${err instanceof Error ? err.message : err}` }));
      socket.close();
    });
  }

  private registerCommands(game: Game, world: string): void {
    game.kernel.command({
      module: "kernel", name: "worlds", usage: "/worlds", admin: false,
      help: "Worlds on this server (join one with ?world=<name> in the address)",
      run: () => this.list().map((w) => `${w.name === world ? "▶ " : ""}${w.title} (${w.name})${w.owner ? ` by ${w.owner}` : ""} · ${w.open ? `${w.players} playing` : "being set up"}${w.description ? ` · ${w.description}` : ""}`).join("\n"),
    });
    game.kernel.command({
      module: "kernel", name: "world", usage: "/world open | info", admin: false,
      help: "This world: see its setup, or open it to everyone (its creator)",
      run: (p, [sub]) => {
        const e = this.entries[world];
        if (sub === "open") {
          if (!p) return "Players only";
          const r = this.open(world, p.name);
          return r.ok ? `${e.title} is open` : `Can't: ${r.error}`;
        }
        return `${e.title} (${e.name})${e.owner ? ` by ${e.owner}` : ""} · ${e.open ? "open" : "being set up (/world open when ready)"}${e.preset ? ` · ${e.preset} look` : ""}${e.description ? ` · ${e.description}` : ""}`;
      },
    });
  }

  startIdleUnloading(): void {
    this.timer = setInterval(() => void this.unloadIdle(), 60_000);
    this.timer.unref?.();
  }

  private async unloadIdle(): Promise<void> {
    const now = Date.now();
    for (const [name, g] of this.games) {
      if (name === this.opts.defaultWorld || g.players.size > 0) { this.idleSince.delete(name); continue; }
      const since = this.idleSince.get(name) ?? now;
      this.idleSince.set(name, since);
      if (now - since > (this.opts.idleMinutes ?? 10) * 60_000) {
        this.games.delete(name);
        this.idleSince.delete(name);
        await g.stop();
      }
    }
  }

  async stopAll(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    for (const g of this.games.values()) await g.stop();
    this.games.clear();
  }
}
