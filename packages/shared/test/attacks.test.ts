import { describe, expect, it } from "vitest";
import {
  DEFAULT_STANDARDS as std, attackFlags, attackFromFlags, elementOf, fitSpecToRules, generateModel, makeBody, newSummonState, normalizeDesign,
  planSummon, playtestSummon, stepSummon, summonStats, type BlockTable, type BrainPlayer, type SummonSpec,
} from "../src";

// A flat world: stone up to y = 9, air above.
const world = { getBlock: (_x: number, y: number) => (y < 10 && y >= 0 ? 1 : 0) };
const table = { solid: new Uint8Array(256).fill(1).map((v, i) => (i === 0 ? 0 : v)), liquid: new Uint8Array(256) } as unknown as BlockTable;

const plan = (prompt: string) => {
  const p = planSummon(prompt);
  if (!p.spec) throw new Error(p.notes.join("; "));
  const spec = fitSpecToRules(p.spec, std).spec;
  return { spec, stats: summonStats(spec, generateModel(spec, std), std) };
};
const withAbilities = (prompt: string, abilities: string[], extra: Partial<SummonSpec> = {}) => {
  const p = plan(prompt);
  const spec = { ...p.spec, abilities, temperament: "hostile" as const, ...extra };
  return { spec, stats: summonStats(spec, generateModel(spec, std), std) };
};

/** Run a summon at a player standing still (or sidestepping when warned); count what landed. */
function duel(spec: SummonSpec, stats: ReturnType<typeof summonStats>, opts: { dodge?: boolean; distance?: number; seconds?: number } = {}) {
  const b = makeBody(0.5, 10, 0.5, stats.width, stats.height);
  if (spec.movement !== "walk") b.y = 13;
  const s = newSummonState(b.x, b.y, b.z, () => 0.3);
  const me: BrainPlayer = { id: 1, x: 0.5, y: 10, z: 0.5 + (opts.distance ?? 6), huntable: true };
  const hits: number[] = [], fx: string[] = [];
  let warnedAt = -1, firstHitAfterWarn: number | null = null;
  const ctx = {
    world, table, gravity: std.balance.player.gravity, rand: () => 0.3, players: [me], groundY: () => 9,
    bite: (_: number, dmg: number) => { hits.push(dmg); if (firstHitAfterWarn === null) firstHitAfterWarn = s.age - warnedAt; },
    warn: () => { warnedAt = s.age; },
    fx: (f: { kind: string; phase: string }) => fx.push(`${f.kind}:${f.phase}`),
  };
  const dt = 0.05;
  for (let t = 0; t < (opts.seconds ?? 6); t += dt) {
    if (opts.dodge && s.mode === "windup") me.x += 4.3 * dt; // sidestep while warned
    stepSummon(spec, stats, b, s, ctx, dt);
  }
  return { hits, fx, firstHitAfterWarn, state: s };
}

describe("attacks", () => {
  it("reads attacks and elements from the words", () => {
    expect(plan("a fire-breathing dragon").spec.abilities).toContain("breath");
    expect(plan("a dragon").spec.abilities).toEqual(expect.arrayContaining(["bite", "breath"]));
    expect(plan("a skeleton archer").spec.abilities).toContain("shot");
    expect(plan("a charging bull").spec.abilities).toContain("charge");
    expect(plan("a charging bull").spec.temperament).not.toBe("passive");
    expect(plan("a flying bull that charges").spec.abilities).not.toContain("charge"); // only walkers charge
    expect(plan("a cute friendly dragon").spec.abilities).toEqual([]);
    expect(elementOf(plan("an ice dragon").spec)).toBe("frost");
    expect(elementOf(plan("a venomous dragon that spits").spec)).toBe("poison");
    // "Three tails" is a detail, not three foxes.
    expect(plan("a fire fox with three glowing tails").spec.count).toBe(1);
    expect(plan("three foxes").spec.count).toBe(3);
  });

  it("takes its numbers from the world's rules", () => {
    const { stats } = withAbilities("a dragon", ["bite", "breath", "shot", "stomp"]);
    const cap = std.balance.player.health * std.balance.damage.maxHitShareOfHealth;
    expect(stats.attacks!.map((a) => a.kind)).toEqual(["breath", "shot", "stomp"]);
    for (const a of stats.attacks!) {
      expect(a.damage).toBeLessThanOrEqual(cap);
      expect(a.telegraph).toBeGreaterThanOrEqual(std.audio.telegraphLeadSeconds);
    }
    expect(stats.damage).toBe(Math.max(...stats.attacks!.map((a) => a.damage)));
  });

  it("packs which attack is coming into the flags", () => {
    expect(attackFromFlags(attackFlags("breath", false) | 4 | 2)).toEqual({ kind: "breath", active: false });
    expect(attackFromFlags(attackFlags("stomp", true))).toEqual({ kind: "stomp", active: true });
    expect(attackFromFlags(2 | 4)).toBeNull();
  });

  for (const [name, prompt, abilities, distance] of [
    ["breath", "a wolf", ["breath"], 5],
    ["shot", "a wolf", ["shot"], 8],
    ["charge", "a bear", ["charge"], 7],
    ["stomp", "a bear", ["stomp"], 1.5],
  ] as const) {
    it(`${name}: warns first, lands on someone standing still, and can be dodged`, () => {
      const { spec, stats } = withAbilities(prompt, [...abilities]);
      const still = duel(spec, stats, { distance });
      expect(still.fx).toContain(`${name}:warn`);
      expect(still.fx).toContain(`${name}:hit`);
      expect(still.hits.length).toBeGreaterThan(0);
      expect(still.firstHitAfterWarn!).toBeGreaterThanOrEqual(std.audio.telegraphLeadSeconds);
      const dodger = duel(spec, stats, { distance, dodge: true, seconds: 3 });
      expect(dodger.fx).toContain(`${name}:hit`);
      expect(dodger.hits.length).toBe(0);
    });
  }

  it("a flying dragon breathes from the air", () => {
    const { spec, stats } = withAbilities("a dragon", ["breath"], { movement: "fly" });
    const r = duel(spec, stats, { distance: 6, seconds: 10 });
    expect(r.fx).toContain("breath:hit");
    expect(r.hits.length).toBeGreaterThan(0);
  });

  it("passes the playtest with each attack", () => {
    for (const abilities of [["breath"], ["shot"], ["charge"], ["stomp"], ["bite", "breath"]]) {
      const { spec, stats } = withAbilities("a bear", abilities);
      const r = playtestSummon(spec, stats, std, world, table, [0.5, 10, 0.5], 30);
      expect(r.errors, `${abilities}: ${JSON.stringify(r.metrics)}`).toEqual([]);
      expect(r.metrics.bites, abilities.join()).toBeGreaterThan(0);
    }
  });

  it("designs choose attacks and an element; the guide explains them", () => {
    const n = normalizeDesign({ name: "Frost Wyrm", movement: "walk", temperament: "hostile", abilities: ["bite", "breath"], element: "frost", body: "quadruped" }, std);
    expect(n.spec?.abilities).toEqual(["bite", "breath"]);
    expect(n.spec?.element).toBe("frost");
    expect(normalizeDesign({ name: "X", element: "plasma", body: "quadruped" }, std).issues.some((i) => i.path === "element")).toBe(true);
  });
});
