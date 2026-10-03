import { WORLD_HEIGHT, type BlockQuery } from "../chunk";
import { steer, stepBody, type BlockTable, type Body } from "../physics";
import { raycast } from "../raycast";
import { beginAttack, pickAttack, stepAttack, stepShots, type AttackFx, type AttackKind } from "./attacks";
import type { SummonStats } from "./rules";
import type { SummonSpec } from "./spec";

/**
 * Default behaviour for summons. Pure logic over a body and a small context,
 * so the server runs it live and the shadow playtest runs the very same code
 * against the real world with virtual players before anything arrives.
 *
 * The rules it follows come from docs/standards/game-design-and-fun.md:
 * attacks are telegraphed (hover, flash, sound) before they land; a lunge goes
 * in a straight line you can sidestep; a hunter retreats after a bite and
 * waits out a cooldown; it never hunts in the spawn safe zone or anyone in
 * creative; it gives up when you run far enough.
 */

export interface BrainPlayer {
  id: number;
  x: number;
  y: number;
  z: number;
  /** False for dead or creative players and anyone in the safe zone. */
  huntable: boolean;
}

export interface BrainCtx {
  world: BlockQuery;
  table: BlockTable;
  gravity: number;
  rand: () => number;
  players: BrainPlayer[];
  /** Highest solid block in the column (or -1). */
  groundY(x: number, z: number): number;
  /** Called when a bite lands. */
  bite(playerId: number, damage: number): void;
  /** Called when a telegraph starts (for sound and visuals). */
  warn(): void;
  /** Called when a boss slam lands (for effects); damage goes through bite(). */
  slam?(x: number, y: number, z: number, radius: number): void;
  /** An attack's warning or impact, for effects (breath, shots, charges, stomps). */
  fx?(fx: AttackFx): void;
}

export type SummonMode = "idle" | "stalk" | "windup" | "lunge" | "attack" | "retreat" | "flee";

export interface SummonState {
  mode: SummonMode;
  /** Seconds left in the current mode. */
  left: number;
  home: [number, number, number];
  target: number | null;
  /** Who hit it (neutral summons fight back). */
  provokedBy: number | null;
  cooldown: number;
  /** Wander / orbit angle. */
  angle: number;
  lunge: [number, number, number] | null;
  bitThisLunge: boolean;
  age: number;
  /** Seconds since the telegraph started (for checks). */
  warnedAt: number;
  /** Orbit radius while stalking; shrinks while looking for a clear line to the target. */
  orbit: number;
  yaw: number;
  pitch: number;
  /** 2 = moving, 4 = telegraph (flash), 8 = raining */
  flags: number;
  /**
   * Where it's heading when it isn't fighting (set by a scenario): ships sail
   * there and drop anchor, invaders march there. Null = stay around home.
   */
  goal: [number, number, number] | null;
  /** Ships: reached the goal and dropped anchor. */
  anchored?: boolean;
  /** The special attack being warned of or landing (attacks.ts), where it's aimed, and who it already hit. */
  attack?: AttackKind;
  aim?: [number, number, number];
  hits?: number[];
  /** Projectiles in flight. */
  shots?: { x: number; y: number; z: number; vx: number; vy: number; vz: number; left: number; damage: number }[];
}

export function newSummonState(x: number, y: number, z: number, rand: () => number): SummonState {
  return {
    mode: "idle", left: 0, home: [x, y, z], target: null, provokedBy: null, cooldown: 1, angle: rand() * Math.PI * 2,
    lunge: null, bitThisLunge: false, age: 0, warnedAt: -1, orbit: 5.5, yaw: rand() * Math.PI * 2, pitch: 0, flags: 0, goal: null,
  };
}

const MAX_LUNGE_SECONDS = 0.9;
const GIVE_UP_DISTANCE = 32;

function dist(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  return Math.hypot(ax - bx, ay - by, az - bz);
}

/** 3D steering for flyers and swimmers: accelerate toward a point. */
function flyToward(b: Body, tx: number, ty: number, tz: number, speed: number, dt: number, accel = 3): void {
  const dx = tx - b.x, dy = ty - b.y, dz = tz - b.z;
  const d = Math.hypot(dx, dy, dz) || 1;
  const k = 1 - Math.exp(-accel * dt);
  const s = Math.min(speed, d * 2); // slow down on arrival
  b.vx += ((dx / d) * s - b.vx) * k;
  b.vy += ((dy / d) * s - b.vy) * k;
  b.vz += ((dz / d) * s - b.vz) * k;
}

/** Keep a flight target above the terrain (looking a little ahead along the way). */
function safeAltitude(ctx: BrainCtx, b: Body, x: number, y: number, z: number, min: number, max: number): number {
  const ahead = Math.max(ctx.groundY(Math.floor(x), Math.floor(z)), ctx.groundY(Math.floor(b.x + b.vx), Math.floor(b.z + b.vz)), ctx.groundY(Math.floor(b.x), Math.floor(b.z)));
  return Math.min(WORLD_HEIGHT - 6, Math.max(y, ahead + 1 + min, ahead + 1 + Math.min(min, max)));
}

/** Advance one summon by dt seconds. */
export function stepSummon(spec: SummonSpec, stats: SummonStats, b: Body, s: SummonState, ctx: BrainCtx, dt: number): void {
  s.age += dt;
  s.left -= dt;
  s.cooldown = Math.max(0, s.cooldown - dt);
  s.flags &= ~(2 | 4 | 64 | 896);
  if (spec.abilities.includes("rain")) s.flags |= 8;
  stepShots(s, ctx, dt);

  if (spec.movement === "drift") return drift(stats, b, s, ctx, dt);
  if (spec.movement === "sail") return sail(stats, b, s, ctx, dt);
  if (spec.movement === "walk") return walker(spec, stats, b, s, ctx, dt);
  return flyer(spec, stats, b, s, ctx, dt);
}

// ------------------------------------------------------------------ clouds

function drift(stats: SummonStats, b: Body, s: SummonState, ctx: BrainCtx, dt: number): void {
  // A slow wind that turns gradually; a gentle pull home keeps it within ~48 blocks of where it was made.
  s.angle += (ctx.rand() - 0.5) * 0.02;
  const [hx, , hz] = s.home;
  const away = Math.hypot(b.x - hx, b.z - hz);
  let wx = Math.cos(s.angle), wz = Math.sin(s.angle);
  if (away > 48) { wx = (hx - b.x) / away; wz = (hz - b.z) / away; s.angle = Math.atan2(wz, wx); }
  const ground = Math.max(ctx.groundY(Math.floor(b.x), Math.floor(b.z)), 0);
  const ty = Math.min(WORLD_HEIGHT - 6, Math.max(ground + stats.altitude[0], s.home[1]));
  b.vx += (wx * stats.speed - b.vx) * Math.min(1, dt);
  b.vz += (wz * stats.speed - b.vz) * Math.min(1, dt);
  b.vy = (ty - b.y) * 0.3;
  // Clouds pass over (and through the tops of) mountains rather than bumping into them.
  stepBody(ctx.world, ctx.table, b, dt, { gravity: 0, noClip: true });
  s.flags |= 2;
}

// ------------------------------------------------------------------ ships

/** Top of the water at a column (the y a floating thing sits at), or null if the column isn't water at the top. */
export function waterSurface(ctx: Pick<BrainCtx, "world" | "table">, x: number, z: number): number | null {
  for (let y = WORLD_HEIGHT - 1; y > 0; y--) {
    const id = ctx.world.getBlock(Math.floor(x), y, Math.floor(z));
    if (id === 0) continue;
    return ctx.table.liquid[id] ? y + 1 : null;
  }
  return null;
}

function sail(stats: SummonStats, b: Body, s: SummonState, ctx: BrainCtx, dt: number): void {
  // Ships float with their keel a block under the surface, and only ever move over water:
  // when the water ahead runs out (the shallows) they drop anchor there.
  const surf = waterSurface(ctx, b.x, b.z);
  if (surf !== null) b.y += (surf - 1 - b.y) * Math.min(1, dt * 2);
  b.vy = 0;
  let wish = 0;
  if (s.goal && !s.anchored) {
    const dx = s.goal[0] - b.x, dz = s.goal[2] - b.z, d = Math.hypot(dx, dz);
    if (d < 1.5) s.anchored = true;
    else {
      const ux = dx / d, uz = dz / d;
      // Look ahead a hull length: is it still water there?
      const look = Math.min(d, 5);
      if (waterSurface(ctx, b.x + ux * look, b.z + uz * look) === null) s.anchored = true;
      else {
        wish = Math.min(stats.speed, d * 0.5 + 0.4);
        // Turn gradually like a ship rather than snapping round.
        const want = Math.atan2(-ux, -uz);
        let dy = want - s.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        s.yaw += Math.max(-dt * 0.8, Math.min(dt * 0.8, dy));
      }
    }
  }
  const sp = Math.hypot(b.vx, b.vz);
  const ns = sp + (wish - sp) * Math.min(1, dt * 0.8);
  b.vx = -Math.sin(s.yaw) * ns;
  b.vz = -Math.cos(s.yaw) * ns;
  b.x += b.vx * dt;
  b.z += b.vz * dt;
  if (ns > 0.3) s.flags |= 2;
  s.mode = s.anchored ? "idle" : "stalk";
}

// ------------------------------------------------------------------ flyers and swimmers

function flyer(spec: SummonSpec, stats: SummonStats, b: Body, s: SummonState, ctx: BrainCtx, dt: number): void {
  const swim = spec.movement === "swim";
  const [minAlt, maxAlt] = spec.movement === "hover" ? [1, 3] : stats.altitude[1] > 0 ? stats.altitude : [1, 4];
  const hunts = stats.damage > 0 && (spec.temperament === "hostile" || s.provokedBy !== null);
  const target = s.target !== null ? ctx.players.find((p) => p.id === s.target && p.huntable) : undefined;

  // Out of water, a swimmer flops and falls.
  if (swim && !b.inWater) {
    stepBody(ctx.world, ctx.table, b, dt, { gravity: ctx.gravity });
    if (b.onGround && ctx.rand() < 0.05) { b.vy = 4; b.vx = (ctx.rand() - 0.5) * 3; b.vz = (ctx.rand() - 0.5) * 3; }
    return;
  }

  // Pick a target.
  if (hunts && s.mode !== "retreat" && s.mode !== "lunge" && s.mode !== "windup" && s.mode !== "attack") {
    if (!target) {
      s.target = null;
      let best = 20;
      for (const p of ctx.players) {
        if (!p.huntable) continue;
        if (s.provokedBy !== null && p.id !== s.provokedBy) continue;
        const d = dist(p.x, p.y, p.z, b.x, b.y, b.z);
        if (d < best) { best = d; s.target = p.id; }
      }
      if (s.target !== null) { s.mode = "stalk"; s.left = 2 + ctx.rand() * 2; }
    } else if (dist(target.x, target.y, target.z, b.x, b.y, b.z) > GIVE_UP_DISTANCE) {
      s.target = null; s.mode = "idle"; s.provokedBy = null;
    }
  }
  const t = s.target !== null ? ctx.players.find((p) => p.id === s.target && p.huntable) : undefined;
  if (!t && (s.mode === "stalk" || s.mode === "windup" || s.mode === "lunge" || s.mode === "attack")) { s.mode = "retreat"; s.left = 1.5; s.target = null; s.attack = undefined; }
  // Breath, shots, stomps: it hangs in the air while it warns and attacks.
  if (stepAttack(spec, stats, b, s, ctx, dt)) {
    stepBody(ctx.world, ctx.table, b, dt, { gravity: 0, flying: true });
    s.pitch *= 0.8;
    return;
  }

  let speed = stats.speed, tx = b.x, ty = b.y, tz = b.z, accel = 3;
  switch (s.mode) {
    case "idle": {
      // Lazy circles around home, rising and dipping a little.
      s.angle += dt * (stats.speed / 8);
      const r = 7;
      tx = s.home[0] + Math.cos(s.angle) * r;
      tz = s.home[2] + Math.sin(s.angle) * r;
      ty = s.home[1] + Math.sin(s.age * 0.4) * 1.5;
      speed *= 0.6;
      break;
    }
    case "stalk": {
      // Circle the target at a distance (visible, readable) until ready.
      s.angle += dt * 0.9;
      tx = t!.x + Math.cos(s.angle) * s.orbit;
      tz = t!.z + Math.sin(s.angle) * s.orbit;
      ty = t!.y + 2.5;
      if (s.left <= 0 && s.cooldown <= 0) {
        // Only warn and lunge with a clear line to the target, within reach. Under trees or in a
        // cave you're sheltered: it keeps circling, tightening its circle to look for a gap.
        const d = dist(t!.x, t!.y + 0.9, t!.z, b.x, b.y + b.height / 2, b.z);
        const canLunge = spec.abilities.includes("bite") && d < MAX_LUNGE_SECONDS * stats.speed * 2.2 - 0.5 && clearLine(ctx, b, t!);
        const special = pickAttack(spec, stats, b, s, t!, ctx, canLunge);
        if (special) { beginAttack(special, spec, b, s, t!, ctx); break; }
        if (canLunge) {
          s.mode = "windup";
          s.left = stats.telegraph;
          s.warnedAt = s.age;
          s.orbit = 5.5;
          ctx.warn();
        } else {
          s.left = 0.6;
          s.orbit = s.orbit > 3 ? s.orbit - 0.5 : 6.5;
        }
      }
      break;
    }
    case "windup": {
      // Hover in place, face the target, flash: the telegraph.
      b.vx *= 0.8; b.vz *= 0.8; b.vy *= 0.8;
      tx = b.x; ty = b.y; tz = b.z;
      s.yaw = Math.atan2(-(t!.x - b.x), -(t!.z - b.z));
      s.flags |= 4;
      if (s.left <= 0) {
        // Commit to a straight line at where the target is now: step aside to dodge.
        const d = dist(t!.x, t!.y + 0.9, t!.z, b.x, b.y, b.z) || 1;
        const v = stats.speed * 2.2;
        s.lunge = [((t!.x - b.x) / d) * v, ((t!.y + 0.9 - b.y) / d) * v, ((t!.z - b.z) / d) * v];
        s.mode = "lunge";
        // Long enough to reach where the target was (plus a little), capped: still one straight, dodgeable line.
        s.left = Math.min(MAX_LUNGE_SECONDS, d / v + 0.25);
        s.bitThisLunge = false;
      }
      break;
    }
    case "lunge": {
      [b.vx, b.vy, b.vz] = s.lunge!;
      s.flags |= 4;
      if (!s.bitThisLunge && dist(t!.x, t!.y + 0.9, t!.z, b.x, b.y + b.height / 2, b.z) < 1.6) {
        s.bitThisLunge = true;
        ctx.bite(t!.id, stats.damage);
        s.cooldown = stats.cooldown;
        s.mode = "retreat";
        s.left = 3;
      } else if (s.left <= 0) {
        s.mode = "retreat";
        s.left = 1.5;
        s.cooldown = stats.cooldown * 0.5;
      }
      break;
    }
    case "retreat": {
      // Back off and up after a bite: a window for players to hit back or run.
      const away = t ? Math.atan2(b.z - t.z, b.x - t.x) : s.angle;
      tx = b.x + Math.cos(away) * 6;
      tz = b.z + Math.sin(away) * 6;
      ty = b.y + 1.5;
      if (s.left <= 0) { s.mode = t ? "stalk" : "idle"; s.left = 2 + ctx.rand() * 2; }
      break;
    }
    case "flee": {
      const away = s.angle;
      tx = b.x + Math.cos(away) * 8; tz = b.z + Math.sin(away) * 8; ty = b.y + 1;
      speed *= 1.3;
      if (s.left <= 0) s.mode = "idle";
      break;
    }
  }

  if (s.mode !== "lunge" && s.mode !== "windup") {
    if (swim) {
      // Stay inside the water column.
      ty = Math.min(ty, waterTop(ctx, b) - 0.6);
    } else {
      ty = safeAltitude(ctx, b, tx, ty, tz, s.mode === "stalk" || s.mode === "retreat" ? 1.5 : minAlt, maxAlt);
    }
    flyToward(b, tx, ty, tz, speed, dt, accel);
  }
  stepBody(ctx.world, ctx.table, b, dt, { gravity: 0, flying: true });
  if (b.hitWall && s.mode !== "lunge") b.vy = Math.max(b.vy, speed * 0.6); // climb over obstacles

  const hs = Math.hypot(b.vx, b.vz);
  if (hs > 0.2 && s.mode !== "windup") s.yaw = Math.atan2(-b.vx, -b.vz);
  s.pitch = Math.max(-0.6, Math.min(0.6, Math.atan2(b.vy, Math.max(hs, 0.1)) * 0.6));
  if (hs > 0.3) s.flags |= 2;
}

/** Nothing solid between the summon and the target's chest. */
function clearLine(ctx: BrainCtx, b: Body, t: BrainPlayer): boolean {
  const ox = b.x, oy = b.y + b.height / 2, oz = b.z;
  const dx = t.x - ox, dy = t.y + 0.9 - oy, dz = t.z - oz;
  const d = Math.hypot(dx, dy, dz);
  return raycast(ctx.world, ox, oy, oz, dx, dy, dz, Math.max(0, d - 0.6), (id) => ctx.table.solid[id] === 1) === null;
}

function waterTop(ctx: BrainCtx, b: Body): number {
  let y = Math.floor(b.y);
  while (y < WORLD_HEIGHT - 1 && ctx.table.liquid[ctx.world.getBlock(Math.floor(b.x), y + 1, Math.floor(b.z))]) y++;
  return y + 1;
}

// ------------------------------------------------------------------ walkers

function walker(spec: SummonSpec, stats: SummonStats, b: Body, s: SummonState, ctx: BrainCtx, dt: number): void {
  const hunts = stats.damage > 0 && (spec.temperament === "hostile" || s.provokedBy !== null);
  let wishX = 0, wishZ = 0, speed = stats.speed;
  let t: BrainPlayer | undefined;
  if (hunts) {
    t = ctx.players.find((p) => p.id === s.target && p.huntable);
    if (!t) {
      s.target = null;
      let best = 16;
      for (const p of ctx.players) {
        if (!p.huntable || (s.provokedBy !== null && p.id !== s.provokedBy)) continue;
        const d = dist(p.x, p.y, p.z, b.x, b.y, b.z);
        if (d < best) { best = d; s.target = p.id; t = p; }
      }
    } else if (dist(t.x, t.y, t.z, b.x, b.y, b.z) > GIVE_UP_DISTANCE) { s.target = null; t = undefined; s.provokedBy = null; }
  }
  const slam = stats.slamRadius ?? 0;
  if (!t && (s.mode === "windup" || s.mode === "attack") && s.attack) { s.mode = "retreat"; s.left = 1; s.attack = undefined; }
  const attacking = stepAttack(spec, stats, b, s, ctx, dt);
  if (attacking) {
    // Breath, shots, charges, stomps move it themselves.
  } else if (s.mode === "flee" && s.left > 0) {
    wishX = Math.cos(s.angle); wishZ = Math.sin(s.angle); speed *= 1.6;
  } else if (slam > 0 && s.mode === "windup") {
    // Boss ground slam: stands still with its weapon raised for the (long) telegraph, then hits
    // everyone in the ring. Stepping out of the ring is the counterplay.
    s.flags |= 4;
    if (t) s.yaw = Math.atan2(-(t.x - b.x), -(t.z - b.z));
    if (s.left <= 0) {
      for (const p of ctx.players)
        if (p.huntable && Math.hypot(p.x - b.x, p.z - b.z) < slam && Math.abs(p.y - b.y) < 2.5) ctx.bite(p.id, stats.damage);
      ctx.slam?.(b.x, b.y, b.z, slam);
      s.mode = "retreat"; s.left = 1.2; s.cooldown = stats.cooldown;
    }
  } else if (t && slam > 0) {
    const dx = t.x - b.x, dz = t.z - b.z, dh = Math.hypot(dx, dz) || 1;
    s.yaw = Math.atan2(-dx, -dz);
    if (s.mode === "retreat" && s.left > 0) { /* catching its breath: a window to hit back */ }
    else if (dh < slam * 0.6 && s.cooldown <= 0) { s.mode = "windup"; s.left = stats.telegraph; s.warnedAt = s.age; ctx.warn(); }
    else {
      const special = pickAttack(spec, stats, b, s, t, ctx, false);
      if (special) beginAttack(special, spec, b, s, t, ctx);
      else { s.mode = "stalk"; wishX = dx / dh; wishZ = dz / dh; }
    }
  } else if (t) {
    const dx = t.x - b.x, dz = t.z - b.z, dh = Math.hypot(dx, dz) || 1;
    s.yaw = Math.atan2(-dx, -dz);
    if (s.mode === "windup") {
      s.flags |= 4;
      if (s.left <= 0) {
        if (dh < 1.8 && Math.abs(t.y - b.y) < 1.6) ctx.bite(t.id, stats.damage);
        s.mode = "retreat"; s.left = 1; s.cooldown = stats.cooldown;
      }
    } else if (s.mode === "retreat" && s.left > 0) {
      wishX = -dx / dh; wishZ = -dz / dh;
    } else {
      const bites = spec.abilities.includes("bite");
      const special = pickAttack(spec, stats, b, s, t, ctx, bites && dh < 1.6);
      if (special) beginAttack(special, spec, b, s, t, ctx);
      else if (bites && dh < 1.6 && s.cooldown <= 0) { s.mode = "windup"; s.left = stats.telegraph; s.warnedAt = s.age; ctx.warn(); }
      else {
        s.mode = "stalk";
        // Without a bite it keeps its distance (archers, breathers), circling rather than closing in.
        const melee = bites || (stats.attacks ?? []).some((a) => a.kind === "stomp" || a.kind === "charge" && dh > a.range);
        const keep = melee ? 0 : Math.min(6, Math.max(3, ...(stats.attacks ?? []).filter((a) => a.kind !== "stomp").map((a) => a.range * 0.5)));
        if (dh > keep + 1) { wishX = dx / dh; wishZ = dz / dh; }
        else if (dh < keep - 1) { wishX = -dx / dh * 0.6; wishZ = -dz / dh * 0.6; }
        else { wishX = -dz / dh * 0.5; wishZ = dx / dh * 0.5; }
      }
    }
  } else if (s.goal) {
    // Marching somewhere (a scenario's beach or the players' camp).
    const dx = s.goal[0] - b.x, dz = s.goal[2] - b.z, d = Math.hypot(dx, dz);
    if (d > 2) { wishX = dx / d; wishZ = dz / d; s.mode = "stalk"; } else s.mode = "idle";
  } else {
    if (s.left <= 0) { s.left = 2 + ctx.rand() * 5; s.angle = ctx.rand() * Math.PI * 2; s.mode = ctx.rand() < 0.6 ? "idle" : "stalk"; }
    if (s.mode !== "idle") { wishX = Math.cos(s.angle) * 0.5; wishZ = Math.sin(s.angle) * 0.5; }
    // Stay near home.
    const hx = s.home[0] - b.x, hz = s.home[2] - b.z, hd = Math.hypot(hx, hz);
    if (hd > 16) { wishX = hx / hd; wishZ = hz / hd; }
  }
  // Wading: slower in water, and they keep their heads up (paddling to the surface).
  if (b.inWater) {
    speed *= 0.7;
    const surf = waterSurface(ctx, b.x, b.z);
    if (surf !== null && b.y < surf - 1.2) b.vy = Math.max(b.vy, 3);
  }
  if (!attacking) steer(b, wishX, wishZ, speed, dt, b.onGround || b.inWater ? 10 : 2);
  // Climb steps in the way; big creatures (bosses) can climb proportionally bigger ones.
  const step = Math.max(1.3, Math.min(3, spec.length * 0.6 + 0.3));
  if (b.hitWall && (b.onGround || b.inWater) && s.mode !== "attack") b.vy = Math.sqrt(2 * ctx.gravity * step);
  stepBody(ctx.world, ctx.table, b, dt, { gravity: ctx.gravity });
  if (Math.hypot(b.vx, b.vz) > 0.3) { s.flags |= 2; if (!t && !attacking) s.yaw = Math.atan2(-b.vx, -b.vz); }
}

/** React to being hit: neutral summons fight back, passive ones run. */
export function summonHurt(spec: SummonSpec, s: SummonState, attackerId: number | null, fromX: number, fromZ: number, bx: number, bz: number): void {
  if (spec.temperament === "passive") {
    s.mode = "flee"; s.left = 4; s.angle = Math.atan2(bz - fromZ, bx - fromX);
  } else if (attackerId !== null && s.mode !== "lunge" && s.mode !== "attack") {
    s.provokedBy = attackerId; s.target = attackerId;
    if (s.mode === "idle") { s.mode = "stalk"; s.left = 1; }
  }
}
