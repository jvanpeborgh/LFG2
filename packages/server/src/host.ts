import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { WebSocket } from "ws";
import { START_TIMES, setupRules, setupTheme, type WorldSetup } from "@lfg/shared";
import { Game, type GameOptions } from "./game";
import type { Accounts } from "./accounts";
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
  /** Who can come in once it's open: anyone, or only people invited (and its members). */
  access?: "public" | "invite";
  /** People who've come in with an invite (lowercase names): they can come back without one. */
  members?: string[];
}

/** An invite: a short code for a world, from the player who shared it. */
export interface Invite { world: string; by: string; created: string; uses: number }

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
  accounts?: Accounts;
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
  private invites: Record<string, Invite> = {};
  private idleSince = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;

  constructor(readonly opts: HostOptions) {
    const f = this.file;
    if (existsSync(f)) {
      try { this.entries = JSON.parse(readFileSync(f, "utf8")); } catch { /* keep going */ }
    }
    if (existsSync(this.invitesFile)) {
      try { this.invites = JSON.parse(readFileSync(this.invitesFile, "utf8")); } catch { /* keep going */ }
    }
    if (!this.entries[opts.defaultWorld]) {
      this.entries[opts.defaultWorld] = { name: opts.defaultWorld, title: opts.defaultWorld, description: "", owner: null, open: true, createdAt: new Date().toISOString() };
    }
  }

  private get file(): string {
    return join(this.opts.dataDir, "worlds.json");
  }

  private get invitesFile(): string {
    return join(this.opts.dataDir, "invites.json");
  }

  private save(): void {
    mkdirSync(this.opts.dataDir, { recursive: true });
    writeAtomic(this.file, JSON.stringify(this.entries, null, 2));
  }

  private saveInvites(): void {
    mkdirSync(this.opts.dataDir, { recursive: true });
    writeAtomic(this.invitesFile, JSON.stringify(this.invites, null, 2));
  }

  /** A player's invite code for a world (the same one each time they ask). */
  inviteCode(world: string, by: string): string {
    for (const [code, i] of Object.entries(this.invites)) if (i.world === world && i.by.toLowerCase() === by.toLowerCase()) return code;
    const chars = "abcdefghjkmnpqrstuvwxyz23456789";
    let code = "";
    do { code = ""; for (let i = 0; i < 8; i++) code += chars[randomInt(chars.length)]; } while (this.invites[code]);
    this.invites[code] = { world, by, created: new Date().toISOString(), uses: 0 };
    this.saveInvites();
    return code;
  }

  /** What an invite code opens (null if it's not a code). */
  invite(code: string): (Invite & { title: string; description: string; owner: string | null; players: number; open: boolean; access: "public" | "invite" }) | null {
    const i = this.invites[code.trim().toLowerCase()];
    const e = i && this.entries[i.world];
    if (!i || !e) return null;
    return { ...i, title: e.title, description: e.description, owner: e.owner, players: this.games.get(e.name)?.players.size ?? 0, open: e.open, access: e.access ?? "public" };
  }

  /** Who can play a world: its owner, its members, and anyone if it's public (and open). */
  canSee(e: WorldEntry, name: string): boolean {
    const n = name.toLowerCase();
    return e.owner?.toLowerCase() === n || !!e.members?.includes(n);
  }

  /** Make a world public or invite-only (its creator). */
  setAccess(name: string, by: string, access: "public" | "invite"): string | null {
    const e = this.entries[name];
    if (!e) return "no such world";
    if (!e.owner) return "the server's own world is open to everyone";
    if (e.owner.toLowerCase() !== by.toLowerCase()) return "only the world's creator can change who can join";
    e.access = access;
    this.save();
    return null;
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
      joinCheck: (name, invite) => {
        const cur = this.entries[e.name];
        if (!cur.owner || this.canSee(cur, name)) return null;
        if (!cur.open) return `${cur.title} is still being set up by ${cur.owner}; it opens soon`;
        if ((cur.access ?? "public") === "public") return null;
        // Invite-only: a valid invite for this world makes you a member (so you can come back).
        const i = invite ? this.invites[invite.toLowerCase()] : undefined;
        if (!i || i.world !== cur.name) return `${cur.title} is invite-only: ask someone who plays there for their invite link`;
        cur.members = [...(cur.members ?? []), name.toLowerCase()];
        this.save();
        return null;
      },
      admit: this.opts.accounts ? (name, key) => {
        const why = this.opts.accounts!.admit(name, key);
        if (!why) this.opts.accounts!.setLastWorld(name, e.name);
        return why;
      } : undefined,
      inviter: (invite) => {
        const i = invite ? this.invites[invite.toLowerCase()] : undefined;
        if (!i || i.world !== e.name) return null;
        i.uses++;
        this.saveInvites();
        return i.by;
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
  async create(name: string, owner: string, setup: WorldSetup & { access?: "public" | "invite" } = {}): Promise<{ ok: true; world: WorldInfo; notes: string[] } | { ok: false; error: string }> {
    const n = name.trim().toLowerCase();
    if (!NAME.test(n)) return { ok: false, error: "world names are 3–24 letters, numbers or dashes (e.g. neon-isles)" };
    if (this.entries[n]) return { ok: false, error: `there's already a world called ${n}` };
    if (Object.keys(this.entries).length >= (this.opts.maxWorlds ?? 10)) return { ok: false, error: "this server has as many worlds as it allows" };
    if (Object.values(this.entries).filter((e) => e.owner?.toLowerCase() === owner.toLowerCase()).length >= (this.opts.maxPerOwner ?? 2))
      return { ok: false, error: `you already have ${this.opts.maxPerOwner ?? 2} worlds` };
    const entry: WorldEntry = { name: n, title: (setup.title ?? n).slice(0, 40), description: (setup.description ?? "").slice(0, 200), owner, open: false, createdAt: new Date().toISOString(), preset: setup.preset, access: setup.access ?? "public", members: [] };
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

  // ---------------------------------------------------------------- friends
  /** Where a player is playing right now (null if they're not online anywhere). */
  presence(name: string): { world: string; title: string } | null {
    for (const [w, g] of this.games) if (g.players.has(name.toLowerCase())) return { world: w, title: this.entries[w]?.title ?? w };
    return null;
  }

  private playerAnywhere(name: string): { game: Game; player: import("./player").Player } | null {
    for (const g of this.games.values()) { const p = g.players.get(name.toLowerCase()); if (p) return { game: g, player: p }; }
    return null;
  }

  /** A player's friends as they'd see them from `here` (a world name, or null on the title screen). */
  friendsView(name: string, here: string | null): import("@lfg/shared").FriendHud[] {
    const acc = this.opts.accounts;
    if (!acc) return [];
    return acc.friendsOf(name).map((f) => {
      const at = this.presence(f);
      const e = at ? this.entries[at.world] : undefined;
      const canJoin = !!e && (this.canSee(e, name) || (e.open && (e.access ?? "public") === "public"));
      return { name: f, online: !!at, ...(at ? { world: at.world, title: at.title, here: at.world === here, canJoin } : {}) };
    }).sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  }

  /** Send a player (wherever they are) their friends list. */
  sendFriends(name: string): void {
    const at = this.playerAnywhere(name);
    const acc = this.opts.accounts;
    if (!at || !acc) return;
    at.player.send({ t: "friends", friends: this.friendsView(name, at.game.opts.worldName), requests: acc.requestsOf(name) });
  }

  /** Tell a player's online friends something (and refresh their lists). */
  private toFriends(name: string, text: string | null): void {
    for (const f of this.opts.accounts?.friendsOf(name) ?? []) {
      const at = this.playerAnywhere(f);
      if (!at) continue;
      if (text) at.player.send({ t: "chat", kind: "system", text });
      this.sendFriends(f);
    }
  }

  /** The invite link a player shares for a world. */
  inviteUrl(world: string, by: string): string {
    const base = (this.opts.game.publicUrl ?? "").replace(/\/$/, "");
    return `${base}/?join=${this.inviteCode(world, by)}`;
  }

  private registerCommands(game: Game, world: string): void {
    const acc = this.opts.accounts;
    // Friends: who's online and where (for the social module's /visit and joining next to a friend).
    game.kernel.provide("kernel", "friends", {
      areFriends: (a: string, b: string) => !!acc?.areFriends(a, b),
      presence: (n: string) => this.presence(n),
    });
    game.kernel.on("kernel", "player:join", ({ player, invitedBy }) => {
      if (acc && invitedBy && acc.befriend(player.name, invitedBy)) {
        player.send({ t: "chat", kind: "system", text: `You and ${invitedBy} are friends now: you'll see when each other is online` });
        this.playerAnywhere(invitedBy)?.player.send({ t: "chat", kind: "system", text: `You and ${player.name} are friends now` });
      }
      const title = this.entries[world]?.title ?? world;
      this.toFriends(player.name, `★ ${player.name} is online, in ${title}`);
      this.sendFriends(player.name);
      const asks = acc?.requestsOf(player.name) ?? [];
      if (asks.length) player.send({ t: "chat", kind: "system", text: `${asks.join(", ")} asked to be your friend: /friend ${asks[0]} to accept` });
    });
    game.kernel.on("kernel", "player:leave", ({ player }) => {
      // After they've gone, so they show as offline.
      setTimeout(() => this.toFriends(player.name, null), 0);
    });
    game.kernel.command({
      module: "kernel", name: "friends", usage: "/friends", admin: false,
      help: "Your friends: who's online and where",
      run: (p) => {
        if (!p) return "Players only";
        if (!acc?.get(p.name)) return "Your name isn't kept yet; rejoin from the title screen";
        this.sendFriends(p.name);
        const list = this.friendsView(p.name, world);
        const asks = acc.requestsOf(p.name);
        return [
          list.length ? list.map((f) => `${f.online ? "●" : "○"} ${f.name}${f.online ? (f.here ? " (here: /visit " + f.name + ")" : ` (in ${f.title})`) : ""}`).join("\n") : "No friends yet: /friend <name>, or invite someone (/invite)",
          ...(asks.length ? [`Asked to be your friend: ${asks.join(", ")} (/friend <name> to accept, /friend no <name> to decline)`] : []),
        ].join("\n");
      },
    });
    game.kernel.command({
      module: "kernel", name: "friend", usage: "/friend <name> | no <name> | remove <name>", admin: false,
      help: "Ask someone to be your friend (or accept, decline, or remove a friend)",
      run: (p, [a, b]) => {
        if (!p) return "Players only";
        if (!acc) return "Friends aren't available on this server";
        if (!a) return "Usage: /friend <name>";
        if (a === "remove" && b) return acc.unfriend(p.name, b) ? (this.sendFriends(p.name), this.sendFriends(b), `${b} isn't your friend any more`) : `${b} isn't your friend`;
        if (a === "no" && b) return acc.decline(p.name, b) ? (this.sendFriends(p.name), `Declined ${b}`) : `${b} hasn't asked`;
        const r = acc.request(p.name, a);
        if (r === "already") return `You and ${a} are already friends`;
        if (r === "friends") { this.sendFriends(p.name); this.sendFriends(a); this.playerAnywhere(a)?.player.send({ t: "chat", kind: "system", text: `★ You and ${p.name} are friends now` }); return `★ You and ${a} are friends now`; }
        if (r === "sent") {
          const them = this.playerAnywhere(a);
          if (them) { them.player.send({ t: "chat", kind: "system", text: `${p.name} wants to be your friend: /friend ${p.name} to accept` }); this.sendFriends(a); }
          return `Asked ${a} to be your friend`;
        }
        return `Can't: ${r}`;
      },
    });
    game.kernel.command({
      module: "kernel", name: "invite", usage: "/invite", admin: false,
      help: "Your invite link for this world: friends who use it join next to you",
      run: (p) => {
        if (!p) return "Players only";
        const e = this.entries[world];
        const url = this.inviteUrl(world, p.name);
        p.send({ t: "invite", url, world, title: e.title, access: e.access ?? "public" });
        (game.kernel.services.get("firststeps")?.value as { mark(p: unknown, id: string): void } | undefined)?.mark(p, "invite");
        return `Invite friends to ${e.title} with this link (they join next to you): ${url}`;
      },
    });
    game.kernel.command({
      module: "kernel", name: "device", usage: "/device", admin: false,
      help: "A one-time code to play as you on another device or browser",
      run: (p) => {
        if (!p) return "Players only";
        const accounts = this.opts.accounts;
        if (!accounts?.get(p.name)) return "Your name isn't kept yet (this browser didn't claim it); rejoin from the title screen";
        return `On the other device, choose "Sign in with a code" on the title screen and enter ${accounts.signinCode(p.name)} (it works once, for 10 minutes)`;
      },
    });
    game.kernel.command({
      module: "kernel", name: "worlds", usage: "/worlds", admin: false,
      help: "Worlds on this server (join one with ?world=<name> in the address)",
      run: () => this.list().map((w) => `${w.name === world ? "▶ " : ""}${w.title} (${w.name})${w.owner ? ` by ${w.owner}` : ""} · ${w.open ? `${w.players} playing` : "being set up"}${w.description ? ` · ${w.description}` : ""}`).join("\n"),
    });
    game.kernel.command({
      module: "kernel", name: "world", usage: "/world open | access public|invite | info", admin: false,
      help: "This world: see its setup, or open it to everyone (its creator)",
      run: (p, [sub, ...rest]) => {
        const e = this.entries[world];
        if (sub === "access") {
          if (!p) return "Players only";
          const want = rest[0] === "invite" || rest[0] === "invite-only" ? "invite" : rest[0] === "public" ? "public" : null;
          if (!want) return "Usage: /world access public | invite";
          const err = this.setAccess(world, p.name, want);
          return err ? `Can't: ${err}` : want === "invite" ? `${e.title} is invite-only now: share /invite links` : `${e.title} is open to everyone now`;
        }
        if (sub === "open") {
          if (!p) return "Players only";
          const r = this.open(world, p.name);
          return r.ok ? `${e.title} is open` : `Can't: ${r.error}`;
        }
        return `${e.title} (${e.name})${e.owner ? ` by ${e.owner}` : ""} · ${e.open ? ((e.access ?? "public") === "invite" ? "invite-only" : "open to everyone") : "being set up (/world open when ready)"}${e.preset ? ` · ${e.preset} look` : ""}${e.description ? ` · ${e.description}` : ""}`;
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
