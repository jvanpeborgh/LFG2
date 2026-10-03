import type { BlockTable, ItemStack, Registry, ServerMessage, Standards, WorldEventNotice, WindowState } from "@lfg/shared";
import type { DamageSource, Entity, EntityManager } from "./entities";
import type { Command, EventName, GameEvents } from "./kernel";
import type { OpenWindow, Player } from "./player";
import type { BlockEntity, WorldStore } from "./world";

/**
 * What a module can do. This is the only surface module code gets, so it is
 * also where capabilities and budgets will be enforced once modules run in
 * sandboxes (see docs/ARCHITECTURE.md §3).
 */
export interface ModuleApi {
  readonly id: string;
  readonly reg: Registry;
  readonly std: Standards;
  readonly table: BlockTable;
  readonly entities: EntityManager;
  readonly world: {
    getBlock(x: number, y: number, z: number): number;
    /** Change a block (sent to clients, saved, attributed to this module). */
    setBlock(x: number, y: number, z: number, id: number): boolean;
    isLoaded(x: number, y: number, z: number): boolean;
    getBlockEntity(x: number, y: number, z: number): BlockEntity | undefined;
    setBlockEntity(x: number, y: number, z: number, be: BlockEntity): void;
    blockEntities(): IterableIterator<[string, BlockEntity]>;
    surfaceY(x: number, z: number): number;
    readonly store: WorldStore;
  };
  on<E extends EventName>(event: E, fn: (e: GameEvents[E]) => void, priority?: number): void;
  every(seconds: number, fn: (dt: number) => void): void;
  command(cmd: Omit<Command, "module">): void;
  provide(name: string, value: unknown): void;
  use<T>(name: string): T | undefined;
  emit<E extends EventName>(event: E, payload: GameEvents[E]): GameEvents[E];

  players(): Player[];
  playerByName(name: string): Player | undefined;
  spawnEntity(type: string, x: number, y: number, z: number): Entity;
  spawnItem(x: number, y: number, z: number, stack: ItemStack, vel?: [number, number, number]): Entity;
  damage(target: Entity, amount: number, source: DamageSource): boolean;
  heal(target: Entity, amount: number): void;
  playerOf(entity: Entity): Player | undefined;
  openWindow(player: Player, window: OpenWindow): void;
  closeWindow(player: Player): void;
  inventoryWindow(player: Player): WindowState;
  refreshWindow(player: Player): void;
  teleport(player: Player, x: number, y: number, z: number): void;
  knockback(target: Entity, fromX: number, fromZ: number, strength: number): void;
  respawnPoint(player: Player): [number, number, number];

  broadcast(text: string, kind?: "chat" | "system" | "event"): void;
  tell(player: Player, text: string): void;
  sendNear(x: number, y: number, z: number, radius: number, msg: ServerMessage): void;
  worldEvent(notice: WorldEventNotice): void;

  time(): { time: number; dayLength: number };
  setTime(time: number): void;
  rand(): number;
  log(msg: string): void;
  /** Small persistent state for this module (JSON, saved with the world; at most 8 MB per key). */
  storage: {
    load<T>(key: string): T | undefined;
    save(key: string, value: unknown): void;
  };
}
