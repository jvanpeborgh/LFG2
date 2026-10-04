import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BlockTable, DEFAULT_STANDARDS as std, UNSEEN_PROMPTS, VANILLA_CONTENT, buildRegistry, summarizeSweep, sweepPrompt, sweepWorld } from "../src";

// The prompt sweep (scripts/prompt-baseline.ts): prompts nobody tuned for must not get worse than
// the saved baseline (docs/prompt-baseline.json). Save a better one with UPDATE=1.
describe("prompt sweep", () => {
  it("holds the baseline on unseen prompts", () => {
    const base = JSON.parse(readFileSync(new URL("../../../docs/prompt-baseline.json", import.meta.url), "utf8"));
    const reg = buildRegistry([VANILLA_CONTENT.id], std);
    const table = new BlockTable(reg);
    const world = sweepWorld(table, { stone: reg.blockId("stone"), grass: reg.blockId("grass"), water: reg.blockId("water") });
    const rows = UNSEEN_PROMPTS.map((p) => sweepPrompt(p, std, world, table));
    expect(rows.filter((r) => r.errors.some((e) => e.startsWith("crashed"))).map((r) => r.prompt)).toEqual([]);
    const s = summarizeSweep(rows);
    expect(s.planned).toBeGreaterThanOrEqual(base.planned - 0.02);
    expect(s.passed).toBeGreaterThanOrEqual(base.passed - 0.02);
    expect(s.playtested).toBeGreaterThanOrEqual(base.playtested - 0.02);
    expect(s.score).toBeGreaterThanOrEqual(base.score - 2);
  }, 120_000);
});
