import { describe, expect, it } from "vitest";
import { bearing, distanceBand, huntClue, looksLikeHunt, planHunt } from "../src";

describe("hunts", () => {
  it("reads what to hunt and for how long", () => {
    expect(looksLikeHunt("hunt a frost wyrm")).toBe(true);
    expect(looksLikeHunt("track down a yeti")).toBe(true);
    expect(looksLikeHunt("a red dragon")).toBe(false);
    expect(looksLikeHunt("a race track")).toBe(false);
    expect(planHunt("hunt a frost wyrm").quarry).toBe("a frost wyrm");
    expect(planHunt("hunt down the great boar for 20 minutes")).toMatchObject({ quarry: "a great boar", minutes: 20 });
    expect(planHunt("go hunting for an angry wolf").quarry).toBe("an angry wolf");
    expect(planHunt("a hunt").quarry).toBe("a fearsome beast");
    expect(planHunt("hunt a yeti for 90 minutes").minutes).toBe(30);
  });

  it("points the way: true on the trail, rough off it", () => {
    expect(bearing(0, 0, 0, -50)).toBe("north");
    expect(bearing(0, 0, 50, 0)).toBe("east");
    expect(bearing(0, 0, -30, 30)).toBe("south-west");
    expect(distanceBand(10)).toBe("close");
    expect(distanceBand(200)).toBe("far");
    // Off the trail: a wobbled bearing and no exact distance.
    const off = huntClue(0, 0, 100, 0, [], 1);
    expect(off.onTrail).toBe(false);
    expect(off.text).not.toMatch(/\d+ m/);
    // On it (fresh tracks at your feet): the true bearing and the distance.
    const on = huntClue(0, 0, 100, 0, [{ x: 2, y: 60, z: 1, yaw: 0, t: 0 }], 1);
    expect(on.onTrail).toBe(true);
    expect(on.text).toMatch(/east.*100 m/);
  });
});
