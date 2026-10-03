import { describe, expect, it } from "vitest";
import { DEFAULT_STANDARDS as std, EXAMPLE_SHAPE, buildShape, checkDesign, designGuide, generateModel, modelStats, normalizeDesign, validateShape, type SummonSpec } from "../src";

const spec = (shape = EXAMPLE_SHAPE, length = 2): SummonSpec => ({
  id: "t", name: "T", prompt: "t", body: "fish", length, colors: { main: "teal3", belly: "yellow5", accent: "orange3" },
  features: [], movement: "swim", temperament: "passive", abilities: [], count: 1, seed: 1, shape,
});

describe("shapes: models written as primitives", () => {
  it("the guide's example passes every check", () => {
    const r = checkDesign(designGuide(std).example, std);
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.model!.parts.map((p) => p.name)).toEqual(["body", "tail", "fin", "fin (mirror)"]);
  });

  it("scales to the summon's length and stands on its feet", () => {
    for (const length of [1, 3, 8]) {
      const st = modelStats(buildShape(EXAMPLE_SHAPE, spec(EXAMPLE_SHAPE, length), std));
      expect(Math.max(...st.size)).toBeGreaterThan(length * 0.85);
      expect(Math.max(...st.size)).toBeLessThanOrEqual(length * 1.05);
    }
    const m = generateModel(spec(), std);
    const minY = Math.min(...m.parts.map((p) => {
      for (let y = 0; y < p.grid.h; y++) for (let z = 0; z < p.grid.d; z++) for (let x = 0; x < p.grid.w; x++) if (p.grid.get(x, y, z)) return p.origin[1] + y;
      return Infinity;
    }));
    expect(minY).toBeCloseTo(0, 5);
  });

  it("is deterministic", () => {
    const a = buildShape(EXAMPLE_SHAPE, spec(), std), b = buildShape(EXAMPLE_SHAPE, spec(), std);
    expect(a.parts.map((p) => [...p.grid.data].join())).toEqual(b.parts.map((p) => [...p.grid.data].join()));
  });

  it("every primitive fills something, and cuts carve", () => {
    for (const type of ["box", "ellipsoid", "cylinder", "cone", "capsule", "torus", "wedge"] as const) {
      const one = { parts: [{ name: "body", shapes: [{ type, at: [0, 1, 0] as [number, number, number], size: [1, 1, 1] as [number, number, number] }] }] };
      expect(validateShape(one, std)).toEqual([]);
      expect(buildShape(one, spec(one), std).parts[0].grid.count(), type).toBeGreaterThan(50);
    }
    const box = { parts: [{ name: "body", shapes: [{ type: "box" as const, at: [0, 0, 0] as [number, number, number], size: [1, 1, 1] as [number, number, number] }] }] };
    const cut = { parts: [{ name: "body", shapes: [...box.parts[0].shapes, { type: "ellipsoid" as const, at: [0, 0, 0] as [number, number, number], size: [0.8, 2, 0.8] as [number, number, number], cut: true }] }] };
    expect(buildShape(cut, spec(cut), std).parts[0].grid.count()).toBeLessThan(buildShape(box, spec(box), std).parts[0].grid.count() * 0.7);
  });

  it("mirrors parts and primitives, swapping left and right roles", () => {
    const m = buildShape(EXAMPLE_SHAPE, spec(), std);
    const l = m.parts.find((p) => p.name === "fin")!, r = m.parts.find((p) => p.name === "fin (mirror)")!;
    expect(l.anim).toBe("finL");
    expect(r.anim).toBe("finR");
    expect(l.grid.count()).toBe(r.grid.count());
    expect(Math.sign(l.origin[0] + l.grid.w / 2)).toBe(-Math.sign(r.origin[0] + r.grid.w / 2));
  });

  it("keeps parts thinner than a voxel", () => {
    const fin = { parts: [{ name: "body", shapes: [{ type: "ellipsoid" as const, at: [0, 1, 0] as [number, number, number], size: [0.02, 1, 1] as [number, number, number] }] }] };
    expect(buildShape(fin, spec(fin), std).parts[0].grid.count()).toBeGreaterThan(20);
  });
});

describe("designs: what agents write, and the repairs they're told", () => {
  it("points at each mistake with a path and a hint", () => {
    const { issues, spec: s } = normalizeDesign({
      name: "Blob", movement: "jog", colors: { main: "purple3" },
      shape: { parts: [{ name: "body", shapes: [{ type: "sphere", at: [0, 0], size: [1, 1, 0], color: "gray4" }] }] },
    }, std);
    expect(s).toBeUndefined();
    const at = (path: string) => issues.find((i) => i.path === path);
    expect(at("movement")?.hint).toMatch(/walk/);
    expect(at("colors.main")?.hint).toMatch(/violet3/);
    expect(at("parts[0].shapes[0].type")?.hint).toMatch(/ellipsoid/);
    expect(at("parts[0].shapes[0].at")).toBeDefined();
    expect(at("parts[0].shapes[0].size")).toBeDefined();
    expect(at("parts[0].shapes[0].color")?.hint).toMatch(/neutral/);
  });

  it("warns about floating parts and things that vanish on the grass", () => {
    const r = checkDesign({
      name: "Green Lump", movement: "walk", length: 1.5, colors: { main: "green3", belly: "green2", accent: "green1" },
      shape: { parts: [
        { name: "body", shapes: [{ type: "box", at: [0, 0.5, 0], size: [1, 1, 1] }] },
        { name: "hat", shapes: [{ type: "cone", at: [0, 2, 0], size: [0.5, 0.5, 0.5], color: "red3" }] },
      ] },
    }, std);
    expect(r.ok).toBe(true);
    expect(r.report!.warnings.join("\n")).toMatch(/"hat" doesn't touch/);
    expect(r.report!.warnings.join("\n")).toMatch(/grass colour/);
  });

  it("holds designs to the same rules as planned summons", () => {
    const r = checkDesign({ name: "Huge Biter", movement: "walk", temperament: "hostile", length: 40, shape: EXAMPLE_SHAPE }, std);
    expect(r.fitted.join(" ")).toMatch(/blocks long instead of 40/);
    expect(r.spec!.length).toBeLessThan(40);
    expect(r.issues.some((i) => i.path === "abilities")).toBe(false); // hostile gets a bite by default
  });

  it("a revised design is a new entity type", () => {
    const a = normalizeDesign({ name: "Moth", movement: "fly", shape: EXAMPLE_SHAPE }, std).spec!;
    const b = normalizeDesign({ name: "Moth", movement: "fly", length: 3, shape: EXAMPLE_SHAPE }, std).spec!;
    expect(a.id).toMatch(/^design_moth_/);
    expect(a.id).not.toBe(b.id);
  });

  it("a broken shape never reaches the generator", () => {
    const s = { ...spec(), shape: { parts: [{ name: "body", shapes: [{ type: "blob" }] }] } } as unknown as SummonSpec;
    expect(() => generateModel(s, std)).not.toThrow();
  });
});
