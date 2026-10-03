import { describe, expect, it } from "vitest";
import { applyEdits, promptKey } from "../src/designer";

describe("designer edits", () => {
  const design = { name: "Fox", colors: { main: "orange4" }, kit: ["horns"], shape: { parts: [{ name: "body", shapes: [{ type: "box", size: [1, 1, 1] }] }] } };

  it("sets, adds and removes by path without touching the original", () => {
    const out = applyEdits(design, [
      { op: "set", path: "colors.main", value: "red4" },
      { op: "add", path: "kit", value: "saddle" },
      { op: "set", path: "shape.parts[0].shapes[0].size", value: [2, 1, 1] },
      { op: "add", path: "shape.parts[0].shapes[0]", value: { type: "ellipsoid" } },
      { op: "remove", path: "kit[0]" },
      { op: "set", path: "gait.kind", value: "trot" },
    ]) as typeof design & { gait: { kind: string } };
    expect(out.colors.main).toBe("red4");
    expect(out.kit).toEqual(["saddle"]);
    expect(out.shape.parts[0].shapes.map((s) => s.type)).toEqual(["ellipsoid", "box"]);
    expect(out.shape.parts[0].shapes[1].size).toEqual([2, 1, 1]);
    expect(out.gait.kind).toBe("trot");
    expect(design.colors.main).toBe("orange4");
  });

  it("explains bad paths", () => {
    expect(() => applyEdits(design, [{ op: "set", path: "shape.parts[5].name", value: "x" }])).toThrow(/parts\[5\]|nothing at/);
    expect(() => applyEdits(design, [{ op: "remove", path: "kit[3]" }])).toThrow(/no item 3/);
    expect(() => applyEdits(design, [{ op: "add", path: "name", value: 1 }])).toThrow(/not a list/);
  });

  it("remembers prompts by their words", () => {
    expect(promptKey("An ancient, obsidian Salamander!")).toBe("ancient obsidian salamander");
    expect(promptKey("the ancient obsidian salamander")).toBe(promptKey("Ancient obsidian salamander."));
  });
});
