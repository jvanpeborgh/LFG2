import { describe, expect, it } from "vitest";
import { DEFAULT_STANDARDS, generateModel, checkSummon, looksLikeScenario, planScenario, summonStats } from "../src/index";

const std = DEFAULT_STANDARDS;
const count = (w: { groups: { count: number }[] }) => w.groups.reduce((n, g) => n + g.count, 0);

describe("scenario planner", () => {
  it("reads the example as an invasion: ships, rising waves, a mid boss and a final boss", () => {
    const text = "a swarm of ships arrive at the nearest coast and enemies come out in waves, with increasing difficulty and some bosses";
    expect(looksLikeScenario(text)).toBe(true);
    const { spec } = planScenario(text, std, 1);
    expect(spec!.ships).toBe(3);
    expect(spec!.waves.length).toBe(5);
    // Difficulty rises: never fewer enemies than the wave before, and brutes join later.
    for (let i = 1; i < spec!.waves.length; i++) expect(count(spec!.waves[i])).toBeGreaterThanOrEqual(count(spec!.waves[i - 1]));
    expect(spec!.waves[0].groups.length).toBe(1);
    expect(spec!.waves[4].groups.length).toBe(2);
    expect(spec!.waves.map((w) => w.boss?.name ?? null)).toEqual([null, null, "Pirate Captain", null, "Pirate King"]);
  });

  it("scales with the players there, gently", () => {
    const one = planScenario("pirates raid in waves", std, 1).spec!;
    const ten = planScenario("pirates raid in waves", std, 10).spec!;
    const total = (s: typeof one) => s.waves.reduce((n, w) => n + count(w), 0);
    expect(total(ten)).toBeGreaterThan(total(one) * 2);
    expect(total(ten)).toBeLessThan(total(one) * 4); // √players, not ×players
  });

  it("themes the cast, and every member passes the art checks", () => {
    for (const text of ["vikings raid the coast in 4 waves with bosses", "a ghost fleet attacks in waves with a boss", "pirates invade in 3 waves"]) {
      const s = planScenario(text, std, 2).spec!;
      for (const m of [s.ship, ...s.waves.flatMap((w) => [...w.groups.map((g) => g.spec), ...(w.boss ? [w.boss] : [])])]) {
        const model = generateModel(m, std);
        const report = checkSummon(m, model, std);
        expect(report.errors, `${text}: ${m.name}`).toEqual([]);
        const st = summonStats(m, model, std);
        // Boss attacks are telegraphed longer and stay within the per-hit cap.
        expect(st.damage).toBeLessThanOrEqual(std.balance.player.health * std.balance.damage.maxHitShareOfHealth);
        if (m.role === "boss") { expect(st.telegraph).toBeGreaterThanOrEqual(std.balance.damage.bossTelegraphSeconds); expect(st.slamRadius).toBeGreaterThan(0); }
      }
    }
  });

  it("caps silly requests and explains what it can't stage", () => {
    expect(planScenario("pirates attack in 40 waves", std).spec!.waves.length).toBe(8);
    expect(planScenario("pirates attack in 40 waves", std).notes.join(" ")).toMatch(/made it 8/);
    expect(planScenario("a birthday party", std).spec).toBeUndefined();
    expect(looksLikeScenario("a flying shark")).toBe(false);
  });
});
