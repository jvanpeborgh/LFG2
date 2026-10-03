import { describe, expect, it } from "vitest";
import {
  DEFAULT_STANDARDS as std, actionFromFlags, actionsFor, isNocturnal, personalityOf, type Neighbour, fitSpecToRules, generateModel, makeBody, newSummonState, planSummon, stepSummon,
  summonStats, type BlockTable, type BrainCtx, type BrainPlayer,
} from "../src";

const world = { getBlock: (_x: number, y: number) => (y < 10 && y >= 0 ? 1 : 0) };
const table = { solid: new Uint8Array(256).fill(1).map((v, i) => (i === 0 ? 0 : v)), liquid: new Uint8Array(256) } as unknown as BlockTable;
const plan = (prompt: string) => {
  const spec = fitSpecToRules(planSummon(prompt).spec!, std).spec;
  return { spec, stats: summonStats(spec, generateModel(spec, std), std) };
};
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// A sea: stone below y = 5, water up to y = 12.
const sea = { getBlock: (_x: number, y: number) => (y < 5 && y >= 0 ? 1 : y < 12 && y >= 0 ? 2 : 0) };
const seaTable = { solid: new Uint8Array(256).fill(1).map((v, i) => (i === 0 || i === 2 ? 0 : v)), liquid: new Uint8Array(256).map((_, i) => (i === 2 ? 1 : 0)) } as unknown as BlockTable;

function run(prompt: string, seconds: number, opts: { night?: boolean; players?: BrainPlayer[]; kin?: [number, number, number][]; others?: Neighbour[]; follow?: number; sea?: boolean; seed?: number; move?: (t: number, ps: BrainPlayer[]) => void } = {}) {
  const p = plan(prompt);
  const spec = opts.seed !== undefined ? { ...p.spec, seed: opts.seed } : p.spec, stats = p.stats;
  const b = makeBody(0.5, opts.sea ? 9 : spec.movement === "fly" ? 16 : 10, 0.5, stats.width, stats.height);
  const s = newSummonState(b.x, b.y, b.z, rand);
  if (opts.follow !== undefined) s.follow = opts.follow;
  const players = opts.players ?? [];
  const seen = new Map<string, number>();
  let roarAt = -1, warnAt = -1;
  const ctx: BrainCtx = { world: opts.sea ? sea : world, table: opts.sea ? seaTable : table, gravity: std.balance.player.gravity, rand, players, groundY: () => (opts.sea ? 11 : 9), others: opts.others, bite: () => {}, warn: () => { if (warnAt < 0) warnAt = s.age; }, night: opts.night, kin: opts.kin };
  let maxGap = 0, maxY = -Infinity, minPlayerGap = Infinity;
  for (let t = 0; t < seconds; t += 0.05) {
    opts.move?.(t, players);
    stepSummon(spec, stats, b, s, ctx, 0.05);
    const a = actionFromFlags(s.flags);
    if (a) seen.set(a, (seen.get(a) ?? 0) + 0.05);
    if (a === "roar" && roarAt < 0) roarAt = s.age;
    if (players[0]) { const g = Math.hypot(players[0].x - b.x, players[0].z - b.z); maxGap = Math.max(maxGap, g); if (t > 10) minPlayerGap = Math.min(minPlayerGap, g); }
    maxY = Math.max(maxY, b.y);
  }
  return { seen, roarAt, warnAt, body: b, state: s, maxGap, maxY, minPlayerGap };
}

describe("idle actions", () => {
  it("knows what suits whom", () => {
    expect(actionsFor(plan("a cow").spec)).toEqual(expect.arrayContaining(["graze", "sleep"]));
    expect(actionsFor(plan("a cow").spec)).not.toContain("sit"); // too big to sit like a dog
    expect(actionsFor(plan("a dog").spec)).toContain("sit");
    expect(actionsFor(plan("a fox").spec)).not.toContain("graze");
    expect(actionsFor(plan("a rabbit").spec)).toContain("graze");
    expect(actionsFor(plan("an angry wolf").spec)).toContain("roar");
    expect(actionsFor(plan("an angry wolf").spec)).not.toContain("graze");
    expect(actionsFor(plan("a flying shark").spec)).toEqual([]);
    expect(actionsFor(plan("a red dragon").spec)).toContain("perch");
    expect(actionsFor(plan("a big cloud").spec)).toEqual([]);
  });

  it("grazes, sits and sniffs by day, and sleeps at night", () => {
    const day = run("a cow", 120);
    expect([...day.seen.keys()]).toEqual(expect.arrayContaining(["graze"]));
    expect(day.seen.has("sleep")).toBe(false);
    const night = run("a cow", 120, { night: true });
    expect(night.seen.get("sleep") ?? 0).toBeGreaterThan(40);
  });

  it("roars when it spots you, before its first attack", () => {
    const me: BrainPlayer = { id: 1, x: 0.5, y: 10, z: 8.5, huntable: true };
    const r = run("an angry wolf", 8, { players: [me] });
    expect(r.roarAt).toBeGreaterThanOrEqual(0);
    expect(r.warnAt).toBeGreaterThan(r.roarAt);
  });

  it("asleep, it only notices you close by", () => {
    const me: BrainPlayer = { id: 1, x: 0.5, y: 10, z: 30.5, huntable: true };
    // Fall asleep first, then a player walks up from far away.
    const r = run("an angry wolf", 60, { night: true, players: [me], move: (t, [p]) => { p.z = t < 40 ? 30.5 : 12.5; } });
    expect(r.state.target).toBeNull();
  });

  it("a companion keeps up with the player it follows", () => {
    const me: BrainPlayer = { id: 5, x: 0.5, y: 10, z: 0.5, huntable: false };
    // The player walks off in a straight line at walking speed.
    const r = run("a dog", 20, { players: [me], follow: 5, move: (t, [p]) => { p.x = 0.5 + Math.min(t, 12) * 3.5; } });
    expect(Math.hypot(me.x - r.body.x, me.z - r.body.z)).toBeLessThan(6);
  });

  it("a herd drifts back together", () => {
    const far = run("a cow", 60, { kin: [[25, 10, 25], [27, 10, 24]] });
    expect(Math.hypot(far.body.x - 26, far.body.z - 24.5)).toBeLessThan(Math.hypot(0.5 - 26, 0.5 - 24.5));
  });

  it("flyers land and perch, and sleep perched at night", () => {
    const day = run("an eagle", 120);
    expect(day.seen.get("perch") ?? 0).toBeGreaterThan(3);
    const night = run("an eagle", 120, { night: true });
    expect(night.seen.get("sleep") ?? 0).toBeGreaterThan(20);
  });

  it("owls and bats are up at night and sleep by day", () => {
    expect(isNocturnal(plan("an owl").spec)).toBe(true);
    expect(isNocturnal(plan("an eagle").spec)).toBe(false);
    expect(run("an owl", 120, { night: false }).seen.get("sleep") ?? 0).toBeGreaterThan(20);
    expect(run("an owl", 120, { night: true }).seen.has("sleep")).toBe(false);
  });

  it("dolphins leap out of the water", () => {
    const r = run("a dolphin", 120, { sea: true });
    expect(r.seen.get("breach") ?? 0).toBeGreaterThan(0.3);
    expect(r.maxY).toBeGreaterThan(12);
  });

  it("prey keeps away from hunters nearby", () => {
    const wolf: Neighbour = { id: 99, x: 3, y: 10, z: 0.5, hostile: true };
    const r = run("a cow", 6, { others: [wolf] });
    expect(Math.hypot(r.body.x - wolf.x, r.body.z - wolf.z)).toBeGreaterThan(7);
  });

  it("curious creatures come over to see you; shy ones keep their distance", () => {
    const { spec } = plan("a fox");
    const seedFor = (want: string) => { for (let k = 0; k < 64; k++) if (personalityOf({ ...spec, seed: k << 4 }) === want) return k << 4; throw new Error(want); };
    const at = (): BrainPlayer[] => [{ id: 1, x: 8.5, y: 10, z: 0.5, huntable: false }];
    const curious = run("a fox", 40, { players: at(), seed: seedFor("curious") });
    expect(curious.minPlayerGap).toBeLessThan(4.5);
    const shy = run("a fox", 40, { players: [{ id: 1, x: 2.5, y: 10, z: 0.5, huntable: false }], seed: seedFor("shy") });
    expect(shy.minPlayerGap).toBeGreaterThan(3);
  });
});
