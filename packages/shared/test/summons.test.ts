import { describe, expect, it } from "vitest";
import {
  DEFAULT_STANDARDS as std, checkSummon, fitSpecToRules, generateModel, greedyMesh, modelLength, modelStats, planSummon,
  summonStats, topBumps,
} from "../src";

const build = (prompt: string) => {
  const plan = planSummon(prompt);
  if (!plan.spec) throw new Error(plan.notes.join("; "));
  const { spec, notes } = fitSpecToRules(plan.spec, std);
  const model = generateModel(spec, std);
  return { spec, notes, model, report: checkSummon(spec, model, std), stats: summonStats(spec, model, std) };
};

describe("summon planning", () => {
  it("understands the requests we care about", () => {
    expect(build("a big cloud").spec).toMatchObject({ body: "cloud", movement: "drift", temperament: "passive" });
    expect(build("a flying shark").spec).toMatchObject({ body: "fish", movement: "fly", temperament: "hostile", name: "Flying Shark" });
    expect(build("a storm cloud").spec.abilities).toContain("rain");
    expect(build("three angry wolves").spec).toMatchObject({ count: 3, temperament: "hostile", name: "Angry Wolf" });
    expect(build("a cute dragon").spec.temperament).toBe("passive");
    expect(build("a cloud shaped like a shark").spec.body).toBe("cloud");
    expect(planSummon("a toaster").spec).toBeNull();
  });

  it("fits requests to the rules instead of failing, and says what changed", () => {
    const whale = build("a giant whale");
    expect(whale.spec.length).toBe(std.summons.maxLengthBlocks);
    expect(whale.notes[0]).toMatch(/16 blocks/);
    expect(build("a huge angry shark").spec.length).toBe(std.summons.hostileMaxLengthBlocks);
    expect(build("ten sharks").spec.count).toBe(std.summons.maxCountPerSummon);
  });

  it("gives flying things a way to fly", () => {
    expect(build("a flying pig").model.parts.some((p) => p.anim === "wingL")).toBe(true);
    expect(build("a flying shark").spec.features).toContain("bigFins");
  });
});

describe("3D generation", () => {
  const prompts = ["a big cloud", "a storm cloud", "a flying shark", "a giant whale", "a red dragon", "a flying pig", "three angry wolves", "a jellyfish", "a ghost", "a slime", "two small birds", "a horse"];

  it("passes the standards checks for every body plan", () => {
    for (const p of prompts) {
      const { report } = build(p);
      expect(report.errors, p).toEqual([]);
    }
  });

  it("is deterministic (server and clients build the same model from the spec)", () => {
    const a = build("a flying shark").model, b = build("a flying shark").model;
    expect(a.parts.map((p) => Buffer.from(p.grid.data).toString("base64"))).toEqual(b.parts.map((p) => Buffer.from(p.grid.data).toString("base64")));
  });

  it("keeps models within their requested length", () => {
    for (const p of prompts) {
      const { spec, model } = build(p);
      expect(modelLength(model), p).toBeLessThanOrEqual(spec.length * 1.05 + 0.2);
    }
  });

  it("makes clouds with a bumpy, cloud-like top (silhouette test)", () => {
    for (const p of ["a cloud", "a big cloud", "a storm cloud", "a small cloud", "a huge fluffy cloud"]) expect(topBumps(build(p).model), p).toBeGreaterThanOrEqual(3);
  });

  it("gives a shark the parts that make it read as a shark", () => {
    const { model, spec } = build("a flying shark");
    const names = model.parts.map((p) => p.anim);
    expect(names).toEqual(expect.arrayContaining(["body", "tail", "finL", "finR"]));
    const body = model.parts[0].grid;
    const colors = new Set([...body.data].filter(Boolean).map((i) => body.palette[i]));
    const P = std.art.palette as Record<string, string>;
    expect(colors.has(P[spec.colors.main])).toBe(true); // back
    expect(colors.has(P[spec.colors.belly])).toBe(true); // countershaded belly
    expect(colors.has(P.neutral8)).toBe(true); // teeth / eye glint
  });

  it("uses greedy meshing to stay far below the triangle budget", () => {
    const { model, report } = build("a big cloud");
    const naive = model.parts.reduce((n, p) => n + p.grid.count() * 12, 0);
    expect(report.stats.triangles).toBeLessThan(naive / 10);
    expect(greedyMesh(model.parts[0].grid).quads * 2).toBe(modelStats(model).triangles);
  });
});

describe("default behaviour numbers follow the balance rules", () => {
  it("makes a flying shark a fair fight", () => {
    const { stats } = build("a flying shark");
    const bal = std.balance;
    expect(stats.kind).toBe("hostile");
    expect(stats.damage).toBeLessThanOrEqual(bal.player.health * bal.damage.maxHitShareOfHealth);
    expect(stats.telegraph).toBeGreaterThanOrEqual(std.audio.telegraphLeadSeconds);
    expect(stats.speed).toBeLessThan(bal.player.walkSpeed); // you can run away
    const hits = stats.health / 16;
    expect(hits).toBeGreaterThanOrEqual(bal.enemyHitsToDefeat[0]);
    expect(hits).toBeLessThanOrEqual(bal.enemyHitsToDefeat[1]);
  });

  it("makes clouds harmless scenery high above the ground", () => {
    const { stats } = build("a big cloud");
    expect(stats).toMatchObject({ kind: "object", damage: 0 });
    expect(stats.altitude[0]).toBeGreaterThanOrEqual(15);
  });
});
