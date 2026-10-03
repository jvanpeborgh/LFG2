import { describe, expect, it } from "vitest";
import {
  DEFAULT_STANDARDS, looksLikePower, planPower, scalePowerToTier, helpersNeeded, levelFromXp, planScenario, planSummon, ritualLevel, scaleScenarioToTier, scaleSummonToTier,
  scenarioTier, summonTier, tierForLevel, xpForLevel,
} from "../src/index";

const std = DEFAULT_STANDARDS;
const tierOf = (text: string) => summonTier(planSummon(text).spec!).tier;

describe("progression math", () => {
  it("follows the agreed curve: fast early levels, ~40 hours to level 20", () => {
    expect([2, 3, 4, 5, 6].map((l) => xpForLevel(l, std))).toEqual([100, 300, 600, 1000, 1720]);
    const total = xpForLevel(20, std);
    expect(total / 10 / 60).toBeGreaterThan(30); // hours at 10 XP a minute
    expect(total / 10 / 60).toBeLessThan(50);
    expect(levelFromXp(total + 1e6, std).level).toBe(20);
    expect(levelFromXp(350, std)).toEqual({ level: 3, into: 50, next: 300 });
  });

  it("unlocks tiers at levels 1, 4, 8, 12 and 17", () => {
    expect([1, 3, 4, 7, 8, 12, 16, 17, 20].map((l) => tierForLevel(l, std))).toEqual([1, 1, 2, 2, 3, 4, 4, 5, 5]);
  });

  it("rates summons by what they are, matching the tier examples", () => {
    expect(tierOf("a pig")).toBe(1);
    expect(tierOf("a cloud")).toBe(1);
    expect(tierOf("a storm cloud")).toBe(2);
    expect(tierOf("a pack of wolves")).toBe(2);
    expect(tierOf("a flying shark")).toBe(2);
    expect(tierOf("a huge kraken")).toBe(3);
    expect(tierOf("a red dragon")).toBe(3);
    expect(scenarioTier(planScenario("pirates raid in 3 waves", std).spec!).tier).toBe(3);
    expect(scenarioTier(planScenario("pirates raid in waves with bosses", std).spec!).tier).toBe(4);
  });

  it("scales a summon down to a tier: smaller, and harmless at tier 1", () => {
    const kraken = planSummon("a huge kraken").spec!;
    const t1 = scaleSummonToTier(kraken, 1)!;
    expect(t1.name).toBe("Young Kraken");
    expect(t1.temperament).toBe("passive");
    expect(summonTier(t1).tier).toBe(1);
    const t2 = scaleSummonToTier(kraken, 2)!;
    expect(t2.temperament).toBe("hostile");
    expect(summonTier(t2).tier).toBe(2);
    expect(scaleScenarioToTier(planScenario("pirates raid in waves with bosses", std).spec!, 2)).toBeNull();
    expect(scaleScenarioToTier(planScenario("pirates raid in waves with bosses", std).spec!, 3)!.waves.every((w) => !w.boss)).toBe(true);
  });

  it("lets rituals reach one tier above the leader, never more", () => {
    expect(helpersNeeded(6, 3, std)).toBe(1);
    expect(helpersNeeded(4, 3, std)).toBe(2);
    expect(helpersNeeded(3, 3, std)).toBeNull();
    expect(tierForLevel(ritualLevel([6, 1], std), std)).toBe(3);
    expect(tierForLevel(ritualLevel([6, 20, 1, 1, 1, 1, 1, 1], std), std)).toBe(5); // a level 20 helper can lead it
    expect(tierForLevel(ritualLevel([4, 1, 1, 1, 1, 1, 1, 1, 1], std), std)).toBe(3); // many helpers: still one tier up
  });

  it("reads powers on yourself, and scales them to a tier", () => {
    for (const t of ["the power of a wizard", "become a wizard", "wings", "give me the power to fly", "make me swift", "become an avatar of the storm", "grant me night vision"])
      expect(looksLikePower(t), t).toBe(true);
    for (const t of ["a flying shark", "a wizard", "a big cloud", "pirates raid in waves"]) expect(looksLikePower(t), t).toBe(false);
    expect(planPower("the power of a wizard", std)).toMatchObject({ name: "Wizard", tier: 4, minutes: 10, spells: ["fire_bolt", "blink", "frost_nova"] });
    expect(planPower("become an avatar of the storm", std)).toMatchObject({ name: "Avatar", tier: 5, oncePerDay: true });
    expect(scalePowerToTier(planPower("the power of a wizard", std)!, 3, std)!.name).toBe("Fire Bolt");
    expect(scalePowerToTier(planPower("the power of a wizard", std)!, 2, std)!.name).toBe("Night Vision");
    expect(scalePowerToTier(planPower("wings", std)!, 1, std)).toBeNull();
  });
});
