import { describe, expect, it } from "vitest";
import {
  DEFAULT_STANDARDS as std, SKILLS, buildShape, checkDesign, cloneStandards, critiqueDesign, greedyMesh, interpretPrompt, meshModel, planTheme, setRule,
  skillMarkdown, VoxelGrid, type ShapeSpec, type SummonSpec,
} from "../src";

const spec = (shape: ShapeSpec, length = 2): SummonSpec => ({
  id: "t", name: "T", prompt: "t", body: "blob", length, colors: { main: "teal3", belly: "yellow5", accent: "orange3" },
  features: [], movement: "walk", temperament: "passive", abilities: [], count: 1, seed: 1, shape,
});
const ball: ShapeSpec = { parts: [{ name: "body", shapes: [{ type: "ellipsoid", at: [0, 1, 0], size: [1, 1, 1] }, { type: "ellipsoid", at: [0, 1, 0.45], size: [0.3, 0.3, 0.3], color: "neutral1", finish: "glow" }] }] };

const outwardShare = (m: { positions: Float32Array; indices: Uint32Array }) => {
  const p = m.positions;
  let c = [0, 0, 0];
  for (let i = 0; i < p.length; i += 3) c = [c[0] + p[i], c[1] + p[i + 1], c[2] + p[i + 2]];
  c = c.map((v) => v / (p.length / 3));
  let out = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, d] = [m.indices[t] * 3, m.indices[t + 1] * 3, m.indices[t + 2] * 3];
    const u = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], v = [p[d] - p[a], p[d + 1] - p[a + 1], p[d + 2] - p[a + 2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const mid = [(p[a] + p[b] + p[d]) / 3 - c[0], (p[a + 1] + p[b + 1] + p[d + 1]) / 3 - c[1], (p[a + 2] + p[b + 2] + p[d + 2]) / 3 - c[2]];
    if (n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2] > 0) out++;
  }
  return out / (m.indices.length / 3);
};

describe("sculpted style", () => {
  it("meshes a shape's primitives as a closed, outward surface, with finer detail up close", () => {
    const model = buildShape(ball, spec(ball), std);
    const m = meshModel(model, "sculpted", 4000, 4);
    expect(m.triangles).toBeGreaterThan(500);
    expect(m.triangles).toBeLessThanOrEqual(4000);
    expect(m.near!.triangles).toBeGreaterThan(m.triangles);
    expect(m.near!.triangles).toBeLessThanOrEqual(16000);
    expect(outwardShare(m.parts[0])).toBeGreaterThan(0.97);
  });

  it("keeps finishes: the glowing eye's triangles are marked glow", () => {
    const m = meshModel(buildShape(ball, spec(ball), std), "sculpted", 4000);
    const glow = [...(m.parts[0].finishes ?? [])].filter((f) => f === 3).length;
    expect(glow).toBeGreaterThan(5);
    expect(glow).toBeLessThan(m.triangles * 0.3);
  });

  it("falls back to smooth for models without a shape, and is deterministic", () => {
    const g = new VoxelGrid(8, 8, 8);
    g.ellipsoid(4, 4, 4, 3, 3, 3, g.color("#808080"));
    const plain = { voxelSize: 0.1, parts: [{ name: "body", grid: g, origin: [0, 0, 0] as [number, number, number], pivot: [0, 0, 0] as [number, number, number] }] };
    expect(meshModel(plain, "sculpted", 4000).triangles).toBe(meshModel(plain, "smooth", 4000).triangles);
    const a = meshModel(buildShape(ball, spec(ball), std), "sculpted", 4000), b = meshModel(buildShape(ball, spec(ball), std), "sculpted", 4000);
    expect([...a.parts[0].positions]).toEqual([...b.parts[0].positions]);
  });

  it("voxel meshes carry finishes too", () => {
    const m = greedyMesh(buildShape(ball, spec(ball), std).parts[0].grid);
    expect([...(m.finishes ?? [])].some((f) => f === 3)).toBe(true);
  });

  it("checks the close-up version against its budget, and theme words choose it", () => {
    const s = cloneStandards(std);
    setRule(s, "art.modelStyle", "sculpted");
    const r = checkDesign({ name: "Orb", movement: "hover", length: 1.5, shape: ball }, s);
    expect(r.ok).toBe(true);
    expect(r.report!.stats.closeUp!.triangles).toBeLessThanOrEqual(r.report!.stats.closeUp!.max);
    expect(planTheme("a world of porcelain figurines").modelStyle).toBe("sculpted");
  });
});

describe("design skills", () => {
  it("interprets requests into a skill, a mood and a starting design that passes the rules", () => {
    for (const [prompt, skill, mood] of [
      ["a cute pink dragon", "winged-creature", "cute"], ["a menacing wolf", "four-legged-creature", "menacing"], ["a noble knight", "humanoid", "heroic"],
      ["a ghost", "floating-spirit", "neutral"], ["an angry shark", "swimmer", "menacing"],
    ]) {
      const r = interpretPrompt(prompt, std);
      if ("error" in r) throw new Error(r.error);
      expect([r.brief.skill, r.brief.mood], prompt).toEqual([skill, mood]);
      const c = checkDesign(r.start, std);
      expect(c.ok, `${prompt}: ${JSON.stringify([c.issues, c.report?.errors])}`).toBe(true);
    }
    expect("error" in interpretPrompt("a toaster", std)).toBe(true);
  });

  it("starts a dragon as a dragon: the planner's horns, spines and a long tail are added", () => {
    const r = interpretPrompt("a cute pink dragon", std);
    if ("error" in r) throw new Error(r.error);
    const parts = r.start.shape!.parts;
    expect(parts.find((p) => p.anim === "head")!.shapes.some((q) => q.mirror && q.at[1] > 1.4 && q.rotate)).toBe(true);
    expect(parts.find((p) => p.anim === "body")!.shapes.length).toBeGreaterThan(4);
    expect(parts.find((p) => p.anim === "tail")!.shapes.length).toBeGreaterThan(1);
  });

  it("critiques against the mood: a cute head on a menacing wolf is flagged with a fix", () => {
    const cute = interpretPrompt("a cute wolf", std), mean = interpretPrompt("a menacing wolf", std);
    if ("error" in cute || "error" in mean) throw new Error("no skill");
    const model = checkDesign(cute.start, std).model!;
    const asMean = critiqueDesign(cute.start, model, mean.brief, std);
    expect(asMean.issues.some((i) => /head length/.test(i.message) && /smaller/.test(i.hint))).toBe(true);
    const asCute = critiqueDesign(cute.start, model, cute.brief, std);
    expect(asCute.score).toBeGreaterThan(asMean.score);
  });

  it("every skill's template builds, and exports as a SKILL.md", () => {
    for (const s of SKILLS) {
      const r = checkDesign({ name: s.name.slice(0, 32), movement: s.movement, shape: s.template }, std);
      expect(r.ok, `${s.id}: ${JSON.stringify(r.issues)}`).toBe(true);
      const md = skillMarkdown(s);
      expect(md).toMatch(new RegExp(`^---\\nname: lfg2-${s.id}\\ndescription: `));
    }
  });
});
