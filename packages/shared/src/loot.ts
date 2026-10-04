import { elementOf, type Element } from "./summons/attacks";
import { isNocturnal } from "./summons/actions";
import type { SummonSpec } from "./summons/spec";

/**
 * Creature loot: gear made from what you defeat (docs/CREATURE-LOOT.md). A red dragon's scales
 * become an Emberscale Helm in its reds, with fire resistance; a shark's tooth becomes a fang
 * sword that hits harder the stronger the shark was. Each piece is a base item (helm, plate,
 * legs, boots, sword, spear, staff, charm) plus a record on the stack (`meta`): name, rarity,
 * level, colours, stats, perks and lore naming the creature, its maker and who felled it.
 */
export type GearSlot = "head" | "chest" | "legs" | "feet" | "weapon" | "charm";
export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
export type GearKind = "helm" | "plate" | "legs" | "boots" | "sword" | "spear" | "staff" | "charm";
export type GearMaterial = "scale" | "hide" | "shell" | "plume" | "bone" | "steel" | "wraith" | "gel" | "chitin";

/** What a piece of gear does beyond its stats. */
export type PerkId =
  | "fire_resist" | "frost_resist" | "poison_resist" | "shock_resist"
  | "burning" | "chilling" | "venom" | "shocking"
  | "water_breathing" | "feather_fall" | "speed" | "night_vision" | "sturdy" | "light";

export interface GearMeta {
  name: string;
  rarity: Rarity;
  level: number;
  slot: GearSlot;
  kind: GearKind;
  material: GearMaterial;
  /** The creature's colours (hex): the icon and the worn look use them. */
  colors: { main: string; accent: string };
  /** Armour: defence points. Weapons: damage. */
  defense?: number;
  damage?: number;
  perks: PerkId[];
  lore: string[];
  source: { creature: string; summoner?: string; slayer?: string; day?: number };
}

export const RARITIES: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];
export const RARITY_MULT: Record<Rarity, number> = { common: 1, uncommon: 1.15, rare: 1.3, epic: 1.5, legendary: 1.8 };
export const RARITY_COLOR: Record<Rarity, string> = { common: "#e8e8e8", uncommon: "#7be37b", rare: "#6aa8ff", epic: "#c38bff", legendary: "#ffc94a" };
export const SLOT_OF: Record<GearKind, GearSlot> = { helm: "head", plate: "chest", legs: "legs", boots: "feet", sword: "weapon", spear: "weapon", staff: "weapon", charm: "charm" };
/** Base item names, one per kind (registered by vanilla content). */
export const GEAR_ITEM: Record<GearKind, string> = { helm: "relic_helm", plate: "relic_plate", legs: "relic_legs", boots: "relic_boots", sword: "relic_sword", spear: "relic_spear", staff: "relic_staff", charm: "relic_charm" };
export const PERK_LABEL: Record<PerkId, string> = {
  fire_resist: "Fire resistance", frost_resist: "Frost resistance", poison_resist: "Poison resistance", shock_resist: "Shock resistance",
  burning: "Burning hits", chilling: "Chilling hits", venom: "Venomous hits", shocking: "Shocking hits",
  water_breathing: "Water breathing", feather_fall: "Light falls", speed: "Swiftness", night_vision: "Night eyes", sturdy: "Sturdy", light: "Glows",
};
/** Armour: the most a full set blocks of a hit. */
export const MAX_ARMOUR_BLOCK = 0.6;
const BASE_DEFENSE: Partial<Record<GearKind, number>> = { helm: 2, plate: 4, legs: 3, boots: 1.5 };

const words = (s: SummonSpec) => `${s.name} ${s.prompt} ${s.features.join(" ")}`.toLowerCase();

/** What the creature is made of, for armour. */
export function materialOf(spec: SummonSpec): GearMaterial {
  const w = words(spec);
  if (/\b(ghost|spirit|wraith|phantom|specter|spectre|wisp|ghostly|spectral)\b/.test(w)) return "wraith";
  if (/\b(skeleton|bone|bones|undead|lich)\b/.test(w)) return "bone";
  if (/\b(robot|robotic|mech|mecha|golem|knight|armor|armour|metal|steel|iron|clockwork)\b/.test(w)) return "steel";
  if (/\b(crab|turtle|tortoise|snail|lobster|shell|armadillo)\b/.test(w)) return "shell";
  if (/\b(beetle|ant|spider|scorpion|mantis|insect|bug|wasp|bee)\b/.test(w)) return "chitin";
  if (/\b(slime|blob|jelly|jellyfish|ooze)\b/.test(w) || spec.body === "blob") return "gel";
  if (spec.body === "bird" && !/\b(dragon|wyvern)\b/.test(w)) return "plume";
  if (spec.body === "fish" || /\b(dragon|wyvern|serpent|snake|lizard|scales|scaly|croc|crocodile|alligator|dinosaur|rex|raptor)\b/.test(w)) return "scale";
  return "hide";
}

const MATERIAL_WORD: Record<GearMaterial, string> = { scale: "scale", hide: "hide", shell: "shell", plume: "plume", bone: "bone", steel: "steel", wraith: "wraith", gel: "gel", chitin: "carapace" };
const ELEMENT_WORD: Partial<Record<Element, string>> = { fire: "Ember", frost: "Frost", poison: "Venom", lightning: "Storm", water: "Tide", magic: "Arcane", stone: "Stone", web: "Silk" };
const KIND_WORD: Record<GearKind, string> = { helm: "Helm", plate: "Plate", legs: "Greaves", boots: "Boots", sword: "Fang", spear: "Horn Spear", staff: "Staff", charm: "Lantern" };

/** Which pieces this creature can give. */
export function kindsFor(spec: SummonSpec): GearKind[] {
  const w = words(spec), m = materialOf(spec);
  const out: GearKind[] = [];
  if (m === "wraith" || /\b(glow|glowing|lantern|firefly|fireflies|wisp)\b/.test(w)) out.push("charm");
  if (m === "plume") out.push("plate", "boots");
  else if (m !== "wraith" && m !== "gel") out.push("helm", "plate", "legs", "boots");
  if (m === "gel") out.push("boots", "charm");
  if (/\b(teeth|fang|fangs|bite|jaws|shark|wolf|tooth|claws)\b/.test(w) || spec.abilities.includes("bite")) out.push("sword");
  if (/\b(horn|horns|tusk|tusks|antler|antlers|unicorn|narwhal)\b/.test(w) || spec.abilities.includes("charge")) out.push("spear");
  if (spec.abilities.includes("breath") || spec.abilities.includes("shot")) out.push("staff");
  return [...new Set(out)];
}

/** Does it have an element: something it breathes or shoots, or is made of (a shark's bite isn't fire)? */
export function isElemental(spec: SummonSpec): boolean {
  return spec.element !== undefined || spec.abilities.some((a) => a === "breath" || a === "shot") || /\b(fire|flaming|lava|magma|frost|ice|icy|poison|toxic|venom|storm|lightning|electric|thunder)\b/.test(words(spec));
}

/** The perks a piece of this kind from this creature carries. */
export function perksFor(spec: SummonSpec, kind: GearKind): PerkId[] {
  const slot = SLOT_OF[kind], w = words(spec), out: PerkId[] = [];
  const el: Element | null = isElemental(spec) ? elementOf(spec) : null;
  const resist: Partial<Record<Element, PerkId>> = { fire: "fire_resist", frost: "frost_resist", poison: "poison_resist", lightning: "shock_resist" };
  const hit: Partial<Record<Element, PerkId>> = { fire: "burning", frost: "chilling", poison: "venom", lightning: "shocking" };
  if (slot === "weapon" && el && hit[el]) out.push(hit[el]!);
  if ((slot === "chest" || slot === "head") && el && resist[el]) out.push(resist[el]!);
  if (slot === "head" && spec.movement === "swim") out.push("water_breathing");
  if (slot === "head" && (isNocturnal(spec) || /\b(owl|bat|cat)\b/.test(w))) out.push("night_vision");
  if ((slot === "feet" || slot === "chest") && (spec.movement === "fly" || /\bwings?\b/.test(w))) out.push("feather_fall");
  if ((slot === "legs" || slot === "feet") && (spec.gait === "hop" || /\b(fast|swift|quick|cheetah|rabbit|hare|horse|deer|fox)\b/.test(w))) out.push("speed");
  if ((slot === "chest" || slot === "legs") && spec.length >= 3) out.push("sturdy");
  if (slot === "charm") out.push("light");
  return [...new Set(out)].slice(0, 2);
}

/** Lore: where it came from, and a line of flavour from what the creature was. */
export function loreFor(spec: SummonSpec, kind: GearKind, src: GearMeta["source"]): string[] {
  const m = materialOf(spec), el = elementOf(spec), w = words(spec);
  const verb = SLOT_OF[kind] === "weapon" ? "Taken from" : kind === "charm" ? "Left by" : m === "plume" ? "Plucked from" : m === "scale" ? "Shed by" : "Made from";
  const whose = src.summoner ? `${src.summoner}'s ${spec.name}` : `a ${spec.name}`;
  const origin = `${verb} ${whose}${src.slayer ? `, felled by ${src.slayer}` : ""}${src.day !== undefined ? ` on day ${src.day}` : ""}.`;
  const flavours: [boolean, string][] = [
    [el === "fire" && /\b(fire|flame|flaming|ember|lava|magma|dragon|red)\b/.test(w), "Still warm to the touch."],
    [el === "frost" || /\b(ice|frost|snow|icy)\b/.test(w), "Frost forms on it even in summer."],
    [el === "lightning" || /\b(storm|thunder|lightning)\b/.test(w), "It hums before a storm."],
    [el === "poison" || /\b(poison|toxic|venom)\b/.test(w), "Handle with gloves."],
    [m === "wraith", "Its light flickers when no one is looking."],
    [m === "bone", "It rattles softly at night."],
    [m === "steel", "Not a scratch on it, whatever it's been through."],
    [spec.movement === "swim", "It smells of the sea."],
    [spec.movement === "fly", "Lighter than it looks."],
    [spec.role === "boss", "The kind of thing songs are written about."],
    [spec.length >= 4, "Heavy, and it means it."],
    [/\b(cute|baby|tiny|small|little)\b/.test(w), "Smaller than you'd expect, and somehow fiercer."],
  ];
  return [origin, flavours.find(([ok]) => ok)?.[1] ?? "It remembers what it was."];
}

export interface LootContext {
  /** The creature's tier (summonTier) and the player's level. */
  tier: number;
  playerLevel: number;
  summoner?: string;
  slayer?: string;
  day?: number;
  rand: () => number;
  /** The world palette: key → hex. */
  palette: Record<string, string>;
  /** One hit's cap (weapons never exceed it). */
  maxHit: number;
}

/** Roll the rarity: the level tips the odds towards better. */
export function rollRarity(level: number, rand: () => number, boss = false): Rarity {
  const r = rand() * 100 - Math.min(40, level * 1.2) - (boss ? 20 : 0);
  return r < 3 ? "legendary" : r < 12 ? "epic" : r < 32 ? "rare" : r < 62 ? "uncommon" : "common";
}

/** Make one piece of gear of a kind from a creature. */
export function makeGear(spec: SummonSpec, kind: GearKind, ctx: LootContext, rarity?: Rarity): { item: string; meta: GearMeta } {
  const level = Math.max(1, Math.round((ctx.tier * 5 + ctx.playerLevel) / 2));
  const rar = rarity ?? rollRarity(level, ctx.rand, spec.role === "boss");
  const mult = RARITY_MULT[rar];
  const slot = SLOT_OF[kind], material = materialOf(spec), el = elementOf(spec);
  const prefix = isElemental(spec) ? ELEMENT_WORD[el] : undefined;
  const name = slot === "weapon"
    ? kind === "sword" ? `${spec.name.split(" ").pop()}fang` : kind === "spear" ? `${spec.name.split(" ").pop()} Horn Spear` : `${prefix ?? "Elder"} Staff of the ${spec.name.split(" ").pop()}`
    : kind === "charm" ? `${prefix ?? "Wraith"} Lantern`
    : `${prefix ?? spec.name.split(" ").pop()}${MATERIAL_WORD[material]} ${KIND_WORD[kind]}`;
  const meta: GearMeta = {
    name: (rar === "legendary" ? `${name}, the ${["Unbroken", "Last", "First", "Wild", "Old"][Math.floor(ctx.rand() * 5)]}` : name).replace(/\b\w/g, (c) => c.toUpperCase()),
    rarity: rar, level, slot, kind, material,
    colors: { main: ctx.palette[spec.colors.main] ?? "#888888", accent: ctx.palette[spec.colors.accent] ?? ctx.palette[spec.colors.belly] ?? "#cccccc" },
    perks: perksFor(spec, kind),
    lore: loreFor(spec, kind, { creature: spec.name, summoner: ctx.summoner, slayer: ctx.slayer, day: ctx.day }),
    source: { creature: spec.name, ...(ctx.summoner ? { summoner: ctx.summoner } : {}), ...(ctx.slayer ? { slayer: ctx.slayer } : {}), ...(ctx.day !== undefined ? { day: ctx.day } : {}) },
  };
  if (BASE_DEFENSE[kind]) meta.defense = Math.round(BASE_DEFENSE[kind]! * (1 + level * 0.08) * mult * (meta.perks.includes("sturdy") ? 1.2 : 1) * 10) / 10;
  if (slot === "weapon") meta.damage = Math.min(ctx.maxHit, Math.round((14 + level * 1.2) * mult * (kind === "spear" ? 1.1 : kind === "staff" ? 0.9 : 1)));
  return { item: GEAR_ITEM[kind], meta };
}

/**
 * What a defeated creature drops: maybe nothing. Bosses always give two pieces; fighters give one
 * now and then (more often the stronger they were); passive creatures rarely a charm or boots.
 */
export function rollCreatureLoot(spec: SummonSpec, ctx: LootContext): { item: string; meta: GearMeta }[] {
  if (spec.body === "cloud" || spec.body === "ship" || spec.vehicle) return [];
  const kinds = kindsFor(spec);
  if (!kinds.length) return [];
  const boss = spec.role === "boss";
  const fights = spec.temperament !== "passive";
  const chance = boss ? 1 : fights ? Math.min(0.85, 0.3 + ctx.tier * 0.12) : 0.06;
  if (ctx.rand() >= chance) return [];
  const pool = fights ? kinds : kinds.filter((k) => k === "charm" || k === "boots");
  if (!pool.length) return [];
  const n = boss ? 2 : 1;
  const out: { item: string; meta: GearMeta }[] = [];
  const left = [...pool];
  for (let i = 0; i < n && left.length; i++) {
    const k = left.splice(Math.floor(ctx.rand() * left.length), 1)[0];
    out.push(makeGear(spec, k, ctx));
  }
  return out;
}

/** What a set of worn armour adds up to: the share of a hit it blocks, and its perks. */
export function armourTotals(worn: (GearMeta | undefined)[]): { block: number; defense: number; perks: Set<PerkId> } {
  const defense = worn.reduce((s, g) => s + (g?.defense ?? 0), 0);
  const perks = new Set<PerkId>(worn.flatMap((g) => g?.perks ?? []));
  return { defense, block: Math.min(MAX_ARMOUR_BLOCK, defense * 0.025), perks };
}
