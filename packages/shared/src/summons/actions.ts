import type { Body } from "../physics";
import type { BrainCtx, SummonState } from "./brain";
import type { SummonSpec } from "./spec";

/**
 * What a creature does when it isn't fighting, so the world feels alive: grazers graze, hunters
 * sniff the ground, things sit for a while, everything sleeps at night, and a hunter roars when it
 * first spots you (a warning before it comes, not an attack). Each is a pose the clients play
 * (voxelMesh.ts), sent as bits of the entity flags.
 */
export type IdleAction = "graze" | "sniff" | "sit" | "roar" | "sleep" | "perch" | "breach";
export const IDLE_ACTIONS: IdleAction[] = ["graze", "sniff", "sit", "roar", "sleep", "perch", "breach"];

/**
 * How it is with people: curious ones come over for a look, shy ones keep their distance, calm
 * ones carry on. From its seed, so the same design always has the same character.
 */
export type Personality = "curious" | "shy" | "calm";
export function personalityOf(spec: SummonSpec): Personality {
  if (spec.temperament === "hostile") return "calm";
  return (["curious", "shy", "calm"] as const)[(spec.seed >>> 4) % 3];
}

/** Bats, owls, ghosts and the like are up at night and sleep by day. */
export function isNocturnal(spec: SummonSpec): boolean {
  return /\b(bat|bats|owl|owls|ghost|ghosts|vampire|vampires|firefly|fireflies|moth|moths|spirit|spirits|wraith|phantom|specter|spectre|night|nocturnal|moon|lunar|shadow)\b/.test(`${spec.name} ${spec.prompt}`.toLowerCase());
}
/** Whether it should be asleep now (night for most, day for nocturnal things). */
export function sleepTime(spec: SummonSpec, night: boolean | undefined): boolean {
  if (night === undefined) return false;
  return isNocturnal(spec) ? !night : night;
}

/** Other creatures nearby, as the brain sees them. */
export interface Neighbour { id: number; x: number; y: number; z: number; hostile: boolean }
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
  if (spec.body === "ship" || spec.body === "cloud") return [];
  // Flying fish and slimes keep to the air; birds, bats, dragons and winged beasts land.
  if (spec.movement === "fly" && (spec.body === "fish" || spec.body === "blob")) return [];
  if (spec.movement === "fly") return ["perch", "sleep", ...(spec.temperament !== "passive" && spec.abilities.some((a) => a !== "rain") ? ["roar" as const] : [])];
  if (spec.movement === "swim") return ["breach"];
  if (spec.movement !== "walk") return [];
  const out: IdleAction[] = ["sleep"];
  const fights = spec.temperament !== "passive" && spec.abilities.some((a) => a !== "rain");
  // Plant-eaters graze; meat-eaters (even friendly ones) sniff about instead.
  const words = `${spec.name} ${spec.prompt}`.toLowerCase();
  const eatsMeat = /\b(fox|foxes|cat|cats|kitten|dog|dogs|puppy|wolf|wolves|bear|bears|lion|lions|tiger|tigers|leopard|panther|cheetah|lynx|hyena|raccoon|weasel|otter|badger|dragon|lizard|crocodile|alligator|spider|scorpion)\b/.test(words);
  if (spec.body === "quadruped" && !fights && !eatsMeat) out.push("graze");
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
  const sleepy = sleepTime(spec, ctx.night);
  if (s.action && (s.actionLeft ?? 0) > 0) {
    s.actionLeft! -= dt;
    // Sleepers sleep until it's time to get up (checked now and then); the rest finish their action.
    if (s.action === "sleep" && !sleepy && s.actionLeft! > 1) s.actionLeft = 1;
    s.flags |= actionFlags(s.action);
    return [0, 0];
  }
  s.action = undefined;
  const others = ctx.others ?? [];
  const me = personalityOf(spec);
  const nearest = (list: { x: number; z: number }[]) => {
    let best: { x: number; z: number } | undefined, bd = Infinity;
    for (const o of list) { const d = Math.hypot(o.x - b.x, o.z - b.z); if (d < bd) { bd = d; best = o; } }
    return { o: best, d: bd };
  };
  // Prey keeps away from hunters; shy things from people who come close.
  if (spec.temperament === "passive") {
    const h = nearest(others.filter((o) => o.hostile));
    const p = me === "shy" ? nearest(ctx.players) : { o: undefined, d: Infinity };
    const threat = h.d < 7 ? h.o : p.d < 3.5 ? p.o : undefined;
    if (threat) { s.mode = "flee"; s.left = 2.5; s.angle = Math.atan2(b.z - threat.z, b.x - threat.x); return [Math.cos(s.angle), Math.sin(s.angle)]; }
  }
  if (s.left <= 0) {
    const can = actionsFor(spec);
    if (sleepy && can.includes("sleep") && ctx.rand() < 0.6) { startAction(s, "sleep", 20 + ctx.rand() * 20); s.left = 0; return [0, 0]; }
    // Curious ones come over to see who's there (and stop a couple of blocks short).
    const p = nearest(ctx.players);
    if (me === "curious" && p.o && p.d < 10 && p.d > 3 && ctx.rand() < 0.5) {
      s.angle = Math.atan2(p.o.z - b.z, p.o.x - b.x); s.mode = "stalk"; s.left = Math.min(4, (p.d - 2.5) / 0.8);
      return [Math.cos(s.angle) * 0.5, Math.sin(s.angle) * 0.5];
    }
    // Now and then it goes over to say hello to another creature, and sniffs it.
    const friend = nearest(others.filter((o) => !o.hostile));
    if (friend.o && friend.d < 10 && friend.d > 2 && ctx.rand() < 0.15) {
      s.angle = Math.atan2(friend.o.z - b.z, friend.o.x - b.x); s.mode = "stalk"; s.left = Math.min(5, (friend.d - 1.5) / 0.8);
      s.greet = true;
      return [Math.cos(s.angle) * 0.5, Math.sin(s.angle) * 0.5];
    }
    if (s.greet) { s.greet = false; if (can.includes("sniff")) { startAction(s, "sniff", 1.5 + ctx.rand()); s.left = 0; return [0, 0]; } }
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
