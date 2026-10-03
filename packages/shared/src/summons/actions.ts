import type { Body } from "../physics";
import type { BrainCtx, SummonState } from "./brain";
import type { SummonSpec } from "./spec";

/**
 * What a creature does when it isn't fighting, so the world feels alive: grazers graze, hunters
 * sniff the ground, things sit for a while, everything sleeps at night, and a hunter roars when it
 * first spots you (a warning before it comes, not an attack). Each is a pose the clients play
 * (voxelMesh.ts), sent as bits of the entity flags.
 */
export type IdleAction = "graze" | "sniff" | "sit" | "roar" | "sleep";
export const IDLE_ACTIONS: IdleAction[] = ["graze", "sniff", "sit", "roar", "sleep"];
const SHIFT = 10;
export const ACTION_MASK = 7 << SHIFT;

export function actionFlags(a: IdleAction | undefined): number {
  return a ? (IDLE_ACTIONS.indexOf(a) + 1) << SHIFT : 0;
}
export function actionFromFlags(flags: number): IdleAction | null {
  const i = (flags >> SHIFT) & 7;
  return i ? IDLE_ACTIONS[i - 1] : null;
}

/** The actions that suit a creature (by body, temperament and movement). */
export function actionsFor(spec: SummonSpec): IdleAction[] {
  if (spec.movement !== "walk" || spec.body === "ship" || spec.body === "cloud") return [];
  const out: IdleAction[] = ["sleep"];
  const fights = spec.temperament !== "passive" && spec.abilities.some((a) => a !== "rain");
  if (spec.body === "quadruped" && !fights) out.push("graze");
  if (spec.body === "quadruped" || spec.body === "blob") out.push("sniff");
  // Dogs, cats and foxes sit; cattle, horses and bears lie down instead (their sleep pose, awake).
  if (spec.body === "biped" || (spec.body === "quadruped" && spec.length < 1.3)) out.push("sit");
  if (fights) out.push("roar");
  return out;
}

/** Start an action for a few seconds (it stands still meanwhile). */
export function startAction(s: SummonState, a: IdleAction, seconds: number): void {
  s.action = a;
  s.actionLeft = seconds;
}

/**
 * One idle tick for a walker that isn't hunting or following: carry on with its action, or choose
 * what to do next (an action, or a wander, towards the rest of its herd when it has one).
 * Returns the direction it wants to walk ([0, 0] to stand).
 */
export function idleLife(spec: SummonSpec, b: Body, s: SummonState, ctx: BrainCtx, dt: number): [number, number] {
  if (s.action && (s.actionLeft ?? 0) > 0) {
    s.actionLeft! -= dt;
    // Sleepers sleep until morning (checked now and then); the rest finish their action.
    if (s.action === "sleep" && !ctx.night && s.actionLeft! > 1) s.actionLeft = 1;
    s.flags |= actionFlags(s.action);
    return [0, 0];
  }
  s.action = undefined;
  if (s.left <= 0) {
    const can = actionsFor(spec);
    if (ctx.night && can.includes("sleep") && ctx.rand() < 0.6) { startAction(s, "sleep", 20 + ctx.rand() * 20); s.left = 0; return [0, 0]; }
    const awake = can.filter((a) => a !== "sleep" && a !== "roar");
    if (awake.length && ctx.rand() < 0.35) {
      const a = awake[Math.floor(ctx.rand() * awake.length)];
      startAction(s, a, a === "sit" ? 4 + ctx.rand() * 5 : a === "graze" ? 3 + ctx.rand() * 4 : 1.5 + ctx.rand() * 1.5);
      s.left = 0;
      return [0, 0];
    }
    if (can.includes("roar") && ctx.rand() < 0.05) { startAction(s, "roar", 1.2); s.left = 0; return [0, 0]; }
    s.left = 2 + ctx.rand() * 5;
    s.angle = ctx.rand() * Math.PI * 2;
    s.mode = ctx.rand() < 0.6 ? "idle" : "stalk";
    // A herd drifts back together: wander towards the others when it's strayed.
    if (ctx.kin?.length) {
      const cx = ctx.kin.reduce((n, k) => n + k[0], 0) / ctx.kin.length, cz = ctx.kin.reduce((n, k) => n + k[2], 0) / ctx.kin.length;
      if (Math.hypot(cx - b.x, cz - b.z) > 3 + ctx.kin.length) { s.angle = Math.atan2(cz - b.z, cx - b.x) + (ctx.rand() - 0.5) * 0.8; s.mode = "stalk"; }
    }
  }
  return s.mode !== "idle" ? [Math.cos(s.angle) * 0.5, Math.sin(s.angle) * 0.5] : [0, 0];
}
