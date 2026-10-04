import { CHUNK_VOLUME, decodeRLE, encodeRLE } from "./chunk";
import type { WindowSnapshot, Slot } from "./inventory";

export const PROTOCOL_VERSION = 1;

export type GameMode = "survival" | "creative";

// ------------------------------------------------------------ client → server

export type ClientMessage =
  | { t: "hello"; name: string; protocol: number; fingerprint: number; key?: string; invite?: string; near?: string }
  | { t: "move"; x: number; y: number; z: number; yaw: number; pitch: number; flying: boolean; sprinting: boolean; onGround: boolean; heading?: number }
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
  | { t: "respawn" }
  /** Climb onto a summon (yours, big enough to carry you), or get off. */
  | { t: "mount"; entity: number }
  | { t: "dismount" }
  /** Cast a spell from an active power, in the direction the player is looking. */
  | { t: "cast"; spell: string };

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
      /** Voice commands: a token for the server's transcription endpoint, and whether the server transcribes. */
      voice?: { token: string; server: boolean };
    }
  | { t: "reject"; reason: string }
  | { t: "unloadChunk"; cx: number; cy: number; cz: number }
  | { t: "blocks"; changes: [number, number, number, number][] }
  | { t: "spawn"; entities: EntitySpawn[] }
  | { t: "despawn"; ids: number[] }
  /** A puff of coloured particles (a burning hit, a chill). */
  | { t: "particles"; x: number; y: number; z: number; color: string; count: number }
  /** What a player wears (creature gear): per slot, its kind and colours (everyone sees it). */
  | { t: "wear"; id: number; gear: Partial<Record<"head" | "chest" | "legs" | "feet" | "charm", { kind: string; main: string; accent: string; rarity: string }>> }
  /** A happening (the world's rules changed for a while): what, how long left. Empty title: none. */
  | { t: "happening"; title: string; left: number; detail: string }
  /** A race you're in: the HUD (lap, place, time, the next checkpoint to aim for), and results at the end. */
  | {
      t: "race"; phase: "building" | "countdown" | "racing" | "finished" | "over"; title: string;
      lap: number; laps: number; place: number; of: number; time: number; countdown?: number;
      next?: [number, number, number]; results?: { name: string; time: number | null }[];
    }
  /**
   * Who rides what: the rider sits `seat` blocks above the mount. mount null: they got off. The
   * rider's own client gets the profile and steers the pair.
   */
  | { t: "ride"; rider: number; mount: number | null; seat: number; profile?: import("./summons/mounts").MountProfile; name?: string }
  /** id, x, y, z, yaw, pitch, flags (1 = hurt flash, 2 = moving, 4 = sneaking/fuse; summons: attacks.ts attackFlags) */
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
  | { t: "scenario"; hud: ScenarioHud | null }
  /** Your level, XP, aether and shards. */
  | { t: "progress"; progress: ProgressHud }
  /** A ritual circle nearby you can join (or null when it's over). */
  | { t: "ritual"; ritual: RitualHud | null }
  /** Your active powers (timed buffs), with spell cooldowns. */
  | { t: "buffs"; buffs: BuffHud[] }
  /** Your spellbook: prompts inscribed as scrolls, ready to cast. */
  | { t: "spellbook"; scrolls: ScrollHud[] }
  /** A spell's visual effect, for everyone nearby. */
  | { t: "spellFx"; spell: string; from: [number, number, number]; to: [number, number, number] }
  /** A summon's breath, shot, charge or stomp: its warning, the attack, or the end (a charge into a wall). */
  | { t: "attackFx"; id: number; fx: import("./summons/attacks").AttackFx }
  /** Your invite link for this world (in answer to /invite or the menu's Invite button). */
  | { t: "invite"; url: string; world: string; title: string; access: "public" | "invite" }
  /** Your hit landed: the damage it did, for a floating number (gold for a critical hit). */
  | { t: "hit"; x: number; y: number; z: number; amount: number; crit: boolean }
  /** The weather here. */
  | { t: "weather"; kind: "clear" | "rain" | "thunder" }
  /** A lightning strike: "warn" while the air crackles (the ring to step out of), "hit" when it lands. */
  | { t: "lightning"; phase: "warn" | "hit"; x: number; y: number; z: number; radius: number; seconds: number }
  /** Your friends: who's online and where, and who's asked to be your friend. */
  | { t: "friends"; friends: FriendHud[]; requests: string[] }
  /** Your first steps here, with what's done (null when they're all done or put away). */
  | { t: "steps"; steps: { id: string; label: string; hint: string; done: boolean }[] | null };

export interface FriendHud {
  name: string;
  online: boolean;
  /** The world they're in (when online), and whether it's this one. */
  world?: string;
  title?: string;
  here?: boolean;
  /** Whether you can go to their world (it's public, or you're a member). */
  canJoin?: boolean;
}

export interface BuffHud {
  id: string;
  name: string;
  secondsLeft: number;
  effects: string[];
  spells: { id: string; name: string; key: string; cooldownLeft: number; cooldown: number }[];
}

export interface ProgressHud {
  level: number;
  /** XP into this level, and needed for the next (0 at the top level). */
  xp: number;
  next: number;
  aether: number;
  aetherMax: number;
  shards: number;
  /** Highest tier you can cast, and the level that unlocks the next one (0 if none). */
  tier: number;
  nextTierLevel: number;
}

export interface RitualHud {
  id: number;
  by: string;
  title: string;
  tier: number;
  at: [number, number, number];
  radius: number;
  joined: string[];
  needed: number;
  secondsLeft: number;
  /** For the player receiving it: not the leader and not joined yet. */
  canJoin: boolean;
}

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

export interface ScrollHud {
  name: string;
  prompt: string;
  /** What it makes and how strong it is. */
  title: string;
  kind: string;
  tier: number;
  /** What casting it costs now (at your level it may be scaled down: see `castsAs`). */
  aether: number;
  shards: number;
  /** What you'd actually get at your level, if not the full thing. */
  castsAs?: string;
}
