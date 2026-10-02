import type { BlockQuery } from "./chunk";
import type { Registry } from "./registry";

/** Fast per-block-id lookups built from the registry. */
export class BlockTable {
  solid: Uint8Array;
  opaque: Uint8Array;
  liquid: Uint8Array;
  replaceable: Uint8Array;
  light: Uint8Array;

  constructor(reg: Registry) {
    const n = reg.blocks.length;
    this.solid = new Uint8Array(n);
    this.opaque = new Uint8Array(n);
    this.liquid = new Uint8Array(n);
    this.replaceable = new Uint8Array(n);
    this.light = new Uint8Array(n);
    for (const b of reg.blocks) {
      this.solid[b.id] = b.solid ? 1 : 0;
      this.opaque[b.id] = b.opaque ? 1 : 0;
      this.liquid[b.id] = b.liquid ? 1 : 0;
      this.replaceable[b.id] = b.replaceable ? 1 : 0;
      this.light[b.id] = b.light;
    }
  }

  isSolid(id: number): boolean {
    return this.solid[id] === 1;
  }
}

export interface Body {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  width: number;
  height: number;
  onGround: boolean;
  inWater: boolean;
  /** Blocks fallen since last on the ground (for fall damage). */
  fallDistance: number;
  /** Set when a horizontal move was blocked this step (for mob jumping). */
  hitWall: boolean;
}

export function makeBody(x: number, y: number, z: number, width: number, height: number): Body {
  return { x, y, z, vx: 0, vy: 0, vz: 0, width, height, onGround: false, inWater: false, fallDistance: 0, hitWall: false };
}

export interface StepOptions {
  gravity: number;
  flying?: boolean;
  /** Horizontal drag when on ground (0..1 kept per second fraction). */
  noClip?: boolean;
}

const EPS = 1e-4;

/** True if the box overlaps any solid block. */
export function boxCollides(
  world: BlockQuery,
  table: BlockTable,
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
): boolean {
  const x0 = Math.floor(minX), x1 = Math.floor(maxX - EPS);
  const y0 = Math.floor(minY), y1 = Math.floor(maxY - EPS);
  const z0 = Math.floor(minZ), z1 = Math.floor(maxZ - EPS);
  for (let y = y0; y <= y1; y++)
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++)
        if (table.solid[world.getBlock(x, y, z)]) return true;
  return false;
}

export function bodyCollides(world: BlockQuery, table: BlockTable, b: Body): boolean {
  const hw = b.width / 2;
  return boxCollides(world, table, b.x - hw, b.y, b.z - hw, b.x + hw, b.y + b.height, b.z + hw);
}

function boxInLiquid(world: BlockQuery, table: BlockTable, b: Body): boolean {
  const hw = b.width / 2;
  const x0 = Math.floor(b.x - hw), x1 = Math.floor(b.x + hw - EPS);
  const y0 = Math.floor(b.y + 0.1), y1 = Math.floor(b.y + b.height * 0.6);
  const z0 = Math.floor(b.z - hw), z1 = Math.floor(b.z + hw - EPS);
  for (let y = y0; y <= y1; y++)
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++)
        if (table.liquid[world.getBlock(x, y, z)]) return true;
  return false;
}

/** Move along one axis, stopping at the first solid block. Returns true if blocked. */
function moveAxis(world: BlockQuery, table: BlockTable, b: Body, axis: 0 | 1 | 2, delta: number): boolean {
  if (delta === 0) return false;
  const hw = b.width / 2;
  // Already inside a block (spawned there, or a block was placed on it): move freely until out,
  // instead of "snapping" to a face, which could teleport it through the terrain.
  if (bodyCollides(world, table, b)) {
    if (axis === 0) b.x += delta;
    else if (axis === 1) b.y += delta;
    else b.z += delta;
    return false;
  }
  if (axis === 0) b.x += delta;
  else if (axis === 1) b.y += delta;
  else b.z += delta;
  const minX = b.x - hw, maxX = b.x + hw, minY = b.y, maxY = b.y + b.height, minZ = b.z - hw, maxZ = b.z + hw;
  if (!boxCollides(world, table, minX, minY, minZ, maxX, maxY, maxZ)) return false;
  // Snap back to the face of the block we hit.
  if (axis === 0) b.x = delta > 0 ? Math.floor(maxX - EPS) - hw - EPS : Math.floor(minX) + 1 + hw + EPS;
  else if (axis === 1) b.y = delta > 0 ? Math.floor(maxY - EPS) - b.height - EPS : Math.floor(minY) + 1 + EPS;
  else b.z = delta > 0 ? Math.floor(maxZ - EPS) - hw - EPS : Math.floor(minZ) + 1 + hw + EPS;
  // If snapping still collides (e.g. we started inside a block), undo the move entirely.
  if (bodyCollides(world, table, b)) {
    if (axis === 0) b.x -= delta;
    else if (axis === 1) b.y -= delta;
    else b.z -= delta;
  }
  return true;
}

/**
 * Integrate a body for dt seconds with gravity and voxel collisions.
 * The caller sets horizontal velocity (vx, vz) from input/AI; this handles the rest.
 * Shared by client prediction and the server so both agree.
 */
export function stepBody(world: BlockQuery, table: BlockTable, b: Body, dt: number, opts: StepOptions): void {
  b.inWater = boxInLiquid(world, table, b);
  if (opts.noClip) {
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    b.onGround = false; b.fallDistance = 0;
    return;
  }
  if (!opts.flying) {
    if (b.inWater) {
      b.vy -= opts.gravity * 0.15 * dt;
      b.vy *= Math.pow(0.2, dt);
      b.vy = Math.max(b.vy, -3);
    } else {
      // Half the gravity before moving and half after (velocity Verlet): jump height and fall
      // speed come out the same at 10 fps and at 144 fps, on the client and on the server.
      b.vy -= opts.gravity * dt * 0.5;
    }
  }
  const halfGravityAfter = !opts.flying && !b.inWater;
  // Sub-step so we never move more than ~0.4 blocks per axis at a time.
  const maxDelta = Math.max(Math.abs(b.vx), Math.abs(b.vy), Math.abs(b.vz)) * dt;
  const steps = Math.max(1, Math.ceil(maxDelta / 0.4));
  const sdt = dt / steps;
  const startY = b.y;
  b.onGround = false;
  b.hitWall = false;
  for (let s = 0; s < steps; s++) {
    if (moveAxis(world, table, b, 1, b.vy * sdt)) {
      if (b.vy < 0) b.onGround = true;
      b.vy = 0;
    }
    if (moveAxis(world, table, b, 0, b.vx * sdt)) { b.vx = 0; b.hitWall = true; }
    if (moveAxis(world, table, b, 2, b.vz * sdt)) { b.vz = 0; b.hitWall = true; }
  }
  if (halfGravityAfter && !b.onGround) b.vy = Math.max(b.vy - opts.gravity * dt * 0.5, -60);
  // Ground probe: standing still on a block counts as on-ground.
  if (!b.onGround && b.vy <= 0) {
    const hw = b.width / 2;
    b.onGround = boxCollides(world, table, b.x - hw, b.y - 0.02, b.z - hw, b.x + hw, b.y, b.z + hw);
  }
  if (b.onGround || b.inWater || opts.flying) {
    b.fallDistance = 0;
  } else if (b.y < startY) {
    b.fallDistance += startY - b.y;
  }
}

/** Accelerate horizontal velocity toward a wish direction (used by players and mobs). */
export function steer(b: Body, wishX: number, wishZ: number, speed: number, dt: number, accel: number): void {
  const tx = wishX * speed;
  const tz = wishZ * speed;
  const k = 1 - Math.exp(-accel * dt);
  b.vx += (tx - b.vx) * k;
  b.vz += (tz - b.vz) * k;
}
