import { describe, expect, it } from "vitest";
import { happeningValue, isBuiltBlock, planHappening } from "../src";

describe("happenings", () => {
  it("reads what's asked for and for how long", () => {
    expect(planHappening("low gravity for 10 minutes")).toMatchObject({ def: { id: "low_gravity" }, minutes: 10 });
    expect(planHappening("make it an ice world")?.def.id).toBe("ice");
    expect(planHappening("the floor is lava!")?.def.id).toBe("lava");
    expect(planHappening("peace day")?.def.id).toBe("peace");
    expect(planHappening("eternal night for five minutes")).toMatchObject({ def: { id: "night" }, minutes: 5 });
    expect(planHappening("low gravity for 90 minutes")?.minutes).toBe(15);
    expect(planHappening("a red dragon")).toBeNull();
  });
  it("scales rules from what they are now, and knows built ground from natural", () => {
    expect(happeningValue(32, "×0.35")).toBeCloseTo(11.2);
    expect(happeningValue(4, 7)).toBe(7);
    expect(isBuiltBlock("planks", ["wood"])).toBe(true);
    expect(isBuiltBlock("grass", ["soil"])).toBe(false);
    expect(isBuiltBlock("stone", ["stone"])).toBe(false);
    expect(isBuiltBlock("stone_bricks", [])).toBe(true);
  });
});
