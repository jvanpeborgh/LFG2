/**
 * The bestiary: what things are. For each creature a player might ask for, the skill (archetype)
 * and template to start from, its colours, size, features, how it moves and how it behaves. Agents
 * can always write their own design; this makes the first try right for the common (and the
 * fantastical) things players ask for, and gives quick /summon requests a good model.
 *
 * Modifiers ("robot", "fire", "ice", "crystal", "ghostly", "zombie", "golden"…) change what any
 * creature is made of: "a robot crab" is a crab in metal with glowing eyes.
 */
import type { Movement, Temperament } from "./spec";

export type Gait = "walk" | "crawl" | "slither" | "hop" | "waddle" | "flutter" | "glide" | "float" | "stride";

export interface Creature {
  words: string[];
  name: string;
  skill: string;
  /** A template variant (templates.ts) when the skill's own template isn't the right body. */
  template?: string;
  colors: { main: string; belly: string; accent: string };
  features: string[];
  /** Typical length in blocks (a player is 1.8 tall). */
  length: number;
  movement: Movement;
  temperament: Temperament;
  abilities?: string[];
  gait: Gait;
}

const c = (words: string, name: string, skill: string, colors: [string, string, string], length: number, movement: Movement, temperament: Temperament, gait: Gait, features: string[] = [], extra: Partial<Creature> = {}): Creature => ({
  words: words.split(" "), name, skill, colors: { main: colors[0], belly: colors[1], accent: colors[2] }, features, length, movement, temperament, gait,
  ...(temperament === "hostile" ? { abilities: ["bite"] } : {}), ...extra,
});

export const BESTIARY: Creature[] = [
  // four-legged
  c("unicorn unicorns", "Unicorn", "four-legged-creature", ["neutral8", "neutral7", "pink4"], 1.8, "walk", "passive", "stride", ["horn", "mane", "hooves"], { template: "equine" }),
  c("pegasus", "Pegasus", "four-legged-creature", ["neutral8", "neutral7", "blue4"], 1.8, "fly", "passive", "stride", ["wings", "mane", "hooves"], { template: "equine" }),
  c("horse horses pony ponies", "Horse", "four-legged-creature", ["orange2", "orange4", "neutral1"], 1.8, "walk", "passive", "stride", ["mane", "hooves"], { template: "equine" }),
  c("deer stag fawn elk reindeer moose", "Deer", "four-legged-creature", ["orange2", "neutral7", "orange1"], 1.5, "walk", "passive", "stride", ["antlers", "hooves"], { template: "cervine" }),
  c("fox foxes", "Fox", "four-legged-creature", ["orange3", "neutral8", "neutral1"], 0.9, "walk", "passive", "walk", ["bushy tail", "pale tail tip"], { template: "canine" }),
  c("cat cats kitten kitty", "Cat", "four-legged-creature", ["orange3", "neutral8", "orange1"], 0.7, "walk", "passive", "walk", ["ears"], { template: "feline" }),
  c("tiger tigers", "Tiger", "four-legged-creature", ["orange3", "neutral8", "neutral1"], 2.2, "walk", "hostile", "stride", ["ears", "stripes"], { template: "feline" }),
  c("lion lions", "Lion", "four-legged-creature", ["yellow3", "yellow5", "orange1"], 2, "walk", "hostile", "stride", ["mane", "ears"], { template: "feline" }),
  c("bear bears", "Bear", "four-legged-creature", ["orange1", "orange2", "neutral1"], 2, "walk", "neutral", "walk", [], { template: "ursine" }),
  c("panda pandas", "Panda", "four-legged-creature", ["neutral8", "neutral8", "neutral1"], 1.6, "walk", "passive", "walk", ["ears", "eye patches"], { template: "ursine" }),
  c("wolf wolves", "Wolf", "four-legged-creature", ["neutral5", "neutral7", "neutral2"], 1.3, "walk", "hostile", "stride", ["ruff", "bushy tail"], { template: "canine" }),
  c("dog dogs puppy hound", "Dog", "four-legged-creature", ["orange3", "orange5", "orange1"], 1, "walk", "passive", "walk", ["ears"], { template: "canine" }),
  c("rabbit rabbits bunny bunnies hare", "Bunny", "four-legged-creature", ["neutral7", "neutral8", "pink4"], 0.5, "walk", "passive", "hop", ["long ears"], { template: "lagomorph" }),
  c("mouse mice rat rats hamster", "Mouse", "four-legged-creature", ["neutral5", "pink5", "pink4"], 0.4, "walk", "passive", "walk", ["round ears"], { template: "rodent" }),
  c("pig pigs piglet boar", "Pig", "four-legged-creature", ["pink4", "pink5", "pink2"], 1, "walk", "passive", "walk", ["snout"], { template: "porcine" }),
  c("cow cows bull ox", "Cow", "four-legged-creature", ["neutral8", "neutral7", "neutral1"], 1.8, "walk", "passive", "walk", ["horns", "spots", "hooves"], { template: "bovine" }),
  c("sheep lamb", "Sheep", "four-legged-creature", ["neutral8", "neutral8", "neutral2"], 1.1, "walk", "passive", "walk", ["wool"], { template: "cervine" }),
  c("goat goats ram", "Goat", "four-legged-creature", ["neutral7", "neutral8", "neutral3"], 1.1, "walk", "passive", "hop", ["curled horns", "hooves"], { template: "cervine" }),
  c("elephant elephants mammoth", "Elephant", "four-legged-creature", ["neutral5", "neutral6", "neutral3"], 3.2, "walk", "passive", "stride", ["trunk", "tusks", "big ears"], { template: "proboscid" }),
  c("rhino rhinoceros", "Rhino", "four-legged-creature", ["neutral5", "neutral6", "neutral3"], 2.6, "walk", "neutral", "stride", ["heavy", "nose horn"], { template: "bovine" }),
  c("giraffe giraffes", "Giraffe", "four-legged-creature", ["yellow4", "yellow5", "orange1"], 3.5, "walk", "passive", "stride", ["long neck", "spots", "ossicones"], { template: "cervine" }),
  c("dinosaur dino raptor t-rex trex", "Dinosaur", "four-legged-creature", ["green2", "green4", "neutral1"], 3, "walk", "hostile", "stride", ["spines", "teeth"], { template: "theropod" }),
  c("crocodile crocodiles alligator gator", "Crocodile", "four-legged-creature", ["green1", "yellow4", "neutral1"], 2.6, "walk", "hostile", "crawl", ["teeth"], { template: "saurian" }),
  c("lizard lizards gecko salamander iguana komodo chameleon", "Lizard", "four-legged-creature", ["green3", "yellow4", "green1"], 0.9, "walk", "passive", "crawl", [], { template: "saurian" }),
  c("frog frogs toad", "Frog", "four-legged-creature", ["green3", "yellow5", "green1"], 0.6, "walk", "passive", "hop", [], { template: "frog" }),
  c("griffin gryphon hippogriff", "Griffin", "four-legged-creature", ["yellow3", "neutral8", "orange1"], 2.2, "fly", "neutral", "stride", ["wings", "beak"], { template: "feline" }),
  c("cerberus hellhound", "Hellhound", "four-legged-creature", ["neutral1", "red2", "red4"], 1.8, "walk", "hostile", "stride", ["ears", "flames"], { template: "canine" }),
  // winged
  c("phoenix firebird", "Phoenix", "winged-creature", ["red3", "orange4", "yellow4"], 2, "fly", "passive", "glide", ["flames", "crest", "long tail"], { template: "raptor" }),
  c("eagle eagles hawk falcon", "Eagle", "winged-creature", ["orange1", "neutral8", "orange2"], 1.6, "fly", "neutral", "glide", ["white head"], { template: "raptor" }),
  c("bird birds crow raven sparrow robin pigeon dove seagull gull", "Bird", "winged-creature", ["neutral2", "neutral4", "neutral1"], 0.6, "fly", "passive", "flutter", [], { template: "songbird" }),
  c("owl owls", "Owl", "walking-bird", ["orange2", "orange5", "orange1"], 0.8, "fly", "passive", "flutter", ["ear tufts", "beak"], { template: "owl" }),
  c("parrot parrots macaw", "Parrot", "winged-creature", ["red3", "yellow4", "blue3"], 0.8, "fly", "passive", "flutter", [], { template: "longtail" }),
  c("bat bats", "Bat", "winged-creature", ["neutral2", "neutral3", "pink3"], 0.7, "fly", "neutral", "flutter", ["membrane wings", "big ears"]),
  c("bee bees bumblebee wasp hornet", "Bee", "winged-creature", ["yellow4", "yellow5", "neutral1"], 0.5, "fly", "neutral", "flutter", ["stripes", "insect wings", "antennae", "stinger"]),
  c("butterfly butterflies moth", "Butterfly", "winged-creature", ["blue4", "neutral1", "yellow4"], 0.6, "fly", "passive", "flutter", ["antennae", "patterned wings"]),
  c("dragonfly dragonflies", "Dragonfly", "winged-creature", ["teal3", "teal5", "blue2"], 0.8, "fly", "passive", "flutter", ["insect wings", "long tail"]),
  c("dragon dragons wyvern drake", "Dragon", "winged-creature", ["green2", "yellow4", "neutral1"], 4, "fly", "hostile", "glide", ["wings", "membrane wings", "horns", "spines", "teeth"], { template: "dragon" }),
  // swimmers
  c("shark sharks", "Shark", "swimmer", ["blue2", "neutral8", "neutral1"], 3, "swim", "hostile", "walk", ["dorsal", "teeth"]),
  c("whale whales orca", "Whale", "swimmer", ["blue1", "neutral7", "neutral2"], 8, "swim", "passive", "walk", ["grooves"]),
  c("dolphin dolphins", "Dolphin", "swimmer", ["neutral5", "neutral7", "neutral2"], 2, "swim", "passive", "walk", ["dorsal"]),
  c("fish koi goldfish carp salmon", "Fish", "swimmer", ["orange3", "yellow5", "neutral1"], 0.8, "swim", "passive", "walk", []),
  c("piranha piranhas", "Piranha", "swimmer", ["red3", "neutral6", "neutral1"], 0.6, "swim", "hostile", "walk", ["teeth"]),
  c("seal seals walrus otter", "Seal", "swimmer", ["neutral5", "neutral6", "neutral2"], 1.6, "swim", "passive", "walk", []),
  // crawlers
  c("spider spiders tarantula", "Spider", "crawler", ["neutral2", "neutral3", "neutral1"], 1.2, "walk", "hostile", "crawl", ["many eyes", "eight legs"]),
  c("crab crabs lobster", "Crab", "crawler", ["red3", "orange4", "red2"], 1, "walk", "neutral", "crawl", ["short legs", "pincers", "eye stalks"]),
  c("scorpion scorpions", "Scorpion", "crawler", ["orange1", "orange3", "neutral1"], 1.2, "walk", "hostile", "crawl", ["pincers", "stinger tail"]),
  c("ant ants termite", "Ant", "crawler", ["red2", "red3", "neutral1"], 0.6, "walk", "neutral", "crawl", ["antennae"]),
  c("beetle beetles ladybug ladybird", "Beetle", "crawler", ["red3", "neutral1", "neutral1"], 0.7, "walk", "passive", "crawl", ["spots", "antennae"]),
  // serpents
  c("snake snakes serpent cobra python viper", "Snake", "serpent", ["green3", "yellow4", "green1"], 2.2, "walk", "hostile", "slither", ["forked tongue"]),
  c("worm worms caterpillar centipede", "Worm", "serpent", ["pink4", "pink5", "pink2"], 1.2, "walk", "passive", "slither", []),
  c("eel eels", "Eel", "serpent", ["neutral3", "yellow4", "neutral1"], 1.6, "swim", "neutral", "slither", []),
  c("naga basilisk", "Basilisk", "serpent", ["green1", "yellow4", "red3"], 3.5, "walk", "hostile", "slither", ["crest", "teeth"]),
  // shelled
  c("turtle turtles tortoise terrapin", "Turtle", "shelled", ["green1", "yellow4", "green3"], 1.2, "walk", "passive", "walk", []),
  c("snail snails slug", "Snail", "shelled", ["orange2", "yellow5", "orange1"], 1, "walk", "passive", "slither", ["spiral shell", "eye stalks"], { template: "snail" }),
  // tentacled
  c("octopus octopuses octopi squid kraken cuttlefish", "Octopus", "tentacled", ["pink3", "pink5", "pink2"], 1.6, "swim", "neutral", "float", ["tentacles"]),
  c("jellyfish jelly jellies medusa", "Jellyfish", "tentacled", ["blue4", "blue5", "violet4"], 1.2, "hover", "passive", "float", ["glow"], { template: "jellyfish" }),
  // walking birds
  c("penguin penguins", "Penguin", "walking-bird", ["neutral1", "neutral8", "orange4"], 0.9, "walk", "passive", "waddle", []),
  c("chicken chickens hen rooster chick", "Chicken", "walking-bird", ["neutral8", "neutral8", "red3"], 0.6, "walk", "passive", "waddle", ["comb"]),
  c("duck ducks duckling goose", "Duck", "walking-bird", ["neutral8", "neutral7", "orange4"], 0.6, "walk", "passive", "waddle", ["bill"]),
  c("ostrich emu flamingo", "Flamingo", "walking-bird", ["pink4", "pink5", "neutral1"], 1.6, "walk", "passive", "stride", ["long legs", "long neck"]),
  // plant creatures
  c("mushroom mushrooms shroom toadstool fungus", "Mushroom", "plant-creature", ["red3", "neutral8", "neutral8"], 1, "walk", "passive", "waddle", [], { template: "mushroom" }),
  c("treant treants ent tree", "Treant", "plant-creature", ["orange1", "orange2", "green2"], 3, "walk", "neutral", "stride", [], { template: "treant" }),
  c("cactus", "Cactus", "plant-creature", ["green2", "green3", "pink4"], 1.4, "walk", "neutral", "hop", [], { template: "cactus" }),
  // elementals and spirits
  c("elemental elementals", "Elemental", "elemental", ["neutral4", "neutral5", "teal4"], 2.2, "hover", "neutral", "float", []),
  c("golem golems", "Golem", "humanoid", ["neutral4", "neutral3", "green1"], 2.6, "walk", "hostile", "stride", ["stone", "glowing eyes"], { template: "brute" }),
  c("ghost ghosts spirit specter spectre wisp phantom", "Ghost", "floating-spirit", ["neutral8", "neutral7", "neutral1"], 1.4, "hover", "passive", "float", []),
  c("slime slimes blob ooze", "Slime", "floating-spirit", ["green4", "green5", "green2"], 1, "walk", "passive", "hop", [], { template: "slime" }),
  // humanoids
  c("robot robots android automaton mech", "Robot", "humanoid", ["neutral6", "neutral4", "teal4"], 2, "walk", "neutral", "stride", ["metal", "visor"]),
  c("wizard wizards mage sorcerer witch", "Wizard", "humanoid", ["violet2", "violet4", "yellow4"], 1.9, "walk", "neutral", "walk", ["hat", "beard", "staff"], { template: "mage" }),
  c("goblin goblins imp gremlin", "Goblin", "humanoid", ["orange1", "neutral3", "neutral2"], 1.2, "walk", "hostile", "walk", [], { template: "goblin" }),
  c("troll trolls ogre giant", "Troll", "humanoid", ["green1", "orange1", "neutral2"], 3, "walk", "hostile", "stride", ["tusks"], { template: "brute" }),
  c("skeleton skeletons skelly lich", "Skeleton", "humanoid", ["neutral8", "neutral7", "neutral1"], 1.9, "walk", "hostile", "walk", [], { template: "skeleton" }),
  c("zombie zombies ghoul", "Zombie", "humanoid", ["blue2", "green3", "red2"], 1.9, "walk", "hostile", "walk", ["glowing eyes"], { template: "zombie" }),
  c("fairy fairies pixie sprite", "Fairy", "humanoid", ["pink4", "teal5", "yellow4"], 0.6, "fly", "passive", "flutter", ["sparkles"], { template: "fairy" }),
  c("mermaid mermaids merman merfolk siren", "Mermaid", "swimmer", ["teal3", "orange3", "violet4"], 1.8, "swim", "passive", "walk", [], { template: "mermaid" }),
  c("hedgehog hedgehogs porcupine", "Hedgehog", "four-legged-creature", ["orange3", "orange5", "neutral2"], 0.5, "walk", "passive", "walk", ["quills", "round ears"], { template: "rodent" }),
  // people: built from proportions (anatomy.ts), dressed by features
  c("person human villager farmer peasant man woman", "Villager", "humanoid", ["orange3", "orange1", "blue2"], 1.8, "walk", "passive", "walk", [], { template: "person" }),
  c("knight knights paladin", "Knight", "humanoid", ["neutral6", "yellow4", "neutral3"], 1.9, "walk", "neutral", "stride", ["armor", "helmet", "sword", "shield"], { template: "hero" }),
  c("samurai ronin shogun", "Samurai", "humanoid", ["neutral2", "yellow4", "neutral1"], 1.85, "walk", "neutral", "stride", ["samurai armor", "katana"], { template: "hero" }),
  c("ninja ninjas assassin", "Ninja", "humanoid", ["neutral1", "red2", "neutral2"], 1.8, "walk", "hostile", "walk", ["hood", "mask", "katana"], { template: "person" }),
  c("warrior warriors soldier fighter gladiator", "Warrior", "humanoid", ["red2", "orange1", "orange1"], 1.9, "walk", "neutral", "stride", ["armor", "sword", "shield"], { template: "hero" }),
  c("viking vikings barbarian berserker", "Viking", "humanoid", ["orange1", "neutral6", "neutral3"], 1.95, "walk", "hostile", "stride", ["horned helmet", "beard", "axe", "shield"], { template: "hero" }),
  c("orc orcs", "Orc", "humanoid", ["orange1", "neutral3", "neutral2"], 2.1, "walk", "hostile", "stride", ["tusks", "axe"], { template: "orc" }),
  c("elf elves ranger", "Elf", "humanoid", ["green2", "orange2", "orange1"], 1.9, "walk", "passive", "walk", ["cloak", "bow"], { template: "elf" }),
  c("archer archers hunter", "Archer", "humanoid", ["green1", "orange2", "orange1"], 1.8, "walk", "neutral", "walk", ["hood", "bow"], { template: "person" }),
  c("dwarf dwarves", "Dwarf", "humanoid", ["blue1", "yellow4", "orange1"], 1.3, "walk", "neutral", "stride", ["beard", "helmet", "axe"], { template: "dwarf" }),
  c("pirate pirates buccaneer", "Pirate", "humanoid", ["red2", "neutral8", "neutral2"], 1.8, "walk", "hostile", "walk", ["tricorn", "sword"], { template: "person" }),
  c("king kings emperor prince lord", "King", "humanoid", ["violet2", "yellow4", "neutral2"], 1.9, "walk", "passive", "stride", ["crown", "cloak"], { template: "hero" }),
  c("queen queens princess empress lady", "Queen", "humanoid", ["pink2", "yellow4", "pink3"], 1.8, "walk", "passive", "walk", ["crown", "cloak"], { template: "elf" }),
  c("snowman snowmen", "Snowman", "humanoid", ["neutral8", "neutral8", "red3"], 1.8, "walk", "passive", "hop", ["carrot nose", "top hat"], { template: "snowman" }),
];

/** Modifiers: what a creature is made of, or its element. */
export interface Modifier {
  words: string[];
  colors?: { main?: string; belly?: string; accent?: string };
  features: string[];
  /** Finish for the body, if it changes. */
  finish?: "gloss" | "metal" | "glow";
  temperament?: Temperament;
  movement?: Movement;
}

export const MODIFIERS: Modifier[] = [
  { words: ["robot", "robotic", "mechanical", "clockwork", "cyborg", "mecha", "steel", "iron"], colors: { main: "neutral6", belly: "neutral4", accent: "teal4" }, features: ["metal", "glowing eyes"], finish: "metal" },
  { words: ["fire", "flaming", "fiery", "lava", "magma", "inferno", "burning"], colors: { main: "red2", belly: "orange4", accent: "yellow4" }, features: ["flames", "glowing eyes"] },
  { words: ["ice", "icy", "frost", "frozen", "snow"], colors: { main: "blue5", belly: "neutral8", accent: "teal5" }, features: ["crystals"], finish: "gloss" },
  { words: ["crystal", "crystalline", "gem", "diamond"], colors: { main: "violet4", belly: "violet5", accent: "teal5" }, features: ["crystals"], finish: "gloss" },
  { words: ["stone", "rock", "rocky", "earth"], colors: { main: "neutral4", belly: "neutral3", accent: "green1" }, features: ["stone"] },
  { words: ["water", "ocean", "sea"], colors: { main: "blue3", belly: "teal5", accent: "blue5" }, features: ["glow"], finish: "gloss" },
  { words: ["storm", "lightning", "thunder", "electric"], colors: { main: "violet2", belly: "neutral6", accent: "yellow5" }, features: ["glowing eyes", "flames"] },
  { words: ["ghostly", "spectral", "ethereal", "phantom"], colors: { main: "neutral8", belly: "neutral7", accent: "teal5" }, features: ["glowing eyes"], finish: "glow" },
  { words: ["zombie", "undead", "rotting"], colors: { main: "green1", belly: "neutral4", accent: "red2" }, features: ["glowing eyes"], temperament: "hostile" },
  { words: ["golden", "gold"], colors: { main: "yellow4", belly: "yellow5", accent: "orange3" }, features: [], finish: "metal" },
  { words: ["shadow", "dark", "void", "abyssal"], colors: { main: "neutral1", belly: "neutral2", accent: "violet4" }, features: ["glowing eyes"] },
  { words: ["rainbow", "magical", "enchanted", "fairy"], colors: { accent: "pink4" }, features: ["sparkles", "glowing eyes"] },
];

const PHRASES = (t: string) => t.toLowerCase().match(/[a-z-]+/g) ?? [];

/** Body templates that are a people (an orc, an elf...) rather than a role (a warrior, an archer). */
const RACES = new Set(["orc", "elf", "dwarf", "goblin", "skeleton", "zombie", "brute"]);
const ROLES = new Set(["person", "hero", "mage"]);

/**
 * "An orc warrior", "an elf archer", "a skeleton knight": the people's body with the role's outfit,
 * features and colours. Returns the combined creature, or null when the request isn't one.
 */
export function raceAndRole(text: string): Creature | null {
  const words = PHRASES(text);
  const found = words.map((w) => BESTIARY.find((b) => b.words.includes(w))).filter((c): c is Creature => !!c && c.skill === "humanoid");
  const race = found.find((c) => c.template && RACES.has(c.template));
  const role = [...found].reverse().find((c) => !c.template || ROLES.has(c.template));
  if (!race || !role || race === role) return null;
  return { ...role, name: `${race.name} ${role.name}`, template: race.template, features: [...new Set([...race.features, ...role.features])], length: race.length * (role.length / 1.8), temperament: race.temperament === "hostile" ? "hostile" : role.temperament };
}

/** The creature a request is about/** The creature a request is about: the last creature word wins ("a robot crab" is a crab), and earlier ones become modifiers. */
export function lookupCreature(text: string): { creature: Creature; modifiers: Modifier[]; index: number } | null {
  const words = PHRASES(text);
  let best: { creature: Creature; index: number } | null = null;
  words.forEach((w, i) => {
    const creature = BESTIARY.find((b) => b.words.includes(w));
    if (creature && (!best || i >= best.index)) best = { creature, index: i };
  });
  if (!best) return null;
  const found = best as { creature: Creature; index: number };
  const combined = raceAndRole(text);
  if (combined) found.creature = combined;
  // Modifiers: modifier words anywhere, and creature words before the main one that are also modifiers ("robot crab").
  const modifiers = MODIFIERS.filter((m) => words.some((w, i) => m.words.includes(w) && i !== found.index));
  return { ...found, modifiers };
}
