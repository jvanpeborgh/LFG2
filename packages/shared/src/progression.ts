import type { ScenarioSpec } from "./scenarios/plan";
import type { Standards } from "./standards";
import type { SummonSpec } from "./summons/spec";

/**
 * Progression: levels, summoning tiers and what casting costs
 * (docs/standards/progression-and-power.md). Pure functions over the world
 * standards, shared by the server (which enforces them) and the client
 * (which shows them).
 */

export const TIER_NAMES = ["Minor", "Notable", "Major", "Epic", "Legendary"] as const;

/** XP needed to go from `level` to `level + 1`. */
export function xpToNext(level: number, std: Standards): number {
  const c = std.progression.xpToNext;
  if (level < 1) return c.early[0];
  if (level <= c.early.length) return c.early[level - 1];
  return Math.round(c.base * Math.pow(1 + c.growthPerLevel, level - c.early.length - 1));
}

/** Level for a total amount of XP, plus progress into it. */
export function levelFromXp(total: number, std: Standards): { level: number; into: number; next: number } {
  const max = std.locked.progression.maxLevel;
  let level = 1, left = Math.max(0, total);
  while (level < max && left >= xpToNext(level, std)) { left -= xpToNext(level, std); level++; }
  return { level, into: level >= max ? 0 : left, next: level >= max ? 0 : xpToNext(level, std) };
}

/** Total XP needed to reach a level. */
export function xpForLevel(level: number, std: Standards): number {
  let t = 0;
  for (let l = 1; l < level; l++) t += xpToNext(l, std);
  return t;
}

/** Highest tier a level can cast. */
export function tierForLevel(level: number, std: Standards): number {
  const unlock = std.locked.progression.tierUnlockLevel;
  let tier = 1;
  for (let t = 0; t < unlock.length; t++) if (level >= unlock[t]) tier = t + 1;
  return tier;
}

export function levelForTier(tier: number, std: Standards): number {
  const unlock = std.locked.progression.tierUnlockLevel;
  return unlock[Math.max(0, Math.min(unlock.length - 1, tier - 1))];
}

/** What casting at a tier costs. */
export function castCost(tier: number, std: Standards): { aether: number; shards: number } {
  const i = Math.max(0, Math.min(4, tier - 1));
  return { aether: std.progression.aether.costByTier[i], shards: std.progression.materialCostByTier[i] };
}

/**
 * Ritual: the highest participant's level plus a bonus per helper, but never
 * more than one tier above what that participant could cast alone (locked).
 */
export function ritualLevel(levels: number[], std: Standards): number {
  if (!levels.length) return 1;
  const top = Math.max(...levels);
  const helpers = levels.length - 1;
  const capTier = Math.min(std.locked.progression.tiers, tierForLevel(top, std) + std.locked.progression.ritualMaxTiersAbove);
  const capLevel = capTier >= std.locked.progression.tiers ? std.locked.progression.maxLevel : levelForTier(capTier + 1, std) - 1;
  return Math.min(capLevel, std.locked.progression.maxLevel, top + helpers * std.progression.ritual.levelsPerHelper);
}

/** Helpers needed to reach a tier in a ritual led by someone at `level` (or null if out of reach). */
export function helpersNeeded(level: number, tier: number, std: Standards): number | null {
  if (tierForLevel(level, std) >= tier) return 0;
  if (tier > tierForLevel(level, std) + std.locked.progression.ritualMaxTiersAbove) return null;
  return Math.ceil((levelForTier(tier, std) - level) / std.progression.ritual.levelsPerHelper);
}

// ------------------------------------------------------------------ power score

/**
 * The power of a summon, from what it would actually be (size, numbers,
 * danger), not what it's called. Score 0–1 → tier 1, 1–2 → tier 2, …
 */
export function summonTier(spec: SummonSpec): { tier: number; score: number; why: string[] } {
  const why: string[] = [];
  const scenery = spec.body === "cloud" || spec.body === "ship";
  let size = spec.length <= 3 ? 0 : spec.length <= 8 ? 1 : 2;
  if (scenery) size = Math.max(0, size - 1);
  if (size) why.push(`${spec.length.toFixed(0)} blocks long`);
  let danger = 0;
  const bites = spec.abilities.includes("bite") || spec.abilities.includes("slam");
  if (spec.temperament === "hostile") { danger = 1; why.push("hostile"); }
  else if (spec.temperament === "neutral" && bites) danger = 0.5;
  if (bites && spec.temperament !== "passive" && spec.length >= 3) { danger += 0.5; why.push("heavy hits"); }
  // A boss by design (a captain). Big hostiles are bosses because of their size, which already counts.
  if (spec.role === "boss" && spec.length <= 6) { danger += 1; why.push("a boss"); }
  if (spec.abilities.includes("rain")) { danger += 1; why.push("weather"); }
  const numbers = spec.count >= 4 ? 0.5 : 0;
  if (numbers) why.push(`${spec.count} of them`);
  const score = size + danger + numbers;
  return { tier: Math.max(1, Math.min(5, 1 + Math.floor(score))), score, why };
}

/** The power of a scenario: raids are major; with bosses or long ones epic; huge ones legendary. */
export function scenarioTier(spec: ScenarioSpec): { tier: number; why: string[] } {
  const bosses = spec.waves.filter((w) => w.boss).length;
  const waves = spec.waves.length;
  const why = [`${waves} waves`, ...(bosses ? [`${bosses} boss${bosses > 1 ? "es" : ""}`] : [])];
  const tier = waves >= 7 || spec.ships >= 4 && bosses >= 2 ? 5 : bosses || waves > 3 ? 4 : 3;
  return { tier, why };
}

/**
 * Bring a summon down to a tier: smaller, fewer, and at tier 1 harmless.
 * Returns null if it can't be made to fit.
 */
export function scaleSummonToTier(spec: SummonSpec, tier: number): SummonSpec | null {
  const s: SummonSpec = { ...spec, colors: { ...spec.colors }, features: [...spec.features], abilities: [...spec.abilities] };
  const young = () => {
    if (/^(Young|Little) /.test(s.name)) return;
    const base = s.name.replace(/\b(Huge|Giant|Big|Large|Enormous|Massive|Colossal)\s+/gi, "");
    s.name = `${s.body === "cloud" || s.body === "ship" ? "Little" : "Young"} ${base}`;
  };
  for (let step = 0; step < 8 && summonTier(s).tier > tier; step++) {
    if (s.role === "boss") { delete s.role; continue; }
    if (s.count >= 4) { s.count = 3; continue; }
    if (tier <= 1 && s.abilities.includes("rain")) { s.abilities = s.abilities.filter((a) => a !== "rain"); s.features = s.features.filter((f) => f !== "storm"); continue; }
    const maxLen = tier <= 1 ? (s.body === "cloud" || s.body === "ship" ? 8 : 2) : tier === 2 ? (s.body === "cloud" || s.body === "ship" ? 16 : 6) : 16;
    if (s.length > maxLen) { s.length = maxLen; young(); continue; }
    if (s.length >= 3 && s.temperament !== "passive" && tier <= 2) { s.length = 2.5; young(); continue; }
    if (tier <= 1 && s.temperament !== "passive") { s.temperament = "passive"; s.abilities = s.abilities.filter((a) => a !== "bite" && a !== "slam"); young(); continue; }
    if (tier <= 1 && s.abilities.includes("rain")) { s.abilities = s.abilities.filter((a) => a !== "rain"); continue; }
    return null;
  }
  if (summonTier(s).tier > tier) return null;
  s.id = s.name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return s;
}

/** Bring a scenario down to a tier (fewer waves, no bosses). Null below tier 3: raids need tier 3. */
export function scaleScenarioToTier(spec: ScenarioSpec, tier: number): ScenarioSpec | null {
  if (scenarioTier(spec).tier <= tier) return spec;
  if (tier < 3) return null;
  const waves = spec.waves.slice(0, tier === 3 ? 3 : 6).map((w) => ({ groups: w.groups }));
  return { ...spec, ships: Math.min(spec.ships, 3), waves, title: `Small ${spec.title}`, reward: spec.reward.filter(([n]) => n !== "diamond_sword") };
}
