import { raycast } from "../raycast";
import type { Body } from "../physics";
import type { BrainCtx, BrainPlayer, SummonState } from "./brain";
import type { SummonStats } from "./rules";
import type { SummonSpec } from "./spec";

/**
 * Attacks a summon can have beyond the bite: a design picks them by name (`abilities`), the
 * world's rules set how hard they hit, and this runs them. Every one follows the fair-fight rules
 * (docs/standards/game-design-and-fun.md): it's announced before it lands (the creature stops,
 * flashes and takes its pose), what it hits is decided when the warning ends, and there's a way
 * out of each:
 *
 *   breath   a cone in front of it for a second (fire, frost, poison…): step out of the cone or behind cover
 *   shot     a projectile at where you were: it flies straight, so sidestep it
 *   charge   a straight rush along the ground: step aside; if it hits a wall it's dazed for a moment
 *   stomp    rears up and shakes the ground in a ring around it: step out of the ring
 */
export type AttackKind = "bite" | "breath" | "shot" | "charge" | "stomp";
export const ATTACKS: AttackKind[] = ["bite", "breath", "shot", "charge", "stomp"];
export const SPECIAL_ATTACKS: AttackKind[] = ["breath", "shot", "charge", "stomp"];

export type Element = "fire" | "frost" | "poison" | "lightning" | "water" | "web" | "stone" | "magic";
export const ELEMENTS: Element[] = ["fire", "frost", "poison", "lightning", "water", "web", "stone", "magic"];

export interface AttackStats {
  kind: AttackKind;
  damage: number;
  /** Seconds of warning before it lands. */
  telegraph: number;
  /** Blocks: how far a breath reaches, a shot flies or a charge runs; a stomp's ring radius. */
  range: number;
  cooldown: number;
  /** Projectile or charge speed (blocks per second). */
  speed?: number;
}

/** An attack's visual, for the clients nearby (and nothing else: damage is decided here). */
export interface AttackFx {
  kind: AttackKind;
  element: Element;
  phase: "warn" | "hit" | "end";
  from: [number, number, number];
  to: [number, number, number];
  seconds: number;
  radius?: number;
}

/** Flags on the wire: 64 = an attack is landing; bits 7–9 = which (index in ATTACKS + 1), during the warning too. */
export const ATTACK_ACTIVE = 64;
export function attackFlags(kind: AttackKind | undefined, active: boolean): number {
  if (!kind) return 0;
  return ((ATTACKS.indexOf(kind) + 1) << 7) | (active ? ATTACK_ACTIVE : 0);
}
export function attackFromFlags(flags: number): { kind: AttackKind; active: boolean } | null {
  const i = (flags >> 7) & 7;
  return i ? { kind: ATTACKS[i - 1], active: (flags & ATTACK_ACTIVE) !== 0 } : null;
}

/** What a summon's element is: the design's, else read from its words and colours. */
export function elementOf(spec: SummonSpec): Element {
  if (spec.element) return spec.element;
  const words = `${spec.name} ${spec.prompt}`.toLowerCase();
  for (const [e, re] of ELEMENT_WORDS) if (re.test(words)) return e;
  return "fire";
}
export const ELEMENT_WORDS: [Element, RegExp][] = [
  ["frost", /\b(ice|icy|frost|frosty|frozen|snow|snowy|glacier|winter|cold)\b/],
  ["poison", /\b(poison|poisonous|toxic|venom|venomous|acid|acidic|plague|swamp)\b/],
  ["lightning", /\b(lightning|thunder|electric|storm|spark|sparks|shock)\b/],
  ["water", /\b(water|sea|ocean|tide|wave|bubble|bubbles)\b/],
  ["web", /\b(web|webs|spider|spiders|silk)\b/],
  ["stone", /\b(stone|rock|rocks|boulder|boulders|earth|golem|giant|troll)\b/],
  ["magic", /\b(magic|magical|arcane|spirit|ghost|wizard|witch|mage|crystal|star|stars)\b/],
  ["fire", /\b(fire|fiery|flame|flames|flaming|lava|magma|ember|embers|inferno|burning|dragon)\b/],
];

/** The rule numbers for each attack a summon has (empty for passive ones). */
export function attackStats(spec: SummonSpec, base: { light: number; heavy: number; maxHit: number; lead: number; cooldown: number; boss: boolean; bossTelegraph: number }): AttackStats[] {
  if (spec.temperament === "passive") return [];
  const big = spec.length >= 3;
  const hit = (heavy: boolean) => Math.min(base.maxHit, heavy ? base.heavy : base.light);
  const warn = (s: number) => (base.boss ? Math.max(base.bossTelegraph, s) : Math.max(base.lead, s));
  const out: AttackStats[] = [];
  for (const a of spec.abilities) {
    if (a === "breath") out.push({ kind: a, damage: hit(big), telegraph: warn(1), range: Math.min(9, 3.5 + spec.length * 0.6), cooldown: base.cooldown * 1.6 });
    else if (a === "shot") out.push({ kind: a, damage: hit(false), telegraph: warn(0.8), range: 16, cooldown: base.cooldown * 1.2, speed: 14 });
    else if (a === "charge" && spec.movement === "walk") out.push({ kind: a, damage: hit(big), telegraph: warn(0.9), range: Math.min(12, 5 + spec.length), cooldown: base.cooldown * 1.4, speed: 9 });
    else if (a === "stomp") out.push({ kind: a, damage: hit(big), telegraph: warn(1), range: Math.min(5, 2 + spec.length * 0.4), cooldown: base.cooldown * 1.5 });
  }
  return out;
}

const BREATH_SECONDS = 1;
const BREATH_HALF_ANGLE = 0.5; // radians, about 29°
const BREATH_SPEED = 8;
const SHOT_RADIUS = 0.8;
/** It stops turning to follow you this long before the attack: the moment to step aside. */
const LOCK_SECONDS = 0.3;

/** Where its mouth is, roughly (front of the body at head height). */
function mouth(b: Body, s: SummonState): [number, number, number] {
  const r = Math.max(0.3, b.width * 0.6);
  return [b.x - Math.sin(s.yaw) * r, b.y + b.height * 0.75, b.z - Math.cos(s.yaw) * r];
}
const chest = (p: BrainPlayer): [number, number, number] => [p.x, p.y + 0.9, p.z];

function clear(ctx: BrainCtx, from: [number, number, number], to: [number, number, number]): boolean {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  const d = Math.hypot(dx, dy, dz);
  return raycast(ctx.world, from[0], from[1], from[2], dx, dy, dz, Math.max(0, d - 0.6), (id) => ctx.table.solid[id] === 1) === null;
}

/**
 * Pick a special attack that suits where the target is (in range, with a clear line), or null.
 * `meleeReady`: the bite is in reach too, so it can choose between them.
 */
export function pickAttack(spec: SummonSpec, stats: SummonStats, b: Body, s: SummonState, t: BrainPlayer, ctx: BrainCtx, meleeReady: boolean): AttackStats | null {
  if (s.cooldown > 0 || !stats.attacks?.length) return null;
  const m = mouth(b, s), c = chest(t);
  const d = Math.hypot(c[0] - m[0], c[1] - m[1], c[2] - m[2]);
  const dh = Math.hypot(t.x - b.x, t.z - b.z);
  const fits = stats.attacks.filter((a) => {
    if (a.kind === "breath") return d <= a.range && clear(ctx, m, c);
    if (a.kind === "shot") return d <= a.range && d > 2.5 && clear(ctx, m, c);
    if (a.kind === "charge") return b.onGround && dh >= 3 && dh <= a.range && Math.abs(t.y - b.y) < 2 && clear(ctx, [b.x, b.y + 0.6, b.z], [t.x, t.y + 0.6, t.z]);
    if (a.kind === "stomp") return dh < a.range * 0.75 && Math.abs(t.y - b.y) < 2.5 && (b.onGround || spec.movement !== "walk");
    return false;
  });
  if (!fits.length) return null;
  // Up close with a bite ready: bite half the time.
  if (meleeReady && spec.abilities.includes("bite") && ctx.rand() < 0.5) return null;
  return fits[Math.floor(ctx.rand() * fits.length)];
}

/** Start the warning for an attack. */
export function beginAttack(a: AttackStats, spec: SummonSpec, b: Body, s: SummonState, t: BrainPlayer, ctx: BrainCtx): void {
  s.mode = "windup";
  s.attack = a.kind;
  s.left = a.telegraph;
  s.warnedAt = s.age;
  s.hits = [];
  s.yaw = Math.atan2(-(t.x - b.x), -(t.z - b.z));
  ctx.warn();
  ctx.fx?.({ kind: a.kind, element: elementOf(spec), phase: "warn", from: mouth(b, s), to: chest(t), seconds: a.telegraph, radius: a.kind === "stomp" ? a.range : undefined });
}

/**
 * Run the special attack in progress (its warning, then the attack itself). Returns false when
 * there isn't one, so the caller moves the summon as usual; true when this has moved it.
 */
export function stepAttack(spec: SummonSpec, stats: SummonStats, b: Body, s: SummonState, ctx: BrainCtx, dt: number): boolean {
  if (!s.attack || s.attack === "bite" || (s.mode !== "windup" && s.mode !== "attack")) return false;
  const a = stats.attacks?.find((x) => x.kind === s.attack);
  const t = ctx.players.find((p) => p.id === s.target && p.huntable);
  if (!a) { endAttack(s, 0.5, 0); return false; }
  const element = elementOf(spec);
  if (s.mode === "windup") {
    s.flags |= 4 | attackFlags(a.kind, false);
    b.vx *= 0.8; b.vz *= 0.8; if (spec.movement !== "walk") b.vy *= 0.8;
    // It tracks you while it winds up, then commits for the last moment: that's when you dodge.
    if (t && s.left > LOCK_SECONDS) s.yaw = Math.atan2(-(t.x - b.x), -(t.z - b.z));
    else if (t && !s.aim) {
      const m = mouth(b, s), c = chest(t);
      const d = Math.hypot(c[0] - m[0], c[1] - m[1], c[2] - m[2]) || 1;
      s.aim = [(c[0] - m[0]) / d, (c[1] - m[1]) / d, (c[2] - m[2]) / d];
    }
    if (s.left > 0) return true;
    if (!t) { endAttack(s, 1, a.cooldown * 0.5); return true; }
    s.mode = "attack";
    s.hits = [];
    const m = mouth(b, s);
    if (!s.aim) { const c = chest(t), d = Math.hypot(c[0] - m[0], c[1] - m[1], c[2] - m[2]) || 1; s.aim = [(c[0] - m[0]) / d, (c[1] - m[1]) / d, (c[2] - m[2]) / d]; }
    if (a.kind === "breath") {
      s.left = BREATH_SECONDS;
      ctx.fx?.({ kind: a.kind, element, phase: "hit", from: m, to: [m[0] + s.aim[0] * a.range, m[1] + s.aim[1] * a.range, m[2] + s.aim[2] * a.range], seconds: BREATH_SECONDS });
    } else if (a.kind === "shot") {
      const v = a.speed ?? 14;
      (s.shots ??= []).push({ x: m[0], y: m[1], z: m[2], vx: s.aim[0] * v, vy: s.aim[1] * v, vz: s.aim[2] * v, left: a.range / v, damage: a.damage });
      ctx.fx?.({ kind: a.kind, element, phase: "hit", from: m, to: [m[0] + s.aim[0] * a.range, m[1] + s.aim[1] * a.range, m[2] + s.aim[2] * a.range], seconds: a.range / v });
      // It holds the pose until the shot reaches where you were (a recoil, and the playtest counts the dodge then).
      s.left = Math.min(a.range / v, Math.hypot(t.x - m[0], t.y + 0.9 - m[1], t.z - m[2]) / v + 0.15);
    } else if (a.kind === "charge") {
      const h = Math.hypot(s.aim[0], s.aim[2]) || 1;
      s.aim = [s.aim[0] / h, 0, s.aim[2] / h];
      s.left = Math.min(1.4, (Math.hypot(t.x - b.x, t.z - b.z) + 2) / (a.speed ?? 9));
      ctx.fx?.({ kind: a.kind, element, phase: "hit", from: [b.x, b.y, b.z], to: [b.x + s.aim[0] * a.range, b.y, b.z + s.aim[2] * a.range], seconds: s.left });
    } else if (a.kind === "stomp") {
      for (const p of ctx.players)
        if (p.huntable && Math.hypot(p.x - b.x, p.z - b.z) < a.range && Math.abs(p.y - b.y) < 2.5) ctx.bite(p.id, a.damage);
      ctx.fx?.({ kind: a.kind, element, phase: "hit", from: [b.x, b.y, b.z], to: [b.x, b.y, b.z], seconds: 0, radius: a.range });
      s.left = 0.3;
    }
    s.flags |= attackFlags(a.kind, true);
    return true;
  }
  // The attack itself.
  s.flags |= 4 | attackFlags(a.kind, true);
  const hits = (s.hits ??= []);
  if (a.kind === "breath" && s.aim) {
    b.vx *= 0.7; b.vz *= 0.7;
    const m = mouth(b, s);
    for (const p of ctx.players) {
      if (!p.huntable || hits.includes(p.id)) continue;
      const c = chest(p);
      const dx = c[0] - m[0], dy = c[1] - m[1], dz = c[2] - m[2], d = Math.hypot(dx, dy, dz);
      // The breath rolls outward: it reaches further each moment, up to its range.
      const reach = Math.min(a.range, 1 + (BREATH_SECONDS - s.left) * BREATH_SPEED);
      if (d > reach || d < 0.01) continue;
      const cos = (dx * s.aim[0] + dy * s.aim[1] + dz * s.aim[2]) / d;
      if (cos < Math.cos(BREATH_HALF_ANGLE) && d > 1.2) continue;
      if (!clear(ctx, m, c)) continue;
      hits.push(p.id);
      ctx.bite(p.id, a.damage);
    }
  } else if (a.kind === "charge" && s.aim) {
    const v = a.speed ?? 9;
    b.vx = s.aim[0] * v; b.vz = s.aim[2] * v;
    for (const p of ctx.players) {
      if (!p.huntable || hits.includes(p.id)) continue;
      if (Math.hypot(p.x - b.x, p.z - b.z) < b.width / 2 + 0.8 && Math.abs(p.y - b.y) < 2) { hits.push(p.id); ctx.bite(p.id, a.damage); }
    }
    // Ran into a wall: dazed (a window to hit back).
    if (b.hitWall) {
      b.vx = b.vz = 0;
      ctx.fx?.({ kind: a.kind, element, phase: "end", from: [b.x, b.y, b.z], to: [b.x, b.y, b.z], seconds: 1.8 });
      endAttack(s, 1.8, a.cooldown);
      return true;
    }
  } else {
    b.vx *= 0.7; b.vz *= 0.7;
  }
  if (s.left <= 0) {
    if (a.kind === "charge") { b.vx *= 0.3; b.vz *= 0.3; }
    endAttack(s, 1, a.cooldown);
  }
  return true;
}

function endAttack(s: SummonState, recover: number, cooldown: number): void {
  s.mode = "retreat";
  s.left = recover;
  s.cooldown = Math.max(s.cooldown, cooldown);
  s.attack = undefined;
  s.aim = undefined;
}

/** Move projectiles in flight: they stop at blocks and hit the first player they pass. */
export function stepShots(s: SummonState, ctx: BrainCtx, dt: number): void {
  if (!s.shots?.length) return;
  s.shots = s.shots.filter((q) => {
    const steps = Math.max(1, Math.ceil((Math.hypot(q.vx, q.vy, q.vz) * dt) / 0.4));
    for (let i = 0; i < steps; i++) {
      q.x += (q.vx * dt) / steps; q.y += (q.vy * dt) / steps; q.z += (q.vz * dt) / steps;
      if (ctx.table.solid[ctx.world.getBlock(Math.floor(q.x), Math.floor(q.y), Math.floor(q.z))] === 1) return false;
      for (const p of ctx.players) {
        if (!p.huntable) continue;
        if (Math.hypot(p.x - q.x, p.y + 0.9 - q.y, p.z - q.z) < SHOT_RADIUS) { ctx.bite(p.id, q.damage); return false; }
      }
    }
    q.left -= dt;
    return q.left > 0;
  });
}
