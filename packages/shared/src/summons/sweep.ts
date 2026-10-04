import type { BlockQuery } from "../chunk";
import type { BlockTable } from "../physics";
import type { Standards } from "../standards";
import { checkDesign } from "./design";
import { generateModel } from "./generate";
import { playtestSummon } from "./playtest";
import { checkSummon, fitSpecToRules, summonStats } from "./rules";
import { critiqueDesign, interpretPrompt, planCreature } from "./skills";
import { summonTier } from "../progression";

/**
 * The prompt sweep: what happens to prompts nobody tuned for. Each goes the way the game takes
 * it — planned (planCreature: vehicles, the bestiary, the planner), fitted to the rules, built,
 * checked, and played for a while in a small world of land and sea — and the designer's way
 * (interpretPrompt → its starting design, critiqued against its brief). A baseline of the
 * results (docs/prompt-baseline.json) is kept, and a test fails if a change makes them worse.
 */
export const UNSEEN_PROMPTS: string[] = [
  // Animals, real and less common
  "a snow leopard", "a red panda", "an armadillo", "a hedgehog", "a narwhal", "a manta ray", "a pelican", "a flamingo",
  "a komodo dragon", "a platypus", "a giraffe", "a hippo", "a moose", "a hammerhead shark", "a seahorse", "a stingray",
  "a beaver", "a raccoon", "a peacock", "a vulture", "a gecko", "a chameleon", "a scorpion", "a firefly",
  // Fantasy
  "a griffin", "a hydra", "a basilisk", "a kraken", "a wyvern", "a pegasus", "a minotaur", "a cyclops",
  "a sea serpent", "a baby phoenix", "a frost giant", "a forest spirit", "a will o wisp", "a gargoyle", "a mimic chest", "a sand worm",
  // Combinations and materials
  "a crystal deer", "a lava golem", "a steampunk owl", "a cyberpunk tiger", "a mecha dinosaur", "a candy unicorn",
  "a moss covered turtle", "a storm eagle", "a two headed snake", "a flying whale", "a rainbow sheep", "a skeleton horse",
  "a pumpkin knight", "a jelly cube", "a ninja frog", "a pirate parrot", "a golden scarab", "a shadow wolf",
  "an ice spider", "a fire bat", "a clockwork beetle", "a ghost ship", "a glass butterfly", "a bone dragon",
  // Moods and sizes
  "a tiny angry bee", "a huge friendly bear", "a cute baby dragon", "a scary giant crab", "a majestic stag", "a silly goose",
  "an elegant swan", "a grumpy toad", "a heroic lion", "a sleepy sloth", "a menacing raven", "a fluffy cloud sheep",
  // To ride and to drive
  "a dragon to ride", "a saddled horse", "a giant beetle mount", "a war elephant to ride", "a red kart", "a monster truck",
  "a blue sports car", "a dune buggy", "a black motorbike", "a yellow taxi",
  // Odd ones
  "a sentient teapot", "a walking mushroom", "a cactus monster", "a living snowman", "a robot butler", "a paper dragon",
  "an octopus wizard", "a cat made of stars",
];

export interface SweepRow {
  prompt: string;
  /** What it became: a creature, a vehicle, or nothing the game could make. */
  kind: "creature" | "vehicle" | "none";
  name?: string;
  /** The design skill and mood the designer read, and its critique score (0–100). */
  skill?: string;
  mood?: string;
  score?: number;
  /** The game's checks on what /summon would make (errors fail). */
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** Whether the playtest passed (it moved, didn't get stuck, attacks fair). */
  playtest?: boolean;
  ms: number;
}

/** A little world for playtests: land to the west (x < 0), sea to the east. */
export function sweepWorld(table: BlockTable, ids: { stone: number; grass: number; water: number }): BlockQuery {
  void table;
  return {
    getBlock: (x, y) => {
      if (x < 0) return y < 59 ? ids.stone : y === 59 ? ids.grass : 0;
      return y < 44 ? ids.stone : y < 60 ? ids.water : 0;
    },
  };
}

export function sweepPrompt(prompt: string, std: Standards, world: BlockQuery, table: BlockTable): SweepRow {
  const t0 = Date.now();
  const row: SweepRow = { prompt, kind: "none", ok: false, errors: [], warnings: [], ms: 0 };
  try {
    const planned = planCreature(prompt, std).spec;
    if (!planned) { row.errors.push("nothing planned"); return row; }
    const tier = summonTier(planned).tier;
    const spec = fitSpecToRules(planned, std, tier).spec;
    row.kind = spec.vehicle ? "vehicle" : "creature";
    row.name = spec.name;
    const model = generateModel(spec, std);
    const report = checkSummon(spec, model, std, tier);
    row.errors.push(...report.errors);
    row.warnings.push(...report.warnings);
    const stats = summonStats(spec, model, std);
    const water = spec.movement === "swim" || spec.movement === "sail";
    const pt = playtestSummon(spec, stats, std, world, table, water ? [10, 55, 0] : [-10, 61, 0], 12);
    row.playtest = pt.ok;
    row.errors.push(...pt.errors.map((e) => `playtest: ${e}`));
    // The designer's way: its starting design, critiqued against its brief.
    if (!spec.vehicle) {
      const ip = interpretPrompt(prompt, std);
      if (!("error" in ip)) {
        row.skill = ip.brief.skill;
        row.mood = ip.brief.mood;
        const c = checkDesign(ip.start, std);
        if (c.ok && c.model) row.score = critiqueDesign(ip.start, c.model, ip.brief, std).score;
        else row.warnings.push(`designer start: ${c.issues.filter((i) => i.level === "error").map((i) => i.message).join("; ")}`);
      }
    }
    row.ok = row.errors.length === 0;
  } catch (e) {
    row.errors.push(`crashed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    row.ms = Date.now() - t0;
  }
  return row;
}

export interface SweepSummary {
  prompts: number;
  /** Share made into something, share that passed every check, average critique score. */
  planned: number;
  passed: number;
  playtested: number;
  score: number;
  /** The prompts that failed, and why (first error). */
  failures: [string, string][];
}

export function summarizeSweep(rows: SweepRow[]): SweepSummary {
  const n = rows.length || 1;
  const scored = rows.filter((r) => r.score !== undefined);
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return {
    prompts: rows.length,
    planned: round(rows.filter((r) => r.kind !== "none").length / n),
    passed: round(rows.filter((r) => r.ok).length / n),
    playtested: round(rows.filter((r) => r.playtest).length / n),
    score: Math.round((scored.reduce((s, r) => s + r.score!, 0) / (scored.length || 1)) * 10) / 10,
    failures: rows.filter((r) => !r.ok).map((r) => [r.prompt, r.errors[0] ?? "?"]),
  };
}
