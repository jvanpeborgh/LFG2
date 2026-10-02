import { makeBody, type Body, type EntityTypeDef, type EntitySpawn, type Registry } from "@lfg/shared";

export type DamageKind = "melee" | "fall" | "explosion" | "starve" | "drown" | "cactus" | "void" | "fire" | "command";

export interface DamageSource {
  kind: DamageKind;
  attacker?: Entity;
}

export class Entity {
  readonly body: Body;
  yaw = 0;
  pitch = 0;
  health: number;
  /** Seconds of invulnerability after being hurt (prevents damage spam). */
  invulnerable = 0;
  removed = false;
  /** Free-form state owned by modules (AI state, item stack, fuse...). */
  readonly data: Record<string, unknown> = {};
  /** Which module spawned it (for the inspector and for undo). */
  module = "kernel";
  /** Seconds since spawn. */
  age = 0;
  /** Flags sent to clients: 1 hurt, 2 moving, 4 fuse/sneak. */
  flags = 0;
  lastSent: [number, number, number, number, number, number] = [NaN, NaN, NaN, NaN, NaN, -1];

  constructor(
    readonly id: number,
    readonly type: EntityTypeDef,
    x: number,
    y: number,
    z: number,
  ) {
    this.body = makeBody(x, y, z, type.width, type.height);
    this.health = type.maxHealth;
  }

  get x(): number { return this.body.x; }
  get y(): number { return this.body.y; }
  get z(): number { return this.body.z; }

  distanceSq(x: number, y: number, z: number): number {
    const dx = this.body.x - x, dy = this.body.y - y, dz = this.body.z - z;
    return dx * dx + dy * dy + dz * dz;
  }

  spawnInfo(): EntitySpawn {
    const s: EntitySpawn = { id: this.id, type: this.type.name, x: this.x, y: this.y, z: this.z, yaw: this.yaw };
    if (typeof this.data.name === "string") s.name = this.data.name;
    if (typeof this.data.item === "object" && this.data.item) s.item = (this.data.item as { item: number }).item;
    if (typeof this.data.block === "number") s.block = this.data.block;
    return s;
  }
}

export class EntityManager {
  readonly all = new Map<number, Entity>();
  private nextId = 1;
  /** Entities removed this tick (so clients get a despawn). */
  readonly removedThisTick: number[] = [];

  constructor(private reg: Registry) {}

  spawn(type: string, x: number, y: number, z: number, module = "kernel"): Entity {
    const def = this.reg.entityTypes.get(type);
    if (!def) throw new Error(`Unknown entity type "${type}"`);
    const e = new Entity(this.nextId++, def, x, y, z);
    e.module = module;
    this.all.set(e.id, e);
    return e;
  }

  remove(e: Entity): void {
    if (e.removed) return;
    e.removed = true;
    this.all.delete(e.id);
    this.removedThisTick.push(e.id);
  }

  get(id: number): Entity | undefined {
    return this.all.get(id);
  }

  *near(x: number, y: number, z: number, radius: number, filter?: (e: Entity) => boolean): Generator<Entity> {
    const r2 = radius * radius;
    for (const e of this.all.values()) {
      if (e.removed) continue;
      if (e.distanceSq(x, y, z) > r2) continue;
      if (filter && !filter(e)) continue;
      yield e;
    }
  }

  count(filter: (e: Entity) => boolean): number {
    let n = 0;
    for (const e of this.all.values()) if (filter(e)) n++;
    return n;
  }
}
