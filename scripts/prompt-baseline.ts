// The prompt sweep baseline: run every unseen prompt (shared summons/sweep.ts) the way the game
// and the designer take it, and write the results: test-results/sweep/baseline.md (a table) and,
// with UPDATE=1, docs/prompt-baseline.json (what the test holds the line at).
//   npx tsx scripts/prompt-baseline.ts            (UPDATE=1 to save a new baseline)
import { mkdirSync, writeFileSync } from "node:fs";
import { BlockTable, DEFAULT_STANDARDS as std, UNSEEN_PROMPTS, VANILLA_CONTENT, buildRegistry, summarizeSweep, sweepPrompt, sweepWorld } from "@lfg/shared";

const reg = buildRegistry([VANILLA_CONTENT.id], std);
const table = new BlockTable(reg);
const world = sweepWorld(table, { stone: reg.blockId("stone"), grass: reg.blockId("grass"), water: reg.blockId("water") });
const rows = UNSEEN_PROMPTS.map((p) => sweepPrompt(p, std, world, table));
const s = summarizeSweep(rows);
mkdirSync("test-results/sweep", { recursive: true });
const md = [
  `# Prompt sweep: ${s.prompts} unseen prompts`, "",
  `Planned ${Math.round(s.planned * 100)}% · passed every check ${Math.round(s.passed * 100)}% · playtest passed ${Math.round(s.playtested * 100)}% · designer score ${s.score}`, "",
  "| prompt | became | skill / mood | score | checks | notes |", "| --- | --- | --- | --- | --- | --- |",
  ...rows.map((r) => `| ${r.prompt} | ${r.kind === "none" ? "—" : `${r.name} (${r.kind})`} | ${r.skill ? `${r.skill} / ${r.mood}` : ""} | ${r.score ?? ""} | ${r.ok ? "✓" : "✗"} | ${[...r.errors, ...r.warnings.slice(0, 1)].join("; ").replace(/\|/g, "/").slice(0, 140)} |`),
].join("\n");
writeFileSync("test-results/sweep/baseline.md", md);
console.log(md.split("\n").slice(0, 3).join("\n"));
for (const [p, why] of s.failures) console.log(`  ✗ ${p}: ${why}`);
console.log(`  slowest: ${rows.sort((a, b) => b.ms - a.ms).slice(0, 3).map((r) => `${r.prompt} ${r.ms} ms`).join(", ")}`);
if (process.env.UPDATE) {
  writeFileSync("docs/prompt-baseline.json", JSON.stringify({ updated: new Date().toISOString().slice(0, 10), ...s }, null, 2) + "\n");
  console.log("saved docs/prompt-baseline.json");
}
