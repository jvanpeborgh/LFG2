import type { Standards } from "./standards";

/**
 * Powers: summons that change the summoner ("the power of a wizard", wings,
 * swiftness) as timed buffs (docs/standards/progression-and-power.md §6).
 * They follow the balance rules: at most 20% faster than normal, spells with
 * cooldowns, crowd control ≤ 1.5 s, and everyone can see a buffed player.
 */

export type Effect = "speed" | "flight" | "night_vision" | "water_breathing" | "giant";
export type SpellId = "fire_bolt" | "blink" | "frost_nova";

export interface SpellDef {
  id: SpellId;
  name: string;
  /** Key to cast it. */
  key: "R" | "F" | "G";
  cooldown: number;
  damage: number;
  /** Reach (fire bolt, blink) or radius (frost nova), in blocks. */
  range: number;
  /** Crowd control seconds (frost nova). */
  stun?: number;
}

export const SPELLS: Record<SpellId, SpellDef> = {
  // 12 damage a second at best: about a sword's damage, from range, so it can't out-damage melee by much.
  fire_bolt: { id: "fire_bolt", name: "Fire bolt", key: "R", cooldown: 1, damage: 12, range: 24 },
  blink: { id: "blink", name: "Blink", key: "F", cooldown: 6, damage: 0, range: 8 },
  frost_nova: { id: "frost_nova", name: "Frost nova", key: "G", cooldown: 10, damage: 6, range: 5, stun: 1.5 },
};

export interface PowerSpec {
  id: string;
  name: string;
  tier: number;
  effects: Effect[];
  spells: SpellId[];
  minutes: number;
  /** Tier 5 forms: once per real day. */
  oncePerDay: boolean;
}

/** Walking/sprinting speed bonus from the speed effect (the power-creep limit: +20%). */
export const SPEED_BONUS = 0.2;

interface PowerDef { words: RegExp; name: string; tier: number; effects: Effect[]; spells: SpellId[] }

const POWERS: PowerDef[] = [
  { words: /\b(avatar|archmage|storm giant|demigod|titan)\b/, name: "Avatar", tier: 5, effects: ["giant", "flight", "speed", "night_vision", "water_breathing"], spells: ["fire_bolt", "blink", "frost_nova"] },
  { words: /\b(wizard|mage|sorcer(er|ess|y)|warlock|witch|spell ?book|magic powers?)\b/, name: "Wizard", tier: 4, effects: ["night_vision"], spells: ["fire_bolt", "blink", "frost_nova"] },
  { words: /\b(wings|flight|fly|flying|levitat\w*|soar\w*)\b/, name: "Wings", tier: 3, effects: ["flight"], spells: [] },
  { words: /\b(fire ?bolts?|fireballs?|fire magic|pyro\w*)\b/, name: "Fire Bolt", tier: 3, effects: [], spells: ["fire_bolt"] },
  { words: /\b(teleport\w*|blink)\b/, name: "Blink", tier: 3, effects: [], spells: ["blink"] },
  { words: /\b(speed|swift\w*|haste|fast|quick\w*)\b/, name: "Swiftness", tier: 2, effects: ["speed"], spells: [] },
  { words: /\b(night ?vision|see in the dark|dark ?vision|owl eyes|cat eyes)\b/, name: "Night Vision", tier: 2, effects: ["night_vision"], spells: [] },
  { words: /\b(breathe underwater|water ?breathing|gills|underwater breathing|mermaid|merman)\b/, name: "Water Breathing", tier: 2, effects: ["water_breathing"], spells: [] },
];

/** Does this ask for a power on yourself rather than a thing in the world? */
export function looksLikePower(text: string): boolean {
  const t = text.toLowerCase();
  if (/\b(power|powers|ability|abilities|become|turn me into|make me|give me|grant me|let me|bless me|i want to)\b/.test(t)) return POWERS.some((p) => p.words.test(t));
  // Bare effect requests ("wings", "night vision") are powers; creature words ("a flying shark") aren't.
  return /^(the )?(gift of |power of )?(wings|flight|night vision|water breathing|swiftness|haste|blink|teleportation)$/.test(t.trim());
}

export function planPower(text: string, std: Standards): PowerSpec | null {
  const t = text.toLowerCase();
  const def = POWERS.find((p) => p.words.test(t));
  if (!def) return null;
  const minutes = std.progression.buffMinutesByTier[def.tier - 1] || 3;
  return {
    id: def.name.toLowerCase().replace(/\s+/g, "_"), name: def.name, tier: def.tier, effects: [...def.effects], spells: [...def.spells],
    minutes, oncePerDay: def.tier >= 5,
  };
}

/** The strongest power a tier allows instead (e.g. a level 4 asking to be a wizard gets swiftness). */
export function scalePowerToTier(p: PowerSpec, tier: number, std: Standards): PowerSpec | null {
  if (p.tier <= tier) return p;
  // Keep what you can of it: the spells/effects of the biggest lesser power that shares something.
  const lesser = POWERS.filter((d) => d.tier <= tier && (d.effects.some((e) => p.effects.includes(e)) || d.spells.some((s) => p.spells.includes(s))))
    .sort((a, b) => b.tier - a.tier)[0] ?? POWERS.filter((d) => d.tier <= tier).sort((a, b) => b.tier - a.tier)[0];
  return lesser ? planPower(lesser.name, std) : null;
}
