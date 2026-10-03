import { CHUNK_VOLUME, decodeRLE, encodeRLE } from "./chunk";
import type { WindowSnapshot, Slot } from "./inventory";

export const PROTOCOL_VERSION = 1;

export type GameMode = "survival" | "creative";

// ------------------------------------------------------------ client → server

export type ClientMessage =
  | { t: "hello"; name: string; protocol: number; fingerprint: number }
  | { t: "move"; x: number; y: number; z: number; yaw: number; pitch: number; flying: boolean; sprinting: boolean; onGround: boolean }
  | { t: "dig"; action: "start" | "cancel" | "finish"; x: number; y: number; z: number }
  | { t: "place"; x: number; y: number; z: number; nx: number; ny: number; nz: number; yaw: number }
  | { t: "useBlock"; x: number; y: number; z: number }
  | { t: "useItem" }
  | { t: "attack"; entity: number }
  | { t: "select"; slot: number }
  | { t: "click"; index: number; button: 0 | 1; shift: boolean }
  | { t: "closeWindow" }
  | { t: "drop"; all: boolean }
  | { t: "creativeSet"; slot: number; item: number; count: number }
  | { t: "pickBlock"; block: number }
  | { t: "chat"; text: string }
  | { t: "respawn" };

// ------------------------------------------------------------ server → client

export interface EntitySpawn {
  id: number;
  type: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Display name for players. */
  name?: string;
  /** Item entities: the item shown. */
  item?: number;
  /** Falling blocks / TNT: the block shown. */
  block?: number;
}

export interface WorldEventNotice {
  /** gathering → arrival → fizzle / undo */
  phase: "gathering" | "arrival" | "fizzle" | "undo";
  title: string;
  by: string;
  detail?: string;
  /** Seconds until arrival (gathering phase). */
  seconds?: number;
}

export type ServerMessage =
  | {
      t: "welcome";
      playerId: number;
      modules: string[];
      fingerprint: number;
      spawn: [number, number, number];
      position: [number, number, number];
      gameMode: GameMode;
      time: number;
      dayLength: number;
      seed: number;
      /** Chunks streamed around the player (radius); the client fits its fog inside this. */
      viewDistance: number;
      standards: unknown;
    }
  | { t: "reject"; reason: string }
  | { t: "unloadChunk"; cx: number; cy: number; cz: number }
  | { t: "blocks"; changes: [number, number, number, number][] }
  | { t: "spawn"; entities: EntitySpawn[] }
  | { t: "despawn"; ids: number[] }
  /** id, x, y, z, yaw, pitch, flags (1 = hurt flash, 2 = moving, 4 = sneaking/fuse) */
  | { t: "moves"; e: number[] }
  | { t: "entityEvent"; id: number; event: "hurt" | "swing" | "die" | "fuse" | "eat" }
  | {
      t: "self";
      health: number;
      maxHealth: number;
      hunger: number;
      gameMode: GameMode;
      selected: number;
      hotbar: Slot[];
      main: Slot[];
      dead: boolean;
    }
  | { t: "window"; window: WindowSnapshot | null; cursor: Slot }
  | { t: "time"; time: number; dayLength: number }
  | { t: "chat"; kind: "chat" | "system" | "event"; from?: string; text: string }
  | { t: "teleport"; x: number; y: number; z: number; vy?: number }
  | { t: "velocity"; vx: number; vy: number; vz: number }
  | { t: "explosion"; x: number; y: number; z: number; radius: number }
  | { t: "blockBreakFx"; x: number; y: number; z: number; block: number }
  | { t: "worldEvent"; event: WorldEventNotice }
  /** New entity types (generated summons) added to the world. */
  | { t: "entityTypes"; types: import("./registry").EntityTypeDef[] }
  /** World rules (standards values) changed; apply in place. */
  | { t: "rules"; changes: [string, number | boolean | string][] }
  | { t: "players"; list: { id: number; name: string; gameMode: GameMode }[] }
  /** A boss ground slam: "warn" while it winds up (the ring to step out of), "hit" when it lands. */
  | { t: "slam"; phase: "warn" | "hit"; x: number; y: number; z: number; radius: number; seconds: number }
  /** The running scenario's HUD (wave counter, boss bar), or null when none is running. */
  | { t: "scenario"; hud: ScenarioHud | null };

export interface ScenarioHud {
  title: string;
  /** e.g. "Ships approaching", "Wave 2 of 5", "Rest", "Victory!" */
  status: string;
  wave: number;
  waves: number;
  enemiesLeft: number;
  /** Where it's happening, so players can find it. */
  at: [number, number, number];
  boss?: { name: string; health: number; maxHealth: number };
  /** Seconds until the next wave (during a rest). */
  countdown?: number;
}

// ------------------------------------------------------------ binary chunk frames

/** Binary frame: [u8 kind=1][i32 cx][i32 cy][i32 cz][u16 RLE pairs...] */
export const FRAME_CHUNK = 1;

export function encodeChunkFrame(cx: number, cy: number, cz: number, blocks: Uint16Array): ArrayBuffer {
  const rle = encodeRLE(blocks);
  const buf = new ArrayBuffer(13 + 1 + rle.byteLength); // +1 pad so u16 data is aligned at 14
  const view = new DataView(buf);
  view.setUint8(0, FRAME_CHUNK);
  view.setInt32(1, cx, true);
  view.setInt32(5, cy, true);
  view.setInt32(9, cz, true);
  new Uint16Array(buf, 14, rle.length).set(rle);
  return buf;
}

export function decodeChunkFrame(buf: ArrayBuffer): { cx: number; cy: number; cz: number; blocks: Uint16Array } {
  const view = new DataView(buf);
  if (view.getUint8(0) !== FRAME_CHUNK) throw new Error("Not a chunk frame");
  const cx = view.getInt32(1, true), cy = view.getInt32(5, true), cz = view.getInt32(9, true);
  const rle = new Uint16Array(buf.slice(14));
  return { cx, cy, cz, blocks: decodeRLE(rle, CHUNK_VOLUME) };
}
