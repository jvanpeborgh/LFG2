import { describe, expect, it } from "vitest";
import { craterBlocks, isNightAt, mulberry32, planArc } from "../src";

describe("arcs", () => {
  it("reads which arc and how many days", () => {
    expect(planArc("a blood moon week")).toMatchObject({ def: { id: "blood_moon" }, days: 3 });
    expect(planArc("a meteor shower for 3 nights")).toMatchObject({ def: { id: "meteors" }, days: 3 });
    expect(planArc("a harvest festival")?.def.id).toBe("festival");
    expect(planArc("a festival week")?.days).toBe(7);
    expect(planArc("a meteor shower for 30 days")?.days).toBe(7);
    expect(planArc("a pirate raid")).toBeNull();
  });

  it("knows night from day on the game's clock", () => {
    expect(isNightAt(0.25 * 1200, 1200)).toBe(false); // noon
    expect(isNightAt(0.75 * 1200, 1200)).toBe(true); // midnight
    expect(isNightAt(0.02 * 1200, 1200)).toBe(false); // just after sunrise
  });

  it("leaves a crater with crystal and iron to mine", () => {
    const c = craterBlocks(3, mulberry32(1));
    expect(c.some((b) => b[3] === "crystal")).toBe(true);
    expect(c.some((b) => b[3] === "iron_ore")).toBe(true);
    expect(c.filter((b) => b[3] === "air").length).toBeGreaterThan(20);
  });
});
