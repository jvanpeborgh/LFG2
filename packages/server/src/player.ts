import type { WebSocket } from "ws";
import {
  HOTBAR_SIZE, cloneStack, type GameMode, type ItemStack, type Registry, type ServerMessage, type Slot, type WindowState,
} from "@lfg/shared";
import type { Entity } from "./entities";

export interface OpenWindow {
  state: WindowState;
  /** Block position for container windows. */
  pos?: [number, number, number];
  /** Called when the window closes (return items, etc.). */
  onClose?: () => void;
}

export interface SavedPlayer {
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  health: number;
  hunger: number;
  gameMode: GameMode;
  hotbar: Slot[];
  main: Slot[];
  selected: number;
  spawn?: [number, number, number];
}

/** A connected player: network connection + game state. Its body lives on `entity`. */
export class Player {
  hotbar: Slot[] = Array(HOTBAR_SIZE).fill(null);
  main: Slot[] = Array(27).fill(null);
  craftGrid: Slot[] = [null, null, null, null];
  selected = 0;
  hunger = 20;
  /** Exhaustion accumulates with activity; every 4 points costs one hunger. */
  exhaustion = 0;
  gameMode: GameMode = "survival";
  dead = false;
  cursor: { stack: Slot } = { stack: null };
  window: OpenWindow | null = null;
  spawnPoint: [number, number, number] | null = null;
  /** Chunks this client has. */
  readonly loadedChunks = new Set<string>();
  /** Entities this client knows about. */
  readonly knownEntities = new Set<number>();
  dig: { x: number; y: number; z: number; started: number } | null = null;
  lastMoveAt = 0;
  sprinting = false;
  flying = false;
  /** Seconds since last damage (for regen). */
  sinceDamage = 0;
  /** Highest y since leaving the ground (for fall damage). */
  fallStartY: number | null = null;
  airSupply = 10;
  selfDirty = true;
  windowDirty = false;
  /** Seconds left of chat rate-limit tokens. */
  chatTokens = 5;
  admin = false;

  constructor(
    readonly name: string,
    readonly socket: WebSocket,
    readonly entity: Entity,
    private reg: Registry,
  ) {}

  send(msg: ServerMessage): void {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(JSON.stringify(msg));
  }

  sendBinary(buf: ArrayBuffer): void {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(buf);
  }

  get heldStack(): Slot {
    return this.hotbar[this.selected];
  }

  set heldStack(s: Slot) {
    this.hotbar[this.selected] = s && s.count > 0 ? s : null;
    this.selfDirty = true;
  }

  get maxHealth(): number {
    return this.entity.type.maxHealth;
  }

  /** Give items; returns leftovers that didn't fit. */
  give(stack: ItemStack): number {
    const max = this.reg.itemById(stack.item)?.maxStack ?? 64;
    let left = stack.count;
    const all = [this.hotbar, this.main];
    for (const slots of all)
      for (let i = 0; i < slots.length && left > 0; i++) {
        const s = slots[i];
        if (s && s.item === stack.item && s.durability === stack.durability && s.count < max) {
          const n = Math.min(left, max - s.count);
          s.count += n;
          left -= n;
        }
      }
    for (const slots of all)
      for (let i = 0; i < slots.length && left > 0; i++) {
        if (!slots[i]) {
          const n = Math.min(left, max);
          slots[i] = { ...stack, count: n };
          left -= n;
        }
      }
    if (left !== stack.count) this.selfDirty = true;
    return left;
  }

  /** Use up one of the held item (survival only). */
  consumeHeld(n = 1): void {
    if (this.gameMode === "creative") return;
    const s = this.heldStack;
    if (!s) return;
    s.count -= n;
    this.heldStack = s.count > 0 ? s : null;
  }

  /** Wear the held tool by one use; breaks it when worn out. */
  damageHeldTool(): void {
    if (this.gameMode === "creative") return;
    const s = this.heldStack;
    if (!s || s.durability === undefined) return;
    s.durability--;
    this.heldStack = s.durability > 0 ? s : null;
  }

  sendSelf(): void {
    this.send({
      t: "self",
      health: Math.max(0, Math.ceil(this.entity.health)),
      maxHealth: this.maxHealth,
      hunger: Math.ceil(this.hunger),
      gameMode: this.gameMode,
      selected: this.selected,
      hotbar: this.hotbar.map(cloneStack),
      main: this.main.map(cloneStack),
      dead: this.dead,
    });
    this.selfDirty = false;
  }

  toSave(): SavedPlayer {
    return {
      name: this.name,
      x: this.entity.x,
      y: this.entity.y,
      z: this.entity.z,
      yaw: this.entity.yaw,
      pitch: this.entity.pitch,
      health: this.entity.health,
      hunger: this.hunger,
      gameMode: this.gameMode,
      hotbar: this.hotbar,
      main: this.main,
      selected: this.selected,
      spawn: this.spawnPoint ?? undefined,
    };
  }
}
