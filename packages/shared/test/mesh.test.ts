import { describe, expect, it } from "vitest";
import { DEFAULT_STANDARDS, VoxelGrid, checkSummon, cloneStandards, fitSpecToRules, generateModel, meshModel, planSummon, planTheme, setRule, surfaceNets, themeRules, type VoxelModel } from "../src";

const ball = (r: number): VoxelModel => {
  const n = r * 2 + 3;
  const g = new VoxelGrid(n, n, n);
  g.ellipsoid(n / 2, n / 2, n / 2, r, r, r, g.color("#808080"));
  return { voxelSize: 0.1, parts: [{ name: "body", grid: g, origin: [0, 0, 0], pivot: [0, 0, 0] }] };
};

describe("model styles", () => {
  for (const flat of [false, true]) {
    it(`${flat ? "low-poly" : "smooth"} surfaces face outward and are closed`, () => {
      const m = surfaceNets(ball(6).parts[0].grid, 1, flat);
      expect(m.indices.length).toBeGreaterThan(300);
      const p = m.positions;
      let c = [0, 0, 0];
      for (let i = 0; i < p.length; i += 3) c = [c[0] + p[i], c[1] + p[i + 1], c[2] + p[i + 2]];
      c = c.map((v) => v / (p.length / 3));
      let outward = 0;
      for (let t = 0; t < m.indices.length; t += 3) {
        const [a, b, d] = [m.indices[t] * 3, m.indices[t + 1] * 3, m.indices[t + 2] * 3];
        const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
        const v = [p[d] - p[a], p[d + 1] - p[a + 1], p[d + 2] - p[a + 2]];
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const mid = [(p[a] + p[b] + p[d]) / 3 - c[0], (p[a + 1] + p[b + 1] + p[d + 1]) / 3 - c[1], (p[a + 2] + p[b + 2] + p[d + 2]) / 3 - c[2]];
        if (n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2] > 0) outward++;
      }
      expect(outward).toBe(m.indices.length / 3);
    });
  }

  it("keeps one-voxel-thin parts (fins, wings)", () => {
    const g = new VoxelGrid(12, 3, 12);
    g.box(1, 1, 1, 10, 1, 10, g.color("#808080"));
    expect(surfaceNets(g, 1, false).indices.length).toBeGreaterThan(0);
  });

  it("picks the finest detail that fits the budget", () => {
    const m = ball(10);
    const fine = meshModel(m, "smooth");
    const fit = meshModel(m, "smooth", fine.triangles - 1);
    expect(fine.scale).toBe(2);
    expect(fit.scale).toBeLessThan(2);
    expect(fit.triangles).toBeLessThan(fine.triangles);
    expect(meshModel(m, "voxel").scale).toBe(1);
  });

  it("checks summons against the budget in the world's style", () => {
    const std = cloneStandards(DEFAULT_STANDARDS);
    const spec = fitSpecToRules(planSummon("a flying shark").spec!, std).spec;
    const model = generateModel(spec, std);
    const voxel = checkSummon(spec, model, std);
    setRule(std, "art.modelStyle", "smooth");
    const smooth = checkSummon(spec, model, std);
    expect(voxel.ok && smooth.ok).toBe(true);
    expect(smooth.stats.triangles).toBeGreaterThan(voxel.stats.triangles);
  });

  it("theme words choose the style", () => {
    expect(planTheme("a low-poly desert of glass").modelStyle).toBe("lowpoly");
    expect(planTheme("a soft claymation forest").modelStyle).toBe("smooth");
    expect(planTheme("cyberpunk samurai").modelStyle).toBeUndefined();
    const { changes } = themeRules(planTheme("faceted origami islands"), DEFAULT_STANDARDS);
    expect(changes).toContainEqual(["art.modelStyle", "lowpoly"]);
  });
});
