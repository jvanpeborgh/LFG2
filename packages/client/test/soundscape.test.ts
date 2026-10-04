import { describe, expect, it } from "vitest";
import { probeSurroundings } from "../src/soundscape";

// A tiny block world: 1 = stone, 2 = leaves, 3 = water, 4 = grass.
function world(fill: (x: number, y: number, z: number) => number) {
  return { getBlock: (x: number, y: number, z: number) => fill(x, y, z) };
}
const solid = (id: number) => id === 1 || id === 2 || id === 4;
const kind = (id: number) => (id === 1 ? "stone" : id === 2 ? "tree" : id === 3 ? "water" : id === 4 ? "grass" : "other") as "stone" | "tree" | "grass" | "water" | "other";

describe("soundscape", () => {
  it("hears an open meadow as open, with grass about", () => {
    const meadow = world((_x, y) => (y < 10 ? 4 : 0));
    const e = probeSurroundings(meadow, solid, kind, 0.5, 11.6, 0.5);
    expect(e.enclosed).toBeLessThan(0.2);
    expect(e.roof).toBe(false);
    expect(e.cave).toBe(0);
    expect(e.grass).toBeGreaterThan(0.5);
  });

  it("hears a cave as enclosed, rocky and echoing", () => {
    // A 7×4×7 hollow in solid stone.
    const cave = world((x, y, z) => (Math.abs(x) <= 3 && Math.abs(z) <= 3 && y >= 10 && y < 14 ? 0 : 1));
    const e = probeSurroundings(cave, solid, kind, 0.5, 11.6, 0.5);
    expect(e.enclosed).toBeGreaterThan(0.8);
    expect(e.roof).toBe(true);
    expect(e.cave).toBeGreaterThan(0.8);
    expect(e.room).toBeLessThan(6);
  });

  it("hears the shore and the trees", () => {
    const shore = world((x, y, z) => (y < 10 ? (x > 4 ? 3 : 4) : y < 16 && Math.abs(z - 8) < 2 && x < 0 ? 2 : 0));
    const e = probeSurroundings(shore, solid, kind, 0.5, 11.6, 0.5);
    expect(e.water).toBeGreaterThan(0.5);
    expect(e.trees).toBeGreaterThan(0);
  });
});
