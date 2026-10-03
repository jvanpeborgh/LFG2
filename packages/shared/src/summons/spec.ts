import { hashString } from "../random";
import type { ShapeSpec } from "./shape";
import { styleFromWords, type ModelStyle } from "./mesh";

/**
 * A summon spec: everything needed to build a creature or object and its
 * default behaviour. Agents produce specs (or edit them); the generator and
 * the rules turn a spec into a model and a behaviour. Small and data-only,
 * so it can be sent to every client, which builds the same model locally.
 */
export type BodyPlan = "cloud" | "fish" | "bird" | "quadruped" | "blob" | "biped" | "ship";
export type Movement = "drift" | "fly" | "swim" | "walk" | "hover" | "sail";
export type Temperament = "passive" | "neutral" | "hostile";

export interface SummonSpec {
  /** Stable id, e.g. "flying_shark". */
  id: string;
  /** Display name, e.g. "Flying Shark". */
  name: string;
  /** What was asked for. */
  prompt: string;
  body: BodyPlan;
  /** Longest dimension in blocks. */
  length: number;
  /** Palette keys from the world standards (e.g. "neutral5", "blue2"). */
  colors: { main: string; belly: string; accent: string };
  /** Shape details: "teeth", "dorsal", "storm", "fluffy", "horns", "spots", "stripes", "tentacles"... */
  features: string[];
  movement: Movement;
  temperament: Temperament;
  /** Extra behaviours: "rain", "bite", "slam" (area attack, bosses). */
  abilities: string[];
  count: number;
  seed: number;
  /** Bosses follow the boss rules (longer warnings, area attacks, health scaled to the players there). */
  role?: "boss";
  /** A model written as primitives (by an agent or a person), used instead of the body plan's generator. */
  shape?: ShapeSpec;
  /** How it's drawn, if the prompt chose ("a low-poly fox"); otherwise the world's art.modelStyle. Everyone sees the same. */
  style?: ModelStyle;
}

interface Noun {
  words: string[];
  body: BodyPlan;
  length: number;
  movement: Movement;
  temperament: Temperament;
  colors: SummonSpec["colors"];
  features: string[];
  abilities?: string[];
}

/** What the planner knows. An agent replaces this table with judgement. */
const NOUNS: Noun[] = [
  { words: ["cloud", "clouds"], body: "cloud", length: 7, movement: "drift", temperament: "passive", colors: { main: "neutral8", belly: "neutral7", accent: "neutral6" }, features: ["fluffy"] },
  { words: ["shark", "sharks"], body: "fish", length: 3, movement: "swim", temperament: "hostile", colors: { main: "blue2", belly: "neutral8", accent: "neutral1" }, features: ["dorsal", "teeth", "gills"], abilities: ["bite"] },
  { words: ["whale", "whales"], body: "fish", length: 9, movement: "swim", temperament: "passive", colors: { main: "blue1", belly: "neutral7", accent: "neutral2" }, features: ["grooves"] },
  { words: ["dolphin", "dolphins"], body: "fish", length: 2, movement: "swim", temperament: "passive", colors: { main: "neutral5", belly: "neutral7", accent: "neutral1" }, features: ["dorsal"] },
  { words: ["fish", "goldfish", "koi"], body: "fish", length: 0.8, movement: "swim", temperament: "passive", colors: { main: "orange3", belly: "yellow5", accent: "neutral1" }, features: [] },
  { words: ["bird", "birds", "sparrow", "crow", "parrot", "seagull", "gull"], body: "bird", length: 0.7, movement: "fly", temperament: "passive", colors: { main: "orange2", belly: "orange5", accent: "yellow3" }, features: [] },
  { words: ["eagle", "hawk", "owl"], body: "bird", length: 1.4, movement: "fly", temperament: "neutral", colors: { main: "orange1", belly: "neutral8", accent: "yellow3" }, features: [] },
  { words: ["dragon", "dragons"], body: "bird", length: 5, movement: "fly", temperament: "hostile", colors: { main: "green2", belly: "yellow4", accent: "neutral1" }, features: ["horns", "spines", "teeth"], abilities: ["bite"] },
  { words: ["pig", "pigs", "piglet"], body: "quadruped", length: 1, movement: "walk", temperament: "passive", colors: { main: "pink4", belly: "pink5", accent: "pink2" }, features: ["snout"] },
  { words: ["cow", "cows", "bull"], body: "quadruped", length: 1.5, movement: "walk", temperament: "passive", colors: { main: "orange1", belly: "neutral8", accent: "neutral7" }, features: ["spots", "horns"] },
  { words: ["fox", "foxes"], body: "quadruped", length: 0.9, movement: "walk", temperament: "passive", colors: { main: "orange3", belly: "neutral8", accent: "neutral1" }, features: ["ears"] },
  { words: ["rabbit", "rabbits", "bunny", "bunnies", "hare"], body: "quadruped", length: 0.5, movement: "walk", temperament: "passive", colors: { main: "neutral7", belly: "neutral8", accent: "pink4" }, features: ["ears"] },
  { words: ["deer", "stag", "fawn", "elk"], body: "quadruped", length: 1.6, movement: "walk", temperament: "passive", colors: { main: "orange2", belly: "neutral7", accent: "orange1" }, features: ["horns"] },
  { words: ["dog", "dogs", "puppy", "wolf", "wolves"], body: "quadruped", length: 1.2, movement: "walk", temperament: "neutral", colors: { main: "neutral6", belly: "neutral8", accent: "neutral2" }, features: ["ears"], abilities: ["bite"] },
  { words: ["cat", "cats", "kitten"], body: "quadruped", length: 0.8, movement: "walk", temperament: "passive", colors: { main: "orange3", belly: "neutral8", accent: "orange1" }, features: ["ears", "stripes"] },
  { words: ["bear", "bears"], body: "quadruped", length: 2, movement: "walk", temperament: "neutral", colors: { main: "orange1", belly: "orange2", accent: "neutral1" }, features: ["ears"], abilities: ["bite"] },
  { words: ["horse", "horses", "pony", "unicorn"], body: "quadruped", length: 2, movement: "walk", temperament: "passive", colors: { main: "orange2", belly: "orange3", accent: "neutral2" }, features: ["mane"] },
  { words: ["pirate", "pirates", "raider", "raiders", "bandit", "bandits"], body: "biped", length: 1.9, movement: "walk", temperament: "hostile", colors: { main: "red3", belly: "orange1", accent: "neutral2" }, features: ["bandana", "sword"], abilities: ["bite"] },
  { words: ["viking", "vikings"], body: "biped", length: 1.9, movement: "walk", temperament: "hostile", colors: { main: "blue2", belly: "orange2", accent: "neutral6" }, features: ["helmet", "beard", "sword"], abilities: ["bite"] },
  { words: ["skeleton", "skeletons"], body: "biped", length: 1.9, movement: "walk", temperament: "hostile", colors: { main: "neutral7", belly: "neutral6", accent: "neutral2" }, features: ["skeleton", "sword"], abilities: ["bite"] },
  { words: ["knight", "knights", "soldier", "soldiers", "guard", "guards"], body: "biped", length: 1.9, movement: "walk", temperament: "neutral", colors: { main: "neutral6", belly: "blue3", accent: "neutral3" }, features: ["helmet", "sword"], abilities: ["bite"] },
  { words: ["samurai", "samurais", "warrior", "warriors", "ronin"], body: "biped", length: 1.9, movement: "walk", temperament: "neutral", colors: { main: "red2", belly: "neutral2", accent: "yellow4" }, features: ["kabuto", "armor", "sword"], abilities: ["bite"] },
  { words: ["ninja", "ninjas", "shinobi", "assassin", "assassins"], body: "biped", length: 1.8, movement: "walk", temperament: "hostile", colors: { main: "neutral1", belly: "neutral2", accent: "red3" }, features: ["mask", "sword"], abilities: ["bite"] },
  { words: ["oni", "demon", "demons", "ogre", "ogres"], body: "biped", length: 2.4, movement: "walk", temperament: "hostile", colors: { main: "neutral2", belly: "neutral1", accent: "yellow4" }, features: ["redskin", "horns", "armor", "sword"], abilities: ["bite"] },
  { words: ["robot", "robots", "android", "androids", "cyborg", "cyborgs", "mech", "mechs", "droid", "droids"], body: "biped", length: 1.9, movement: "walk", temperament: "neutral", colors: { main: "neutral6", belly: "neutral4", accent: "teal3" }, features: ["metal", "visor"], abilities: ["bite"] },
  { words: ["villager", "villagers", "citizen", "citizens", "townsfolk", "farmer", "farmers", "merchant", "merchants"], body: "biped", length: 1.8, movement: "walk", temperament: "passive", colors: { main: "green3", belly: "orange2", accent: "orange1" }, features: ["coat"] },
  { words: ["captain", "warlord", "chief", "king"], body: "biped", length: 3, movement: "walk", temperament: "hostile", colors: { main: "red2", belly: "neutral2", accent: "yellow4" }, features: ["hat", "beard", "coat", "sword"], abilities: ["slam"] },
  { words: ["ship", "ships", "boat", "boats", "galleon", "galleons", "longship", "longships", "fleet", "armada"], body: "ship", length: 10, movement: "sail", temperament: "passive", colors: { main: "orange1", belly: "neutral8", accent: "orange3" }, features: ["sail"] },
  { words: ["slime", "slimes", "blob", "blobs"], body: "blob", length: 1, movement: "walk", temperament: "neutral", colors: { main: "green3", belly: "green4", accent: "green1" }, features: [] },
  { words: ["kraken", "krakens", "octopus", "octopuses", "squid", "squids"], body: "blob", length: 3, movement: "swim", temperament: "hostile", colors: { main: "violet2", belly: "violet4", accent: "neutral1" }, features: ["tentacles"], abilities: ["bite"] },
  { words: ["jellyfish", "jelly", "jellies"], body: "blob", length: 1.2, movement: "hover", temperament: "passive", colors: { main: "violet4", belly: "violet5", accent: "violet2" }, features: ["tentacles"] },
  { words: ["ghost", "ghosts", "spirit"], body: "blob", length: 1.4, movement: "hover", temperament: "passive", colors: { main: "neutral8", belly: "neutral7", accent: "neutral1" }, features: ["tentacles"] },
];

const SIZE_WORDS: Record<string, number> = {
  tiny: 0.4, little: 0.6, small: 0.7, baby: 0.6, mini: 0.5,
  big: 1.7, large: 1.7, huge: 2.6, giant: 3, enormous: 3.2, massive: 3.5, colossal: 4,
};

const COLOR_WORDS: Record<string, [string, string, string]> = {
  red: ["red3", "red5", "neutral1"], pink: ["pink4", "pink5", "pink2"], blue: ["blue3", "blue5", "neutral1"],
  green: ["green3", "green5", "neutral1"], yellow: ["yellow4", "yellow5", "neutral1"], orange: ["orange3", "orange5", "neutral1"],
  purple: ["violet3", "violet5", "neutral1"], violet: ["violet3", "violet5", "neutral1"], white: ["neutral8", "neutral7", "neutral2"],
  black: ["neutral2", "neutral4", "neutral7"], dark: ["neutral3", "neutral4", "neutral1"], grey: ["neutral5", "neutral7", "neutral1"],
  gray: ["neutral5", "neutral7", "neutral1"], brown: ["orange2", "orange4", "neutral1"], golden: ["yellow4", "yellow5", "orange2"],
  gold: ["yellow4", "yellow5", "orange2"], teal: ["teal3", "teal5", "neutral1"], silver: ["neutral6", "neutral8", "neutral2"],
};

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  dozen: 12, twenty: 20, hundred: 100, few: 3, couple: 2, some: 3, pair: 2, several: 4, many: 8,
};

export interface PlanResult {
  spec: SummonSpec | null;
  /** What the planner understood, or why it couldn't. */
  notes: string[];
}

/**
 * Turn a request like "a big cloud" or "two flying sharks" into a spec.
 * A stand-in for the player's agent: same output format, much less imagination.
 */
/** What the summon planner knows how to make (for guides and tools outside the game). */
export function summonCatalog(): { name: string; body: BodyPlan; movement: Movement; temperament: Temperament; length: number }[] {
  return NOUNS.map((n) => ({ name: n.words[0], body: n.body, movement: n.movement, temperament: n.temperament, length: n.length }));
}

export function planSummon(prompt: string): PlanResult {
  const notes: string[] = [];
  const text = prompt.toLowerCase().replace(/[^a-z0-9\s-]/g, " ");
  const words = text.split(/\s+/).filter(Boolean);
  // The noun that appears last is usually the thing itself ("a cloud shaped like a dragon" is a cloud, though).
  let noun: Noun | undefined;
  let best = -1;
  for (const n of NOUNS) {
    const i = Math.max(...n.words.map((w) => words.lastIndexOf(w)));
    if (i > best) { best = i; noun = n; }
  }
  const shaped = words.findIndex((w) => w === "shaped" || w === "like");
  if (shaped > 0) {
    // "<thing> shaped like <other>": the thing before "shaped/like" wins.
    const head = NOUNS.find((n) => n.words.some((w) => words.slice(0, shaped).includes(w)));
    if (head) noun = head;
  }
  noun ??= NOUNS.find((n) => n.words.some((w) => words.some((x) => x.startsWith(w))));
  if (!noun) return { spec: null, notes: [`I don't know how to make "${prompt}" yet. Try a cloud, shark, whale, bird, dragon, pig, wolf, slime, jellyfish or ghost.`] };

  let length = noun.length;
  for (const w of words) if (SIZE_WORDS[w]) length *= SIZE_WORDS[w];
  let movement = noun.movement;
  if (words.some((w) => ["flying", "winged", "sky", "air", "airborne", "soaring"].includes(w))) movement = noun.body === "cloud" ? "drift" : "fly";
  else if (words.some((w) => ["swimming", "water", "sea", "ocean"].includes(w)) && noun.body === "fish") movement = "swim";
  else if (words.some((w) => ["floating", "hovering"].includes(w))) movement = noun.body === "cloud" ? "drift" : "hover";
  let temperament = noun.temperament;
  if (words.some((w) => ["angry", "evil", "hungry", "killer", "hostile", "aggressive", "mean", "scary", "deadly"].includes(w))) temperament = "hostile";
  if (words.some((w) => ["friendly", "cute", "tame", "gentle", "peaceful", "nice", "happy", "kind"].includes(w))) temperament = "passive";
  if (words.some((w) => ["shy", "neutral", "wild"].includes(w))) temperament = "neutral";
  const colors = { ...noun.colors };
  for (const w of words) if (COLOR_WORDS[w]) { const [m, b, a] = COLOR_WORDS[w]; colors.main = m; colors.belly = b; if (noun.body !== "cloud") colors.accent = a; }
  const features = [...noun.features];
  // Things that fly but aren't built to (pigs, sharks, horses…) get wings.
  // (Fish "swim" through the air instead, with bigger fins.)
  if (movement === "fly" && noun.body !== "bird" && noun.body !== "cloud") features.push(noun.body === "fish" ? "bigFins" : "wings");
  const abilities = [...(noun.abilities ?? [])];
  if (noun.body === "cloud" && words.some((w) => ["storm", "stormy", "thunder", "rain", "rainy", "dark", "grey", "gray"].includes(w))) {
    features.push("storm");
    abilities.push("rain");
    if (!words.some((w) => COLOR_WORDS[w] && !["dark", "grey", "gray"].includes(w))) Object.assign(colors, { main: "neutral6", belly: "neutral4", accent: "neutral3" });
  }
  if (words.includes("rain") || words.includes("raining") || words.includes("rainy")) if (!abilities.includes("rain")) abilities.push("rain");
  if (temperament !== "hostile") { const i = abilities.indexOf("bite"); if (i >= 0 && temperament === "passive") abilities.splice(i, 1); }
  let count = 1;
  for (const w of words) {
    if (NUMBER_WORDS[w] && w !== "a" && w !== "an") count = NUMBER_WORDS[w];
    else if (/^\d+$/.test(w)) count = Number(w);
  }
  if (words.some((w) => ["swarm", "school", "flock", "herd", "pack", "fleet", "armada", "horde"].includes(w))) count = Math.max(count, noun.body === "ship" ? 3 : 5);
  if (noun.body === "ship" && words.some((w) => ["pirate", "pirates", "black"].includes(w))) { colors.belly = "neutral2"; features.push("jolly"); }
  const descriptors = words.filter((w) => SIZE_WORDS[w] || COLOR_WORDS[w] || ["flying", "storm", "stormy", "angry", "friendly", "cute", "giant"].includes(w));
  const nounWord = words.find((w) => noun.words.includes(w)) ?? noun.words[0];
  // Name it with the word the player used, in the singular.
  const singular = nounWord === "wolves" ? "wolf" : nounWord === "jellies" ? "jellyfish" : nounWord.endsWith("s") && !nounWord.endsWith("ss") ? nounWord.slice(0, -1) : nounWord;
  const nameWords = [...new Set([...descriptors.filter((w) => !(w === "flying" && noun.movement === "fly")), singular])];
  if (movement === "fly" && noun.movement !== "fly" && !nameWords.includes("flying")) nameWords.unshift("flying");
  const name = nameWords.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  const style = styleFromWords(prompt);
  // A styled summon is its own entity type ("a low-poly wolf" and "a wolf" can share a world).
  const id = nameWords.join("_") + (style ? `_${style}` : "");
  if (style) notes.push(`drawn ${style === "lowpoly" ? "low-poly" : style}, as asked`);
  notes.push(`${name}: ${noun.body} body, ${length.toFixed(1)} blocks long, ${movement}s, ${temperament}${abilities.length ? `, can ${abilities.join(" and ")}` : ""}`);
  return {
    spec: {
      id, name, prompt, body: noun.body, length, colors, features, movement, temperament, abilities, count, seed: hashString(id),
      ...(words.includes("boss") || noun.words[0] === "captain" ? { role: "boss" as const } : {}),
      ...(style ? { style } : {}),
    },
    notes,
  };
}
