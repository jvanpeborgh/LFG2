import {
  BlockTable, CHUNK_BITS, REACH, setRule, WORLD_HEIGHT, buildRegistry, decodeChunkFrame, digTime,
  rayBox, raycast, type ClientMessage, type Registry, type ServerMessage, type Standards,
} from "@lfg/shared";
import { Atlas } from "./atlas";
import { Audio } from "./audio";
import { EntityRenderer } from "./entities";
import { LocalPlayer, type InputState } from "./player";
import { Renderer } from "./renderer";
import { UI, type Settings } from "./ui";
import { ClientWorld } from "./world";

type Welcome = Extract<ServerMessage, { t: "welcome" }>;

interface Target {
  kind: "block" | "entity";
  x: number; y: number; z: number;
  nx: number; ny: number; nz: number;
  block: number;
  entity: number;
  distance: number;
}

/** One connected game session in the browser. */
export class GameClient {
  readonly reg: Registry;
  readonly table: BlockTable;
  readonly std: Standards;
  private atlas: Atlas;
  private renderer: Renderer;
  private world: ClientWorld;
  private entities: EntityRenderer;
  private ui: UI;
  private audio = new Audio();
  private player: LocalPlayer;
  private keys = new Set<string>();
  private mouse = { left: false, right: false };
  private locked = false;
  private thirdPerson = false;
  private target: Target | null = null;
  private dig: { x: number; y: number; z: number; progress: number; sound: number } | null = null;
  private digCooldown = 0;
  private useCooldown = 0;
  private attackCooldown = 0;
  private time = 0;
  private dayLength = 1200;
  private moveTimer = 0;
  private lastFrame = performance.now();
  private fps = 0;
  private air = 10;
  private self: { id: number; gameMode: string; dead: boolean; selected: number } = { id: -1, gameMode: "survival", dead: false, selected: 0 };
  private recentBreaks = new Map<string, number>();
  private stopped = false;
  private ownModel: EntityRenderer | null = null;
  /** Furthest distance the server streams terrain, in blocks. */
  private maxFog: number;

  constructor(private ws: WebSocket, welcome: Welcome, private canvas: HTMLCanvasElement, private onDisconnect: (reason: string) => void) {
    this.std = welcome.standards as Standards;
    this.reg = buildRegistry(welcome.modules, this.std);
    if (this.reg.fingerprint() !== welcome.fingerprint) throw new Error("Game content mismatch. Reload the page.");
    this.table = new BlockTable(this.reg);
    this.atlas = new Atlas(this.reg);
    this.renderer = new Renderer(canvas, this.atlas.canvas, this.std);
    this.world = new ClientWorld(this.reg, (n) => this.atlas.tile(n), this.renderer.solidMat, this.renderer.waterMat);
    this.renderer.scene.add(this.world.group);
    this.entities = new EntityRenderer(this.reg, this.atlas, this.renderer.atlasTexture);
    this.entities.selfId = welcome.playerId;
    this.renderer.scene.add(this.entities.group);
    this.self.id = welcome.playerId;
    this.self.gameMode = welcome.gameMode;
    this.time = welcome.time;
    this.dayLength = welcome.dayLength;
    this.maxFog = Math.max(48, welcome.viewDistance * 32 - 8);
    const [x, y, z] = welcome.position;
    this.player = new LocalPlayer(x, y, z, this.std);
    this.player.creative = welcome.gameMode === "creative";

    this.ui = new UI(this.reg, this.atlas, {
      click: (index, button, shift) => { this.send({ t: "click", index, button, shift }); this.audio.click(); },
      creativePick: (item, count) => this.creativePick(item, count),
      closeWindow: () => this.closeWindow(),
      chat: (text) => this.send({ t: "chat", text }),
      respawn: () => { this.send({ t: "respawn" }); this.lock(); },
      resume: () => this.lock(),
      settings: (s) => this.applySettings(s),
    });
    this.applySettings(this.ui.settings);
    this.ui.addChat("Welcome! Press H to show or hide the controls. Type /help for commands.", "system");

    ws.binaryType = "arraybuffer";
    ws.onmessage = (ev) => this.onMessage(ev.data);
    ws.onclose = () => { if (!this.stopped) this.stop("Disconnected from the server."); };
    this.bindInput();
    requestAnimationFrame(() => this.frame());
  }

  private send(m: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  private stop(reason: string): void {
    this.stopped = true;
    document.exitPointerLock();
    this.world.dispose();
    this.ui.root.remove();
    this.onDisconnect(reason);
  }

  private applySettings(s: Settings): void {
    this.renderer.camera.fov = s.fov;
    this.renderer.camera.updateProjectionMatrix();
    this.renderer.setViewDistance(Math.min(s.renderDistance, this.maxFog));
    this.renderer.reducedMotion = s.reducedMotion;
    this.audio.setVolume(s.volume);
  }

  // ------------------------------------------------------------------ network

  private onMessage(data: ArrayBuffer | string): void {
    if (data instanceof ArrayBuffer) {
      const c = decodeChunkFrame(data);
      this.world.addChunk(c.cx, c.cy, c.cz, c.blocks);
      return;
    }
    const m = JSON.parse(data) as ServerMessage;
    switch (m.t) {
      case "unloadChunk": this.world.removeChunk(m.cx, m.cy, m.cz); break;
      case "blocks": this.world.applyChanges(m.changes); break;
      case "spawn": this.entities.spawn(m.entities.filter((e) => e.id !== this.self.id)); break;
      case "despawn": this.entities.despawn(m.ids); break;
      case "moves": this.entities.moves(m.e); break;
      case "entityEvent": this.onEntityEvent(m.id, m.event); break;
      case "self": {
        const wasDead = this.self.dead;
        this.self.gameMode = m.gameMode;
        this.self.dead = m.dead;
        this.self.selected = m.selected;
        this.player.creative = m.gameMode === "creative";
        this.ui.setSelf(m);
        if (m.dead && !wasDead) document.exitPointerLock();
        break;
      }
      case "window": this.ui.setWindow(m.window, m.cursor); if (!m.window && !this.ui.chatOpen) this.lock(); break;
      case "time": this.time = m.time; this.dayLength = m.dayLength; break;
      case "chat": this.ui.addChat(m.text, m.kind, m.from); break;
      case "teleport":
        Object.assign(this.player.body, { x: m.x, y: m.y, z: m.z, vx: 0, vy: m.vy ?? 0, vz: 0, fallDistance: 0 });
        break;
      case "velocity":
        this.player.body.vx += m.vx; this.player.body.vy = Math.max(this.player.body.vy, m.vy); this.player.body.vz += m.vz;
        break;
      case "explosion": {
        const d = Math.hypot(m.x - this.player.body.x, m.y - this.player.body.y, m.z - this.player.body.z);
        this.renderer.explosion(m.x, m.y, m.z, m.radius, d);
        this.audio.explosion(d);
        break;
      }
      case "blockBreakFx": {
        const key = `${m.x},${m.y},${m.z}`;
        if (performance.now() - (this.recentBreaks.get(key) ?? 0) < 1000) break;
        const def = this.reg.blockById(m.block);
        this.renderer.burst(m.x, m.y, m.z, def.color);
        this.audio.breakBlock(def.name, [m.x, m.y, m.z]);
        break;
      }
      case "worldEvent": this.ui.worldEvent(m.event); this.audio.stinger(m.event.phase); break;
      case "rules": this.applyRules(m.changes); break;
      case "players": this.ui.setPlayers(m.list); break;
      case "reject": this.stop(m.reason); break;
      case "welcome": break;
    }
  }

  /**
   * World rules changed (a world event arrived). Values are updated in place,
   * so physics, sky and HUD pick them up on the next frame; palette changes
   * repaint the textures.
   */
  private applyRules(changes: [string, number | boolean | string][]): void {
    let repaint = false;
    for (const [path, value] of changes) {
      setRule(this.std, path, value);
      if (path.startsWith("art.palette.") || path.startsWith("art.reserved.")) repaint = true;
    }
    if (repaint) {
      this.atlas.paint();
      this.renderer.atlasTexture.needsUpdate = true;
      if (this.ui.self) this.ui.setSelf(this.ui.self);
    }
  }

  private onEntityEvent(id: number, event: string): void {
    if (id === this.self.id) {
      if (event === "hurt") this.audio.hurt(true);
      if (event === "eat") this.audio.eat();
      return;
    }
    this.entities.event(id, event);
    const e = this.entities.get(id);
    const pos: [number, number, number] | undefined = e ? [e.x, e.y, e.z] : undefined;
    if (event === "hurt") this.audio.hurt(false, pos);
    if (event === "fuse") this.audio.fuse(pos);
  }

  // ------------------------------------------------------------------ input

  private lock(): void {
    if (this.self.dead || this.ui.windowOpen || this.ui.chatOpen) return;
    // Browsers refuse pointer lock without a recent click; the next click on the canvas will lock instead.
    Promise.resolve(this.canvas.requestPointerLock()).catch(() => {});
  }

  private bindInput(): void {
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.keys.clear(); this.mouse.left = this.mouse.right = false; this.cancelDig(); }
      this.ui.showPause(!this.locked);
    });
    this.canvas.addEventListener("mousedown", (e) => {
      this.audio.unlock();
      if (!this.locked) { this.lock(); return; }
      if (e.button === 0) { this.mouse.left = true; this.digCooldown = 0; this.attackCooldown = 0; }
      if (e.button === 2) { this.mouse.right = true; this.useCooldown = 0; }
      if (e.button === 1) { e.preventDefault(); this.pickBlock(); }
    });
    document.addEventListener("mouseup", (e) => {
      if (e.button === 0) { this.mouse.left = false; this.cancelDig(); }
      if (e.button === 2) this.mouse.right = false;
    });
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("mousemove", (e) => {
      if (this.locked) this.player.look(e.movementX, e.movementY, this.ui.settings.sensitivity);
    });
    document.addEventListener("wheel", (e) => {
      if (!this.locked) return;
      this.select((this.self.selected + (e.deltaY > 0 ? 1 : 8)) % 9);
    }, { passive: true });
    document.addEventListener("keydown", (e) => {
      if (this.ui.chatOpen) return;
      if (e.code === "KeyE" || (e.code === "Escape" && this.ui.windowOpen)) {
        e.preventDefault();
        if (this.ui.windowOpen) this.closeWindow();
        else if (this.locked) this.openInventory();
        return;
      }
      if (e.code === "F3") { e.preventDefault(); this.ui.toggleDebug(); return; }
      if (!this.locked) return;
      if (e.code === "KeyT" || e.code === "Enter" || e.code === "Slash") {
        e.preventDefault();
        this.ui.openChat(e.code === "Slash" ? "/" : "");
        document.exitPointerLock();
        return;
      }
      if (e.code.startsWith("Digit")) {
        const n = Number(e.code.slice(5));
        if (n >= 1 && n <= 9) this.select(n - 1);
      }
      if (e.code === "KeyQ") this.send({ t: "drop", all: e.shiftKey });
      if (e.code === "KeyV") this.thirdPerson = !this.thirdPerson;
      if (e.code === "KeyH") this.ui.toggleHelp();
      if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
      this.keys.add(e.code);
    });
    document.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
  }

  private select(slot: number): void {
    this.self.selected = slot;
    this.send({ t: "select", slot });
    if (this.ui.self) this.ui.setSelf({ ...this.ui.self, selected: slot });
  }

  private openInventory(): void {
    const s = this.ui.self;
    if (!s) return;
    document.exitPointerLock();
    this.ui.setWindow({
      kind: "inventory",
      sections: [
        { id: "result", role: "result", slots: [null] },
        { id: "craft", role: "craftGrid", width: 2, slots: [null, null, null, null] },
        { id: "main", role: "storage", slots: s.main },
        { id: "hotbar", role: "storage", slots: s.hotbar },
      ],
    }, null);
  }

  private closeWindow(): void {
    this.send({ t: "closeWindow" });
    this.ui.setWindow(null, null);
    this.lock();
  }

  private creativePick(item: number, count: number): void {
    const s = this.ui.self;
    if (!s) return;
    let slot = s.hotbar.findIndex((x) => !x);
    if (slot < 0) slot = s.selected;
    this.send({ t: "creativeSet", slot, item, count });
  }

  private pickBlock(): void {
    if (this.target?.kind === "block") this.send({ t: "pickBlock", block: this.target.block });
  }

  private input(): InputState {
    const k = this.keys;
    return {
      forward: (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0),
      strafe: (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0),
      jump: k.has("Space"),
      sprint: k.has("ShiftLeft") || k.has("ShiftRight"),
      down: k.has("KeyC"),
    };
  }

  // ------------------------------------------------------------------ interaction

  private findTarget(): Target | null {
    const p = this.player;
    const [dx, dy, dz] = p.forwardVector();
    const ox = p.body.x, oy = p.eyeY, oz = p.body.z;
    const hit = raycast(this.world, ox, oy, oz, dx, dy, dz, REACH, (id) => id !== 0 && !this.table.liquid[id]);
    let best: Target | null = hit ? { kind: "block", x: hit.x, y: hit.y, z: hit.z, nx: hit.nx, ny: hit.ny, nz: hit.nz, block: hit.block, entity: -1, distance: hit.distance } : null;
    for (const b of this.entities.boxes()) {
      if (b.kind === "item") continue;
      // Ignore anyone whose body we're standing inside (e.g. two players on the spawn point).
      if (ox > b.minX && ox < b.maxX && oy > b.minY && oy < b.maxY && oz > b.minZ && oz < b.maxZ) continue;
      const d = rayBox(ox, oy, oz, dx, dy, dz, b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ);
      if (d !== null && d <= REACH && (!best || d < best.distance)) best = { kind: "entity", x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, block: 0, entity: b.id, distance: d };
    }
    return best;
  }

  private cancelDig(): void {
    if (this.dig) this.send({ t: "dig", action: "cancel", x: this.dig.x, y: this.dig.y, z: this.dig.z });
    this.dig = null;
  }

  private heldItem() {
    const s = this.ui.self?.hotbar[this.self.selected];
    return s ? this.reg.itemById(s.item) : undefined;
  }

  private interact(dt: number): void {
    this.digCooldown -= dt;
    this.useCooldown -= dt;
    this.attackCooldown -= dt;
    const t = this.target;
    const creative = this.self.gameMode === "creative";

    if (this.mouse.left) {
      if (t?.kind === "entity") {
        this.cancelDig();
        if (this.attackCooldown <= 0) {
          this.send({ t: "attack", entity: t.entity });
          this.audio.swing();
          this.attackCooldown = 0.4;
        }
      } else if (t?.kind === "block") {
        const def = this.reg.blockById(t.block);
        if (!this.dig || this.dig.x !== t.x || this.dig.y !== t.y || this.dig.z !== t.z) {
          this.cancelDig();
          if (this.digCooldown <= 0 && def.hardness >= 0) {
            this.dig = { x: t.x, y: t.y, z: t.z, progress: 0, sound: 0 };
            this.send({ t: "dig", action: "start", x: t.x, y: t.y, z: t.z });
          }
        }
        if (this.dig) {
          const need = creative ? 0 : digTime(def, this.heldItem(), { inWater: this.player.body.inWater, onGround: this.player.body.onGround || this.player.flying });
          this.dig.progress = need <= 0 ? 1 : this.dig.progress + dt / need;
          this.dig.sound -= dt;
          if (this.dig.sound <= 0) { this.audio.dig(def.name); this.dig.sound = 0.25; }
          if (this.dig.progress >= 1) {
            const { x, y, z } = this.dig;
            this.send({ t: "dig", action: "finish", x, y, z });
            this.recentBreaks.set(`${x},${y},${z}`, performance.now());
            this.world.applyChanges([[x, y, z, 0]]);
            this.renderer.burst(x, y, z, def.color);
            this.audio.breakBlock(def.name);
            this.dig = null;
            this.digCooldown = creative ? 0.2 : 0.15;
          }
        }
      } else this.cancelDig();
    }

    if (this.mouse.right && this.useCooldown <= 0) {
      this.useCooldown = 0.25;
      const held = this.heldItem();
      const targetDef = t?.kind === "block" ? this.reg.blockById(t.block) : undefined;
      if (held?.food && !targetDef?.container) {
        this.send({ t: "useItem" });
      } else if (t?.kind === "block") {
        this.send({ t: "place", x: t.x, y: t.y, z: t.z, nx: t.nx, ny: t.ny, nz: t.nz, yaw: this.player.yaw });
        this.predictPlace(t, targetDef!);
      } else {
        this.send({ t: "useItem" });
      }
    }
  }

  /** Show the placed block right away; the server confirms or corrects it. */
  private predictPlace(t: Target, targetDef: ReturnType<Registry["blockById"]>): void {
    const held = this.heldItem();
    if (!held || held.block === undefined || targetDef.container) return;
    if (targetDef.tags.includes("explosive") && held.tags.includes("igniter")) return;
    const replaceTarget = this.table.replaceable[t.block] && t.block !== 0;
    const [x, y, z] = replaceTarget ? [t.x, t.y, t.z] : [t.x + t.nx, t.y + t.ny, t.z + t.nz];
    if (!this.table.replaceable[this.world.getBlock(x, y, z)]) return;
    const def = this.reg.blockById(held.block);
    const b = this.player.body, hw = b.width / 2;
    if (def.solid && b.x + hw > x && b.x - hw < x + 1 && b.y + b.height > y && b.y < y + 1 && b.z + hw > z && b.z - hw < z + 1) return;
    if (def.needsSupport && !this.table.solid[this.world.getBlock(x, y - 1, z)]) return;
    this.world.applyChanges([[x, y, z, held.block]]);
    this.audio.place([x, y, z]);
  }

  // ------------------------------------------------------------------ frame

  private frame(): void {
    if (this.stopped) return;
    requestAnimationFrame(() => this.frame());
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.fps = this.fps * 0.95 + (1 / Math.max(dt, 1e-4)) * 0.05;
    const p = this.player;
    const b = p.body;

    // Only simulate once the ground under us has arrived.
    const ready = this.world.isLoaded(Math.floor(b.x), Math.floor(Math.max(0, Math.min(WORLD_HEIGHT - 1, b.y))), Math.floor(b.z));
    if (ready && !this.self.dead) {
      const input = this.locked ? this.input() : { forward: 0, strafe: 0, jump: false, sprint: false, down: false };
      p.update(dt, input, this.world, this.table);
    }

    this.time = (this.time + dt) % this.dayLength;
    const headBlock = this.world.getBlock(Math.floor(b.x), Math.floor(p.eyeY), Math.floor(b.z));
    const underwater = !!this.table.liquid[headBlock];
    this.air = underwater && this.self.gameMode !== "creative" ? Math.max(0, this.air - dt) : 10;
    this.ui.setAir(this.air);
    this.ui.setUnderwater(underwater);
    this.renderer.setTime(this.time / this.dayLength, underwater);
    if (!underwater) this.renderer.setViewDistance(Math.min(this.ui.settings.renderDistance, this.maxFog));

    // Camera.
    const cam = this.renderer.camera;
    const bob = this.ui.settings.reducedMotion || this.thirdPerson ? 0 : Math.sin(p.bob) * 0.04;
    const [sx, sy, sz] = this.renderer.shakeOffset();
    cam.rotation.set(p.pitch, p.yaw, 0);
    cam.position.set(b.x + sx, p.eyeY + bob + sy, b.z + sz);
    if (this.thirdPerson) {
      const [fx, fy, fz] = p.forwardVector();
      let dist = 4;
      const hit = raycast(this.world, b.x, p.eyeY, b.z, -fx, -fy, -fz, 4, (id) => this.table.opaque[id] === 1);
      if (hit) dist = Math.max(0.5, hit.distance - 0.3);
      cam.position.set(b.x - fx * dist, p.eyeY - fy * dist, b.z - fz * dist);
    }
    this.updateOwnModel(dt);
    const sprintFov = p.sprinting && !this.ui.settings.reducedMotion ? 6 : 0;
    const wantFov = this.ui.settings.fov + sprintFov;
    if (Math.abs(cam.fov - wantFov) > 0.1) { cam.fov += (wantFov - cam.fov) * Math.min(1, dt * 8); cam.updateProjectionMatrix(); }

    this.audio.listener = { x: b.x, y: p.eyeY, z: b.z };
    this.target = this.locked && !this.self.dead ? this.findTarget() : null;
    this.ui.setCrosshairTarget(this.target?.kind ?? "none");
    if (this.locked && !this.self.dead) this.interact(dt);
    const hl = this.target?.kind === "block" ? ([this.target.x, this.target.y, this.target.z] as [number, number, number]) : null;
    this.renderer.setHighlight(hl, this.dig?.progress ?? 0);

    this.moveTimer -= dt;
    if (this.moveTimer <= 0 && ready) {
      this.moveTimer = 0.05;
      this.send({ t: "move", x: b.x, y: b.y, z: b.z, yaw: p.yaw, pitch: p.pitch, flying: p.flying, sprinting: p.sprinting, onGround: b.onGround });
    }

    this.world.update(b.x, b.y, b.z);
    this.entities.update(dt, cam);
    this.renderer.update(dt);
    this.renderer.followCamera(dt);
    this.ui.flash(this.renderer.flashAmount);
    this.renderer.render();

    if (performance.now() % 500 < 20) this.ui.setDebug(this.debugText());
  }

  private updateOwnModel(dt: number): void {
    if (this.thirdPerson && !this.ownModel) {
      this.ownModel = new EntityRenderer(this.reg, this.atlas, this.renderer.atlasTexture);
      this.renderer.scene.add(this.ownModel.group);
      this.ownModel.spawn([{ id: 0, type: "player", x: 0, y: 0, z: 0, yaw: 0 }]);
    }
    if (!this.ownModel) return;
    this.ownModel.group.visible = this.thirdPerson;
    const b = this.player.body;
    const moving = Math.hypot(b.vx, b.vz) > 0.3 ? 2 : 0;
    this.ownModel.moves([0, b.x, b.y, b.z, this.player.yaw, this.player.pitch, moving]);
    this.ownModel.update(dt, this.renderer.camera);
  }

  private debugText(): string {
    const b = this.player.body;
    const facing = ["north (-Z)", "west (-X)", "south (+Z)", "east (+X)"][((Math.round(this.player.yaw / (Math.PI / 2)) % 4) + 4) % 4];
    const t = this.target;
    return [
      `LFG2 · ${this.fps.toFixed(0)} fps`,
      `XYZ ${b.x.toFixed(2)} / ${b.y.toFixed(2)} / ${b.z.toFixed(2)}`,
      `Chunk ${Math.floor(b.x) >> CHUNK_BITS} ${Math.floor(b.y) >> CHUNK_BITS} ${Math.floor(b.z) >> CHUNK_BITS} · facing ${facing}`,
      `Time ${(this.time / this.dayLength * 24 + 6) % 24 | 0}:00 · ${this.self.gameMode}${this.player.flying ? " · flying" : ""}`,
      `Chunks ${this.world.chunks.size} · meshes ${this.world.meshCount} · pending ${this.world.pendingMeshes} · ${this.world.meshStats.avgMs.toFixed(1)} ms/mesh`,
      `Entities ${this.entities.count}`,
      t ? (t.kind === "block" ? `Looking at ${this.reg.blockById(t.block).displayName} (${t.x}, ${t.y}, ${t.z}) — from ${this.reg.origin.get(`block:${this.reg.blockById(t.block).name}`)}` : `Looking at ${this.entities.get(t.entity)?.type.displayName ?? "?"}`) : "",
      `Draw calls ${this.renderer.renderer.info.render.calls} · triangles ${(this.renderer.renderer.info.render.triangles / 1000).toFixed(0)}k`,
    ].join("\n");
  }
}

