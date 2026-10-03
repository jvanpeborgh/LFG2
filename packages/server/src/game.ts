import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { WebSocket } from "ws";
import {
  BlockTable, CHUNK_BITS, cloneStandards, EYE_HEIGHT, PROTOCOL_VERSION, REACH, VanillaGenerator, WORLD_CHUNKS_Y,
  WORLD_HEIGHT, bodyCollides, buildRegistry, chunkKey, cloneStack, encodeChunkFrame, mulberry32, snapshotWindow,
  updateCraftResult, windowClick, type ClientMessage, type ItemStack, type Registry, type ServerMessage, type Slot,
  type Standards, type WindowState, type WorldEventNotice,
} from "@lfg/shared";
import type { ModuleApi } from "./api";
import { Entity, EntityManager, type DamageSource } from "./entities";
import { GenPool } from "./genPool";
import { Kernel, type ServerModule } from "./kernel";
import { Player, type OpenWindow, type SavedPlayer } from "./player";
import { WorldStore, writeAtomic } from "./world";
import { WorldEventQueue, type EventTiming } from "./worldEvents";
import { WorldRules } from "./rules";
import { WorldModules } from "./moduleLoader";

export interface GameOptions {
  dataDir: string;
  worldName: string;
  seed: number;
  modules: ServerModule[];
  contentModules: string[];
  viewDistance: number;
  tickRate: number;
  /** Players with these names get admin commands (empty = everyone, handy for local play). */
  admins: string[];
  log?: (msg: string) => void;
  /** Seed for gameplay randomness (default: time-based). Tests set it to make runs reproducible. */
  randomSeed?: number;
  /** Override world-event timing (tests and local tinkering use short timings). */
  eventTiming?: Partial<EventTiming>;
  /** The server can transcribe voice commands (see transcribe.ts). */
  voiceServer?: boolean;
}

const ENTITY_VIEW = 80;

export class Game {
  readonly reg: Registry;
  readonly std: Standards;
  readonly table: BlockTable;
  readonly kernel: Kernel;
  readonly entities: EntityManager;
  world!: WorldStore;
  private pool!: GenPool;
  readonly players = new Map<string, Player>();
  private byEntity = new Map<number, Player>();
  tick = 0;
  private timer: NodeJS.Timeout | null = null;
  private lastTick = 0;
  private rand = mulberry32(Date.now() >>> 0);
  private saveTimer = 0;
  private tickTimes: number[] = [];
  readonly opts: GameOptions;
  private log: (msg: string) => void;
  private generator!: VanillaGenerator;
  /** Encoded chunk frames, reused for every player until the chunk changes. */
  private frameCache = new Map<string, { version: number; buf: ArrayBuffer }>();
  /** Every change to the running world goes through here, as a world event. */
  readonly events: WorldEventQueue;
  readonly rules: WorldRules;
  worldModules!: WorldModules;

  constructor(opts: Partial<GameOptions> & Pick<GameOptions, "modules">) {
    this.opts = {
      dataDir: "data",
      worldName: "world",
      seed: 12345,
      contentModules: ["vanilla:content"],
      viewDistance: 4,
      tickRate: 20,
      admins: [],
      ...opts,
    };
    this.log = this.opts.log ?? ((m) => console.log(m));
    this.rand = mulberry32(this.opts.randomSeed ?? (Date.now() >>> 0));
    // Each world has its own copy of the standards: in-game rule changes edit this copy.
    this.std = cloneStandards();
    this.reg = buildRegistry(this.opts.contentModules, this.std);
    this.table = new BlockTable(this.reg);
    this.entities = new EntityManager(this.reg);
    this.kernel = new Kernel({
      log: this.log,
      onModuleDisabled: (id, reason) =>
        this.worldEvent({ phase: "undo", title: `${this.kernel.modules.get(id)?.def.name ?? id} switched off`, by: "kernel", detail: reason }),
    });
    const pacing = this.std.pacing;
    this.events = new WorldEventQueue(
      {
        gatherSeconds: { minor: 3, major: 5, epic: 10 },
        watchSeconds: 30,
        spacingSeconds: {
          minor: pacing.eventSpacingSeconds.minor,
          major: pacing.eventSpacingSeconds.major,
          epic: pacing.standardsChangeMinMinutes * 60,
        },
        ...this.opts.eventTiming,
      },
      {
        announce: (n) => this.worldEvent(n),
        health: () => ({
          disabledModules: [...this.kernel.modules.entries()].filter(([, m]) => !m.enabled).map(([id]) => id),
          avgTickMs: this.stats().avgTickMs,
          playersOnline: this.players.size,
        }),
        log: this.log,
        reenable: (ids) => { for (const id of ids) this.kernel.setEnabled(id, true); },
      },
    );
    this.rules = new WorldRules(this);
  }

  get dir(): string {
    return join(this.opts.dataDir, this.opts.worldName);
  }

  async init(): Promise<void> {
    const meta = WorldStore.loadMeta(this.dir, this.opts.seed);
    const seed = meta?.seed ?? this.opts.seed;
    this.pool = new GenPool(seed, this.opts.contentModules);
    this.generator = new VanillaGenerator(seed, this.reg);
    this.world = new WorldStore(this.dir, this.reg, this.table, this.pool, meta ?? {
      seed,
      time: 0,
      spawn: this.generator.findSpawn(),
      created: new Date().toISOString(),
    });
    this.registerKernelCommands();
    this.rules.restore();
    for (const m of this.opts.modules) this.loadModule(m);
    this.worldModules = new WorldModules(this);
    await this.worldModules.loadAll();
    const [sx, , sz] = this.world.meta.spawn;
    await this.world.ensureArea(Math.floor(sx), Math.floor(sz), 1);
    if (!meta) this.world.meta.spawn = this.groundSpawn(Math.floor(sx), Math.floor(sz));
    this.log(`[world] "${this.opts.worldName}" seed ${seed}, spawn ${this.world.meta.spawn.map((v) => v.toFixed(1)).join(", ")}`);
  }

  private registerKernelCommands(): void {
    const k = this.kernel;
    // The event pipeline watches for changes that suddenly kill lots of players.
    k.on("kernel", "entity:death", (e) => { if (this.byEntity.has(e.entity.id)) this.events.playerDied(); });
    this.rules.registerCommands();
    // Modules submit world changes (summons, …) through the same event queue.
    k.provide("kernel", "kernel:events", this.events);
    k.provide("kernel", "kernel:commands", () => [...k.commands.values()].sort((a, b) => a.name.localeCompare(b.name)));
    k.command({
      module: "kernel", name: "modules", usage: "/modules", help: "List the modules running this world", admin: false,
      run: () => [...k.modules.values()].map((m) => `${m.enabled ? "●" : "○"} ${m.def.id} — ${m.def.description}${m.lastError ? ` (last error: ${m.lastError})` : ""}`).join("\n"),
    });
    k.command({
      module: "kernel", name: "module",
      usage: "/module on|off <id> | install <example> | remove <id> | examples",
      help: "Change which modules run this world (each change is a world event)", admin: true,
      run: (p, [action, arg]) => {
        const by = p?.name ?? "console";
        if (action === "examples") return `Examples: ${this.worldModules.listExamples().join(", ")}\nInstall one with /module install <name>`;
        if (action === "install") {
          const file = arg ? this.worldModules.install(arg, by) : null;
          if (!file) return `No example "${arg}". Try /module examples`;
          if (!this.worldModules.watching) this.worldModules.onFile(file, by);
          return `Added ${file} to the world; it arrives as a world event.`;
        }
        if (action === "remove") {
          const file = arg ? this.worldModules.removeById(arg, by) : null;
          if (!file) return `${arg} isn't a world module file (vanilla modules can be switched off with /module off)`;
          if (!this.worldModules.watching) this.worldModules.onFile(file, by);
          return `Removed ${file}; it fades away as a world event.`;
        }
        const mod = arg ? k.modules.get(arg) : undefined;
        if (!mod || (action !== "on" && action !== "off")) return "Usage: /module on|off <id> (see /modules), /module examples";
        const on = action === "on";
        this.events.submit({
          title: `${mod.def.name} ${on ? "returns" : "fades away"}`,
          by,
          size: "major",
          detail: `module ${arg}`,
          apply: () => { k.setEnabled(arg!, on); },
          revert: () => { k.setEnabled(arg!, !on); },
        });
        return `${mod.def.name} will ${on ? "return" : "fade away"} shortly`;
      },
    });
    k.command({
      module: "kernel", name: "stats", usage: "/stats", help: "Server performance", admin: false,
      run: () => {
        const s = this.stats();
        const t = Object.entries(k.takeTimings()).filter(([, ms]) => ms > 0.5).map(([id, ms]) => `${id} ${ms.toFixed(0)}ms`).join(", ");
        return `tick ${s.avgTickMs}ms · ${s.players} players · ${s.entities} entities · ${s.chunks} chunks · gen queue ${s.pendingGen}${t ? `\nmodule time since last /stats: ${t}` : ""}`;
      },
    });
  }

  loadModule(def: ServerModule): void {
    this.kernel.load(def, (id) => this.makeApi(id));
    this.log(`[kernel] loaded module ${def.id} (${def.name} ${def.version})`);
  }

  logLine(msg: string): void {
    this.log(msg);
  }

  start(): void {
    this.worldModules.watch();
    this.lastTick = performance.now();
    const interval = 1000 / this.opts.tickRate;
    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.25, (now - this.lastTick) / 1000);
      this.lastTick = now;
      this.step(dt);
      const spent = performance.now() - now;
      this.tickTimes.push(spent);
      if (this.tickTimes.length > 100) this.tickTimes.shift();
      this.timer = setTimeout(loop, Math.max(0, interval - spent));
    };
    this.timer = setTimeout(loop, interval);
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.worldModules?.close();
    this.saveAll();
    // Everything is saved: sockets that close from here on must not write again (the data dir may be gone).
    this.stopped = true;
    for (const p of this.players.values()) p.socket.close();
    await this.pool.close();
  }

  stats(): { players: number; entities: number; chunks: number; avgTickMs: number; pendingGen: number } {
    const avg = this.tickTimes.reduce((a, b) => a + b, 0) / Math.max(1, this.tickTimes.length);
    return { players: this.players.size, entities: this.entities.all.size, chunks: this.world.chunks.size, avgTickMs: +avg.toFixed(2), pendingGen: this.pool.pending };
  }

  // ------------------------------------------------------------------ tick

  step(dt: number): void {
    this.tick++;
    this.kernel.emit("tick", { dt, tick: this.tick });
    this.events.step(dt);
    this.kernel.runTimers(dt);
    for (const e of this.entities.all.values()) {
      e.age += dt;
      if (e.invulnerable > 0) e.invulnerable -= dt;
    }
    for (const p of this.players.values()) {
      p.sinceDamage += dt;
      p.chatTokens = Math.min(5, p.chatTokens + dt);
    }
    this.processNeighbors();
    this.randomTicks();
    this.flushBlockChanges();
    this.syncEntities();
    for (const p of this.players.values()) {
      if (p.selfDirty) p.sendSelf();
      if (p.windowDirty) this.sendWindow(p);
      this.streamChunks(p);
    }
    this.saveTimer += dt;
    if (this.saveTimer > 30) {
      this.saveTimer = 0;
      this.saveAll();
      this.unloadFarChunks();
    }
  }

  private processNeighbors(): void {
    const q = this.world.neighborQueue;
    if (q.length === 0) return;
    const seen = new Set<string>();
    const batch = q.splice(0, Math.min(q.length, 6000));
    for (const [x, y, z] of batch) {
      const k = `${x},${y},${z}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (!this.world.isLoaded(x, y, z)) continue;
      this.kernel.emit("block:neighbor", { x, y, z, id: this.world.getBlock(x, y, z) });
    }
  }

  private randomTicks(): void {
    const keys = new Set<string>();
    for (const p of this.players.values()) {
      const cx = Math.floor(p.entity.x) >> CHUNK_BITS, cz = Math.floor(p.entity.z) >> CHUNK_BITS;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) for (let cy = 0; cy < WORLD_CHUNKS_Y; cy++) keys.add(chunkKey(cx + dx, cy, cz + dz));
    }
    for (const [x, y, z, id] of this.world.randomPositions(keys, 3, this.rand)) this.kernel.emit("block:randomTick", { x, y, z, id });
  }

  private flushBlockChanges(): void {
    const changes = this.world.changes.splice(0);
    if (changes.length === 0) return;
    for (const c of changes) this.kernel.emit("block:changed", c);
    for (const p of this.players.values()) {
      const mine = changes.filter((c) => p.loadedChunks.has(chunkKey(c.x >> CHUNK_BITS, c.y >> CHUNK_BITS, c.z >> CHUNK_BITS)));
      if (mine.length) p.send({ t: "blocks", changes: mine.map((c) => [c.x, c.y, c.z, this.world.getBlock(c.x, c.y, c.z)]) });
    }
  }

  private syncEntities(): void {
    const removed = this.entities.removedThisTick.splice(0);
    for (const p of this.players.values()) {
      const spawns = [];
      const moves: number[] = [];
      const despawn: number[] = [];
      for (const id of removed) if (p.knownEntities.delete(id)) despawn.push(id);
      for (const e of this.entities.near(p.entity.x, p.entity.y, p.entity.z, ENTITY_VIEW)) {
        if (e === p.entity) continue;
        if (!p.knownEntities.has(e.id)) {
          p.knownEntities.add(e.id);
          spawns.push(e.spawnInfo());
          continue;
        }
      }
      for (const id of p.knownEntities) {
        const e = this.entities.get(id);
        if (!e || e.distanceSq(p.entity.x, p.entity.y, p.entity.z) > (ENTITY_VIEW + 8) ** 2) {
          p.knownEntities.delete(id);
          despawn.push(id);
          continue;
        }
        const s = e.lastSent;
        if (s[0] !== e.x || s[1] !== e.y || s[2] !== e.z || s[3] !== e.yaw || s[4] !== e.pitch || s[5] !== e.flags)
          moves.push(e.id, round(e.x), round(e.y), round(e.z), round(e.yaw), round(e.pitch), e.flags);
      }
      if (despawn.length) p.send({ t: "despawn", ids: despawn });
      if (spawns.length) p.send({ t: "spawn", entities: spawns });
      if (moves.length) p.send({ t: "moves", e: moves });
    }
    for (const e of this.entities.all.values()) e.lastSent = [e.x, e.y, e.z, e.yaw, e.pitch, e.flags];
  }

  private desiredChunks(p: Player): string[] {
    const r = this.opts.viewDistance;
    const cx = Math.floor(p.entity.x) >> CHUNK_BITS, cz = Math.floor(p.entity.z) >> CHUNK_BITS;
    const cyP = Math.max(0, Math.min(WORLD_CHUNKS_Y - 1, Math.floor(p.entity.y) >> CHUNK_BITS));
    const out: [number, string][] = [];
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > (r + 0.5) ** 2) continue;
        for (let cy = 0; cy < WORLD_CHUNKS_Y; cy++) out.push([dx * dx + dz * dz + Math.abs(cy - cyP) * 0.8, chunkKey(cx + dx, cy, cz + dz)]);
      }
    out.sort((a, b) => a[0] - b[0]);
    return out.map((o) => o[1]);
  }

  private streamChunks(p: Player): void {
    const want = this.desiredChunks(p);
    const wantSet = new Set(want);
    for (const key of [...p.loadedChunks]) {
      if (!wantSet.has(key)) {
        // Keep a margin so walking back and forth doesn't resend.
        const [kx, ky, kz] = key.split(",").map(Number);
        const cx = Math.floor(p.entity.x) >> CHUNK_BITS, cz = Math.floor(p.entity.z) >> CHUNK_BITS;
        if (Math.max(Math.abs(kx - cx), Math.abs(kz - cz)) > this.opts.viewDistance + 1) {
          p.loadedChunks.delete(key);
          p.send({ t: "unloadChunk", cx: kx, cy: ky, cz: kz });
        }
      }
    }
    let sent = 0;
    let requested = 0;
    for (const key of want) {
      if (p.loadedChunks.has(key)) continue;
      const chunk = this.world.chunks.get(key);
      if (chunk) {
        if (sent >= 16) continue;
        let cached = this.frameCache.get(key);
        if (!cached || cached.version !== chunk.version) {
          cached = { version: chunk.version, buf: encodeChunkFrame(chunk.cx, chunk.cy, chunk.cz, chunk.blocks) };
          this.frameCache.set(key, cached);
        }
        p.sendBinary(cached.buf);
        p.loadedChunks.add(key);
        sent++;
      } else if (requested < 8 && this.pool.pending < 24) {
        const [cx, cy, cz] = key.split(",").map(Number);
        void this.world.ensureChunk(cx, cy, cz);
        requested++;
      }
    }
  }

  private unloadFarChunks(): void {
    const keep = new Set<string>();
    for (const p of this.players.values()) for (const k of this.desiredChunks(p)) keep.add(k);
    const [sx, , sz] = this.world.meta.spawn;
    const scx = Math.floor(sx) >> CHUNK_BITS, scz = Math.floor(sz) >> CHUNK_BITS;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (let cy = 0; cy < WORLD_CHUNKS_Y; cy++) keep.add(chunkKey(scx + dx, cy, scz + dz));
    this.world.unloadExcept(keep);
    for (const key of this.frameCache.keys()) if (!this.world.chunks.has(key)) this.frameCache.delete(key);
  }

  saveAll(): void {
    try {
      const n = this.world.save();
      for (const p of this.players.values()) this.savePlayer(p);
      if (n > 0) this.log(`[world] saved ${n} chunks`);
    } catch (err) {
      this.log(`[world] save failed: ${err}`);
    }
  }

  private stopped = false;
  /** Voice tokens of connected players (for the transcription endpoint). */
  private voiceTokens = new Map<string, Player>();

  private voiceTokenFor(p: Player): string {
    const token = randomBytes(18).toString("base64url");
    this.voiceTokens.set(token, p);
    return token;
  }

  /** Which connected player a voice token belongs to (or null). */
  playerForVoiceToken(token: string): string | null {
    const p = this.voiceTokens.get(token);
    return p && this.players.get(p.name.toLowerCase()) === p ? p.name : null;
  }

  private savePlayer(p: Player): void {
    if (this.stopped) return;
    writeAtomic(join(this.dir, "players", `${encodeURIComponent(p.name)}.json`), JSON.stringify(p.toSave()));
  }

  private loadPlayer(name: string): SavedPlayer | null {
    const file = join(this.dir, "players", `${encodeURIComponent(name)}.json`);
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, "utf8")) as SavedPlayer;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------ helpers used by modules

  /** A spot on natural ground (not on top of a tree) near x,z, searching outward. */
  private groundSpawn(x: number, z: number): [number, number, number] {
    const ground = new Set(["grass", "dirt", "sand", "snowy_grass", "snow", "gravel", "stone"].map((n) => this.reg.blockId(n)));
    for (let r = 0; r <= 24; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const bx = x + dx, bz = z + dz;
          const y = this.world.surfaceY(bx, bz);
          if (y < 0 || !ground.has(this.world.getBlock(bx, y, bz))) continue;
          if (this.table.solid[this.world.getBlock(bx, y + 1, bz)] || this.table.solid[this.world.getBlock(bx, y + 2, bz)]) continue;
          if (this.table.liquid[this.world.getBlock(bx, y + 1, bz)]) continue;
          return [bx + 0.5, y + 1, bz + 0.5];
        }
    return this.safeSpot(x, this.world.meta.spawn[1], z);
  }

  /** First position at or above y where a player fits. */
  safeSpot(x: number, y: number, z: number): [number, number, number] {
    const bx = Math.floor(x), bz = Math.floor(z);
    let yy = Math.max(1, Math.floor(y));
    for (; yy < WORLD_HEIGHT - 2; yy++) {
      const below = this.world.getBlock(bx, yy - 1, bz);
      if (this.table.solid[below] && !this.table.solid[this.world.getBlock(bx, yy, bz)] && !this.table.solid[this.world.getBlock(bx, yy + 1, bz)]) break;
    }
    return [bx + 0.5, yy, bz + 0.5];
  }

  respawnPoint(p: Player): [number, number, number] {
    const s = p.spawnPoint ?? this.world.meta.spawn;
    return this.safeSpot(s[0], s[1], s[2]);
  }

  damage(target: Entity, amount: number, source: DamageSource): boolean {
    if (target.removed || amount <= 0) return false;
    const player = this.byEntity.get(target.id);
    if (player && (player.dead || player.gameMode === "creative") && source.kind !== "void" && source.kind !== "command") return false;
    if (target.invulnerable > 0 && source.kind === "melee") return false;
    const ev = this.kernel.emit("entity:damage", { entity: target, amount, source, cancelled: false });
    if (ev.cancelled || ev.amount <= 0) return false;
    target.health -= ev.amount;
    if (source.kind === "melee") target.invulnerable = 0.5;
    target.flags |= 1;
    setTimeout(() => (target.flags &= ~1), 250);
    this.sendNear(target.x, target.y, target.z, ENTITY_VIEW, { t: "entityEvent", id: target.id, event: "hurt" });
    if (player) {
      player.sinceDamage = 0;
      player.selfDirty = true;
      player.send({ t: "entityEvent", id: target.id, event: "hurt" });
    }
    if (target.health <= 0) {
      this.kernel.emit("entity:death", { entity: target, source });
      if (player) {
        player.dead = true;
        player.entity.health = 0;
        player.selfDirty = true;
        const by = source.attacker ? (this.byEntity.get(source.attacker.id)?.name ?? source.attacker.type.displayName) : null;
        const how: Record<string, string> = {
          fall: "fell from a high place", explosion: "blew up", starve: "starved", drown: "drowned", cactus: "was pricked to death",
          void: "fell out of the world", fire: "burned", command: "was killed", melee: "was slain",
        };
        this.broadcast(`${player.name} ${how[source.kind] ?? "died"}${by ? ` by ${by}` : ""}`, "system");
      } else {
        this.entities.remove(target);
      }
    }
    return true;
  }

  knockback(target: Entity, fromX: number, fromZ: number, strength: number): void {
    const dx = target.x - fromX, dz = target.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    const vx = (dx / d) * strength, vz = (dz / d) * strength, vy = strength * 0.6;
    const p = this.byEntity.get(target.id);
    if (p) p.send({ t: "velocity", vx, vy, vz });
    else {
      target.body.vx += vx;
      target.body.vz += vz;
      target.body.vy = Math.max(target.body.vy, vy);
    }
  }

  spawnItem(x: number, y: number, z: number, stack: ItemStack, vel?: [number, number, number]): Entity {
    const e = this.entities.spawn("item", x, y, z, "kernel");
    e.data.item = { ...stack };
    e.data.pickupDelay = 0.6;
    const [vx, vy, vz] = vel ?? [(this.rand() - 0.5) * 2, 3, (this.rand() - 0.5) * 2];
    e.body.vx = vx; e.body.vy = vy; e.body.vz = vz;
    return e;
  }

  inventoryWindow(p: Player): WindowState {
    return {
      kind: "inventory",
      sections: [
        { id: "result", role: "result", slots: [null] },
        { id: "craft", role: "craftGrid", width: 2, slots: p.craftGrid },
        { id: "main", role: "storage", slots: p.main },
        { id: "hotbar", role: "storage", slots: p.hotbar },
      ],
    };
  }

  openWindow(p: Player, w: OpenWindow): void {
    if (p.window) this.closeWindow(p, false);
    p.window = w;
    updateCraftResult(this.reg, w.state);
    this.sendWindow(p);
  }

  closeWindow(p: Player, notify = true): void {
    const w = p.window;
    p.window = null;
    w?.onClose?.();
    // Items left in the 2×2 grid or on the cursor go back to the inventory (or drop).
    const back: Slot[] = [...p.craftGrid, p.cursor.stack];
    p.craftGrid.fill(null);
    p.cursor.stack = null;
    for (const s of back) if (s) this.giveOrDrop(p, s);
    p.selfDirty = true;
    if (notify) p.send({ t: "window", window: null, cursor: null });
  }

  giveOrDrop(p: Player, s: ItemStack): void {
    const left = p.give(s);
    if (left > 0) this.spawnItem(p.entity.x, p.entity.y + 1.2, p.entity.z, { ...s, count: left });
  }

  sendWindow(p: Player): void {
    p.windowDirty = false;
    const state = p.window?.state ?? null;
    const snap = state ? snapshotWindow(state) : null;
    if (snap && p.window?.pos) {
      const be = this.world.getBlockEntity(...p.window.pos);
      if (be?.kind === "furnace") {
        snap.progress = (be.data.cook ?? 0) / 10;
        snap.fuel = be.data.burnMax ? (be.data.burn ?? 0) / be.data.burnMax : 0;
      }
    }
    p.send({ t: "window", window: snap, cursor: cloneStack(p.cursor.stack) });
  }

  teleport(p: Player, x: number, y: number, z: number): void {
    p.entity.body.x = x; p.entity.body.y = y; p.entity.body.z = z;
    p.entity.body.vx = p.entity.body.vy = p.entity.body.vz = 0;
    p.fallStartY = null;
    p.send({ t: "teleport", x, y, z });
  }

  broadcast(text: string, kind: "chat" | "system" | "event" = "system", from?: string): void {
    this.log(`[chat] ${from ? `<${from}> ` : ""}${text}`);
    for (const p of this.players.values()) p.send({ t: "chat", kind, text, from });
  }

  sendNear(x: number, y: number, z: number, radius: number, msg: ServerMessage): void {
    for (const p of this.players.values()) if (p.entity.distanceSq(x, y, z) <= radius * radius) p.send(msg);
  }

  worldEvent(notice: WorldEventNotice): void {
    this.log(`[event] ${notice.phase}: ${notice.title} (${notice.by})${notice.detail ? ` — ${notice.detail}` : ""}`);
    for (const p of this.players.values()) p.send({ t: "worldEvent", event: notice });
  }

  /** The API a module gets. `kernel` can be a scratch kernel, for dry runs. */
  makeApi(id: string, k: Kernel = this.kernel): ModuleApi {
    const game = this;
    return {
      id,
      reg: this.reg,
      std: this.std,
      table: this.table,
      entities: this.entities,
      world: {
        getBlock: (x, y, z) => game.world.getBlock(x, y, z),
        setBlock: (x, y, z, b) => game.world.setBlockTracked(x, y, z, b),
        isLoaded: (x, y, z) => game.world.isLoaded(x, y, z),
        getBlockEntity: (x, y, z) => game.world.getBlockEntity(x, y, z),
        setBlockEntity: (x, y, z, be) => game.world.setBlockEntity(x, y, z, be),
        blockEntities: () => game.world.blockEntities.entries(),
        surfaceY: (x, z) => game.world.surfaceY(x, z),
        get store() { return game.world; },
      },
      on: (event, fn, priority) => k.on(id, event, fn, priority),
      every: (s, fn) => k.every(id, s, fn),
      command: (cmd) => k.command({ ...cmd, module: id }),
      provide: (name, value) => k.provide(id, name, value),
      use: (name) => k.use(name),
      emit: (event, payload) => k.emit(event, payload),
      players: () => [...game.players.values()],
      playerByName: (name) => game.players.get(name.toLowerCase()),
      spawnEntity: (type, x, y, z) => game.entities.spawn(type, x, y, z, id),
      spawnItem: (x, y, z, s, v) => game.spawnItem(x, y, z, s, v),
      damage: (t, a, s) => game.damage(t, a, s),
      heal: (t, a) => {
        t.health = Math.min(t.type.maxHealth, t.health + a);
        const p = game.byEntity.get(t.id);
        if (p) p.selfDirty = true;
      },
      playerOf: (e) => game.byEntity.get(e.id),
      openWindow: (p, w) => game.openWindow(p, w),
      closeWindow: (p) => game.closeWindow(p),
      inventoryWindow: (p) => game.inventoryWindow(p),
      refreshWindow: (p) => { p.windowDirty = true; },
      teleport: (p, x, y, z) => game.teleport(p, x, y, z),
      knockback: (t, x, z, s) => game.knockback(t, x, z, s),
      respawnPoint: (p) => game.respawnPoint(p),
      broadcast: (text, kind) => game.broadcast(text, kind ?? "system"),
      tell: (p, text) => p.send({ t: "chat", kind: "system", text }),
      sendNear: (x, y, z, r, msg) => game.sendNear(x, y, z, r, msg),
      worldEvent: (n) => game.worldEvent(n),
      time: () => ({ time: game.world.meta.time, dayLength: game.std.art.lighting.dayLengthMinutes * 60 }),
      setTime: (t) => { game.world.meta.time = t; },
      rand: () => game.rand(),
      log: (msg) => game.log(`[${id}] ${msg}`),
    };
  }

  // ------------------------------------------------------------------ networking

  handleConnection(socket: WebSocket): void {
    let player: Player | null = null;
    let closed = false;
    const timeout = setTimeout(() => { if (!player) socket.close(); }, 10_000);
    socket.on("message", (data, isBinary) => {
      if (isBinary) return;
      let msg: ClientMessage;
      try {
        const text = data.toString();
        if (text.length > 4096) return;
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (!player) {
        if (msg.t === "hello") {
          player = this.join(socket, msg);
          clearTimeout(timeout);
          if (closed && player) this.leave(player);
        }
        return;
      }
      try {
        this.handle(player, msg);
      } catch (err) {
        this.log(`[net] error handling ${msg.t} from ${player.name}: ${err instanceof Error ? err.stack : err}`);
      }
    });
    socket.on("close", () => {
      closed = true;
      clearTimeout(timeout);
      if (player) this.leave(player);
    });
    socket.on("error", () => socket.close());
  }

  private join(socket: WebSocket, msg: Extract<ClientMessage, { t: "hello" }>): Player | null {
    const reject = (reason: string) => {
      socket.send(JSON.stringify({ t: "reject", reason } satisfies ServerMessage));
      socket.close();
      return null;
    };
    const name = String(msg.name ?? "").trim();
    if (!/^[A-Za-z0-9_]{2,16}$/.test(name)) return reject("Name must be 2–16 letters, numbers or _");
    if (msg.protocol !== PROTOCOL_VERSION) return reject(`Version mismatch (server ${PROTOCOL_VERSION}, client ${msg.protocol}). Reload the page.`);
    if (msg.fingerprint !== this.reg.fingerprint()) return reject("Game content mismatch. Reload the page.");
    if (this.players.has(name.toLowerCase())) return reject("That name is already playing");

    const saved = this.loadPlayer(name);
    const pos = saved ? this.safeSpot(saved.x, saved.y, saved.z) : this.respawnPoint({ spawnPoint: null } as Player);
    const entity = this.entities.spawn("player", pos[0], pos[1], pos[2]);
    entity.data.name = name;
    const p = new Player(name, socket, entity, this.reg);
    p.admin = this.opts.admins.length === 0 || this.opts.admins.includes(name.toLowerCase());
    if (saved) {
      entity.yaw = saved.yaw;
      entity.pitch = saved.pitch;
      entity.health = saved.health > 0 ? saved.health : entity.type.maxHealth;
      p.hunger = saved.hunger;
      p.gameMode = saved.gameMode;
      p.hotbar = saved.hotbar;
      p.main = saved.main;
      p.selected = saved.selected;
      p.spawnPoint = saved.spawn ?? null;
      p.data = saved.data ?? {};
    }
    this.players.set(name.toLowerCase(), p);
    this.byEntity.set(entity.id, p);
    const day = this.std.art.lighting.dayLengthMinutes * 60;
    p.send({
      t: "welcome",
      playerId: entity.id,
      modules: this.opts.contentModules,
      fingerprint: this.reg.fingerprint(),
      spawn: this.world.meta.spawn,
      position: pos,
      gameMode: p.gameMode,
      time: this.world.meta.time,
      dayLength: day,
      seed: this.world.meta.seed,
      viewDistance: this.opts.viewDistance,
      standards: this.std,
      voice: { token: this.voiceTokenFor(p), server: !!this.opts.voiceServer },
    });
    p.lastMoveAt = performance.now();
    p.sendSelf();
    this.kernel.emit("player:join", { player: p, firstTime: !saved });
    this.broadcast(`${name} joined the world`, "system");
    this.sendPlayerList();
    return p;
  }

  private leave(p: Player): void {
    if (!this.players.has(p.name.toLowerCase())) return;
    if (p.window) this.closeWindow(p, false);
    this.kernel.emit("player:leave", { player: p });
    for (const [t, q] of this.voiceTokens) if (q === p) this.voiceTokens.delete(t);
    this.savePlayer(p);
    this.players.delete(p.name.toLowerCase());
    this.byEntity.delete(p.entity.id);
    this.entities.remove(p.entity);
    this.broadcast(`${p.name} left`, "system");
    this.sendPlayerList();
  }

  private sendPlayerList(): void {
    const list = [...this.players.values()].map((p) => ({ id: p.entity.id, name: p.name, gameMode: p.gameMode }));
    for (const p of this.players.values()) p.send({ t: "players", list });
  }

  respawn(p: Player): void {
    const pos = this.respawnPoint(p);
    p.dead = false;
    p.entity.health = p.maxHealth;
    p.hunger = 20;
    p.exhaustion = 0;
    p.airSupply = 10;
    this.teleport(p, pos[0], pos[1], pos[2]);
    p.selfDirty = true;
    this.kernel.emit("player:respawn", { player: p });
  }

  private inReach(p: Player, x: number, y: number, z: number): boolean {
    const ex = p.entity.x, ey = p.entity.y + EYE_HEIGHT, ez = p.entity.z;
    const dx = x + 0.5 - ex, dy = y + 0.5 - ey, dz = z + 0.5 - ez;
    return dx * dx + dy * dy + dz * dz <= (REACH + 1.5) ** 2;
  }

  private handle(p: Player, msg: ClientMessage): void {
    if (p.dead && msg.t !== "respawn" && msg.t !== "chat") return;
    switch (msg.t) {
      case "move": return this.handleMove(p, msg);
      case "dig":
        if (!isInt(msg.x, msg.y, msg.z) || !this.inReach(p, msg.x, msg.y, msg.z)) return;
        this.kernel.emit("intent:dig", { player: p, action: msg.action, x: msg.x, y: msg.y, z: msg.z });
        return;
      case "place":
        if (!isInt(msg.x, msg.y, msg.z, msg.nx, msg.ny, msg.nz) || Math.abs(msg.nx) + Math.abs(msg.ny) + Math.abs(msg.nz) !== 1) return;
        if (!this.inReach(p, msg.x, msg.y, msg.z)) return;
        this.kernel.emit("intent:place", { player: p, x: msg.x, y: msg.y, z: msg.z, nx: msg.nx, ny: msg.ny, nz: msg.nz, yaw: +msg.yaw || 0, handled: false });
        return;
      case "useBlock":
        if (!isInt(msg.x, msg.y, msg.z) || !this.inReach(p, msg.x, msg.y, msg.z)) return;
        this.kernel.emit("intent:useBlock", { player: p, x: msg.x, y: msg.y, z: msg.z, block: this.world.getBlock(msg.x, msg.y, msg.z), handled: false });
        return;
      case "useItem":
        this.kernel.emit("intent:useItem", { player: p, handled: false });
        return;
      case "attack": {
        const target = this.entities.get(msg.entity);
        if (!target || target === p.entity) return;
        if (target.distanceSq(p.entity.x, p.entity.y + 1, p.entity.z) > (REACH + 1) ** 2) return;
        this.kernel.emit("intent:attack", { player: p, target });
        return;
      }
      case "drop":
        this.kernel.emit("intent:drop", { player: p, all: !!msg.all });
        return;
      case "select":
        if (isInt(msg.slot) && msg.slot >= 0 && msg.slot < 9) { p.selected = msg.slot; p.selfDirty = true; }
        return;
      case "click": {
        if (!isInt(msg.index)) return;
        if (!p.window) p.window = { state: this.inventoryWindow(p) };
        windowClick(this.reg, p.window.state, p.cursor, msg.index, msg.button === 1 ? 1 : 0, !!msg.shift);
        p.selfDirty = true;
        p.windowDirty = true;
        this.kernel.emit("window:click", { player: p });
        return;
      }
      case "closeWindow":
        this.closeWindow(p);
        return;
      case "creativeSet": {
        if (p.gameMode !== "creative" || !isInt(msg.slot, msg.item, msg.count)) return;
        const def = this.reg.itemById(msg.item);
        const all = [...p.hotbar, ...p.main];
        if (msg.slot < 0 || msg.slot >= all.length) return;
        const stack: Slot = def && msg.count > 0 ? { ...this.reg.stack(def.name, Math.min(msg.count, def.maxStack)) } : null;
        if (msg.slot < 9) p.hotbar[msg.slot] = stack;
        else p.main[msg.slot - 9] = stack;
        p.selfDirty = true;
        return;
      }
      case "pickBlock": {
        const item = this.reg.itemForBlock(msg.block);
        if (!item) return;
        const hb = p.hotbar.findIndex((s) => s?.item === item.id);
        if (hb >= 0) { p.selected = hb; p.selfDirty = true; return; }
        const mi = p.main.findIndex((s) => s?.item === item.id);
        if (mi >= 0) {
          [p.main[mi], p.hotbar[p.selected]] = [p.hotbar[p.selected], p.main[mi]];
        } else if (p.gameMode === "creative") {
          p.hotbar[p.selected] = this.reg.stack(item.name, item.maxStack);
        }
        p.selfDirty = true;
        return;
      }
      case "chat": {
        const text = String(msg.text ?? "").slice(0, 256).trim();
        if (!text) return;
        if (text.startsWith("/")) return this.runCommand(p, text.slice(1));
        if (p.chatTokens < 1) return p.send({ t: "chat", kind: "system", text: "You're sending messages too fast." });
        p.chatTokens -= 1;
        this.broadcast(text, "chat", p.name);
        return;
      }
      case "respawn":
        if (p.dead) this.respawn(p);
        return;
    }
  }

  private handleMove(p: Player, msg: Extract<ClientMessage, { t: "move" }>): void {
    const { x, y, z } = msg;
    if (![x, y, z, msg.yaw, msg.pitch].every(Number.isFinite)) return;
    const now = performance.now();
    const dt = Math.max(0.05, Math.min(1, (now - p.lastMoveAt) / 1000));
    p.lastMoveAt = now;
    const b = p.entity.body;
    const fromY = b.y;
    const flying = msg.flying && p.gameMode === "creative";
    const horiz = Math.hypot(x - b.x, z - b.z);
    const sprint = this.std.balance.player.sprintSpeed;
    const maxH = (flying ? sprint * 4 : sprint * 1.6) * dt + 1.5;
    const maxUp = (flying ? 25 : 12) * dt + 1.3;
    const tooFast = horiz > maxH || y - b.y > maxUp;
    const prev = { x: b.x, y: b.y, z: b.z };
    b.x = x; b.y = y; b.z = z;
    const stuck = p.gameMode !== "creative" && bodyCollides(this.world, this.table, { ...b, width: b.width - 0.1, height: b.height - 0.1, y: b.y + 0.05 });
    if ((tooFast || stuck || y < -64) && !p.dead) {
      b.x = prev.x; b.y = prev.y; b.z = prev.z;
      if (y < -64) this.damage(p.entity, 1000, { kind: "void" });
      else p.send({ t: "teleport", x: b.x, y: b.y, z: b.z });
      return;
    }
    p.entity.yaw = msg.yaw;
    p.entity.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, msg.pitch));
    p.sprinting = !!msg.sprinting;
    p.flying = flying;
    p.entity.flags = horiz > 0.01 ? (p.entity.flags | 2) : (p.entity.flags & ~2);
    // Server-side ground/water check (don't trust the client's claim for damage purposes).
    const hw = b.width / 2;
    let onGround = false;
    for (const [ox, oz] of [[-hw, -hw], [hw, -hw], [-hw, hw], [hw, hw], [0, 0]])
      if (this.table.solid[this.world.getBlock(Math.floor(b.x + ox * 0.99), Math.floor(b.y - 0.05), Math.floor(b.z + oz * 0.99))]) onGround = true;
    const inWater = !!this.table.liquid[this.world.getBlock(Math.floor(b.x), Math.floor(b.y + 0.4), Math.floor(b.z))];
    b.onGround = onGround;
    b.inWater = inWater;
    this.kernel.emit("player:moved", { player: p, onGround, inWater, fromY });
  }

  runCommand(p: Player | null, line: string): void {
    const [name, ...args] = line.trim().split(/\s+/);
    const reply = (text: string) => (p ? p.send({ t: "chat", kind: "system", text }) : this.log(text));
    const cmd = this.kernel.commands.get(name?.toLowerCase());
    if (!cmd) return reply(`Unknown command /${name}. Try /help`);
    if (cmd.admin && p && !p.admin) return reply("You don't have permission for that.");
    let out: string | undefined;
    this.kernel.guard(cmd.module, () => { out = cmd.run(p, args) ?? undefined; });
    if (out) reply(out);
  }
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function isInt(...v: unknown[]): boolean {
  return v.every((n) => Number.isInteger(n) && Math.abs(n as number) < 1e8);
}
