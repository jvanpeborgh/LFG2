import { describe, expect, it } from "vitest";
import { DEFAULT_STANDARDS as std, EXAMPLE_STRUCTURE, buildStructure, structureModel, structurePlan } from "../src";

describe("structures: buildings written as blocks", () => {
  it("the example passes, and a box of odd size comes out exactly that size", () => {
    const r = buildStructure(EXAMPLE_STRUCTURE);
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(r.raster!.tier).toBe(3);
    const box = buildStructure({ title: "Block", primitives: [{ type: "box", at: [0, 1, 0], size: [5, 3, 7], block: "planks" }] }).raster!;
    expect([box.max[0] - box.min[0] + 1, box.max[1] - box.min[1] + 1, box.max[2] - box.min[2] + 1]).toEqual([5, 3, 7]);
  });

  it("hollow makes rooms, cut makes doors, and a room without a door is flagged", () => {
    const room = (door: boolean) => buildStructure({ title: "Room", primitives: [
      { type: "box", at: [0, 0, 0], size: [7, 1, 7], block: "planks" },
      { type: "box", at: [0, 3, 0], size: [7, 5, 7], block: "planks", hollow: true },
      ...(door ? [{ type: "box" as const, at: [0, 2, 3] as [number, number, number], size: [1, 3, 1] as [number, number, number], cut: true }] : []),
    ] });
    const shut = room(false), open = room(true);
    expect(shut.raster!.blocks.get("0,3,0")).toBe("air"); // inside the room
    expect(shut.issues.some((i) => /no door/.test(i.message))).toBe(true);
    expect(open.issues.some((i) => /no door/.test(i.message))).toBe(false);
    expect(open.raster!.blocks.get("0,2,3")).toBe("air");
  });

  it("points at mistakes with paths and hints", () => {
    const r = buildStructure({ title: "Bad", primitives: [{ type: "pyramid", at: [0, 0], size: [0, 1, 1], block: "plank" }] });
    expect(r.issues.map((i) => i.path)).toEqual(expect.arrayContaining(["primitives[0].type", "primitives[0].at", "primitives[0].size", "primitives[0].block"]));
  });

  it("stands on the land with a foundation, and previews as a model", () => {
    const r = buildStructure(EXAMPLE_STRUCTURE).raster!;
    const ids: Record<string, number> = { air: 0, cobblestone: 1, stone_bricks: 2, planks: 3, log: 4, bricks: 5, torch: 6 };
    // Sloping land: the foundation fills down to it under the lowest blocks.
    const plan = structurePlan(r, 100, 100, (x) => 60 + Math.floor((x - 100) / 2), (n) => ids[n] ?? 9);
    const [, base] = plan.center;
    expect(base).toBe(61);
    const foundation = [...plan.blocks].filter(([k, v]) => v === 1 && Number(k.split(",")[1]) < base).length;
    expect(foundation).toBeGreaterThan(0);
    expect(structureModel(r, std).parts[0].grid.count()).toBeGreaterThan(300);
  });
});
