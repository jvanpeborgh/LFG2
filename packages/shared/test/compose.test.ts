import { describe, expect, it } from "vitest";
import { DEFAULT_STANDARDS as std, checkDesign } from "../src/index";

describe("designs by name: a base body and a kit of features", () => {
  it("builds a saddled unicorn from names alone", () => {
    const c = checkDesign({ name: "Saddled Unicorn", movement: "walk", length: 2, colors: { main: "neutral8", belly: "neutral7", accent: "pink4" }, base: "equine", kit: ["horn", "mane", "hooves", "saddle", "lantern"] }, std);
    expect(c.ok, JSON.stringify(c.issues)).toBe(true);
    expect(c.model!.parts.length).toBeGreaterThan(4);
  });
  it("adds the design's own parts to the base", () => {
    const own = { parts: [{ name: "shrine", shapes: [{ type: "box", at: [0, 2.1, 0], size: [0.5, 0.5, 0.5], color: "red3" }] }] };
    const c = checkDesign({ name: "Shrine Bear", movement: "walk", length: 2, base: "ursine", shape: own }, std);
    expect(c.ok, JSON.stringify(c.issues)).toBe(true);
    expect(c.model!.parts.some((p) => p.name === "shrine")).toBe(true);
  });
  it("says which names it doesn't know", () => {
    const c = checkDesign({ name: "Nope", movement: "walk", base: "kraken-ish", kit: ["laser eyes"] }, std);
    expect(c.ok).toBe(false);
    expect(c.issues.map((i) => i.path)).toEqual(expect.arrayContaining(["base", "kit"]));
  });
});
