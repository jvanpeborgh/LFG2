// Live eval of how Claude reads requests: each has the kind it should be read as; every reading is
// also built (creature → spec and checks, happening → rules) to catch readings the game can't make.
// Writes test-results/interpret/eval.md.   ANTHROPIC_API_KEY=… npx tsx scripts/interpret-eval.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { DEFAULT_STANDARDS as std, checkSummon, fitSpecToRules, generateModel, happeningFromReading, specFromReading, summonTier, vehicleFromReading, type IntentKind } from "@lfg/shared";
import { ClaudeInterpreter } from "../packages/server/src/interpreter";

const CASES: [string, IntentKind][] = [
  ["a sleepy dragon I can ride", "creature"], ["a fast horse", "creature"], ["three angry wolves", "creature"],
  ["a teapot that walks around on little legs", "creature"], ["a mimic chest that bites", "creature"], ["the ghost of a pirate captain", "creature"],
  ["a cute axolotl", "creature"], ["a giant mechanical spider made of brass", "creature"], ["a flock of glowing butterflies", "creature"],
  ["a red sports car", "vehicle"], ["a monster truck with huge wheels", "vehicle"], ["something to drive around in", "vehicle"],
  ["a mario kart course, 5 laps", "race"], ["a race with dune buggies around the lake", "race"],
  ["hunt down a frost wyrm", "hunt"], ["I want to track and kill the great boar of the forest", "hunt"],
  ["moon gravity for ten minutes", "happening"], ["make everyone tiny and fast", "happening"], ["the floor is lava", "happening"],
  ["nobody can get hurt for a while", "happening"], ["make the ground super slippery", "happening"],
  ["a blood moon week", "arc"], ["shooting stars every night for three nights", "arc"],
  ["pirates attack the coast in three waves", "scenario"], ["an army of skeletons invades with a lich boss", "scenario"],
  ["a little fishing village by the water", "build"], ["a castle on the hill", "build"],
  ["make me a wizard", "power"], ["let me fly", "power"], ["give me the ability to breathe underwater", "power"],
  ["sing me a song", "unclear"], ["asdfgh", "unclear"],
];

const it = ClaudeInterpreter.fromEnv(process.env);
if (!it) { console.error("needs ANTHROPIC_API_KEY"); process.exit(1); }
const rows: string[] = [];
let right = 0, built = 0, total = 0;
const ms: number[] = [];
for (const [text, want] of CASES) {
  const t0 = Date.now();
  const r = await it.read(text);
  ms.push(Date.now() - t0);
  total++;
  if (!r) { rows.push(`| ${text} | ${want} | (no reading) | ✗ | |`); continue; }
  if (r.kind === want) right++;
  let ok = "", what = r.title;
  try {
    if (r.kind === "creature" && r.creature) {
      const s = specFromReading(text, r.creature, std, r.count);
      if (!s.spec) ok = `✗ ${s.notes[0]}`;
      else {
        const tier = summonTier(s.spec).tier, spec = fitSpecToRules(s.spec, std, tier).spec;
        const report = checkSummon(spec, generateModel(spec, std), std, tier);
        ok = report.errors.length ? `✗ ${report.errors[0]}` : "✓";
        what = `${spec.name}: ${r.creature.skill}/${r.creature.template ?? "-"}, ${spec.temperament}, ${spec.movement}, ${spec.length} long, ×${spec.count}${r.creature.ride ? ", ride" : ""} [${r.creature.features.join(", ")}]`;
      }
    } else if (r.kind === "vehicle" && r.vehicle) { const v = vehicleFromReading(text, r.vehicle, std); ok = "✓"; what = `${v.name} (${v.vehicle})`; }
    else if (r.kind === "happening" && r.happening) { const h = happeningFromReading(r.happening); ok = h.def.rules.length || h.def.effect ? "✓" : "✗ changes nothing"; what = `${h.def.title}: ${h.def.rules.map(([p, v]) => `${p.split(".").pop()} ${v}`).join(", ")}${h.def.effect ? ` +${h.def.effect}` : ""} (${h.minutes} min)${h.notes.length ? ` — ${h.notes.join("; ")}` : ""}`; }
    else if (r.kind === "race" && r.race) { ok = "✓"; what = `${r.race.title}: ${r.race.laps} laps in ${r.race.vehicle}s`; }
    else if (r.kind === "hunt" && r.hunt) { const s = specFromReading(text, r.hunt.quarry, std); ok = s.spec ? "✓" : `✗ ${s.notes[0]}`; what = `${r.hunt.quarry.name}, ${r.hunt.minutes} min`; }
    else if (r.kind === "arc" && r.arc) { ok = "✓"; what = `${r.arc.arc}, ${r.arc.days} days`; }
    else if (["scenario", "build", "power"].includes(r.kind)) { ok = r.request ? "✓" : "✗ no request"; what = r.request ?? ""; }
    else if (r.kind === "unclear") { ok = "✓"; what = r.reply; }
  } catch (e) { ok = `✗ crashed: ${e instanceof Error ? e.message : e}`; }
  if (ok.startsWith("✓")) built++;
  rows.push(`| ${text} | ${want} | ${r.kind === want ? r.kind : `**${r.kind}**`} | ${ok} | ${what.replace(/\|/g, "/")} |`);
  console.log(`${r.kind === want ? "ok " : "MISS"} ${ok.startsWith("✓") ? "built" : "BROKEN"} ${text} → ${r.kind}: ${what}  (${ms.at(-1)} ms)`);
}
ms.sort((a, b) => a - b);
const head = `# How Claude reads requests\n\nKind right ${right}/${total} · buildable ${built}/${total} · median ${ms[Math.floor(ms.length / 2)]} ms, slowest ${ms.at(-1)} ms\n\n| request | expected | read as | builds | what |\n| --- | --- | --- | --- | --- |`;
mkdirSync("test-results/interpret", { recursive: true });
writeFileSync("test-results/interpret/eval.md", [head, ...rows].join("\n") + "\n");
console.log(head.split("\n")[2]);
