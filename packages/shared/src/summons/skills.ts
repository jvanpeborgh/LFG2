/**
 * Design skills: the game's best practice for making creatures, written once and used by every
 * agent (and every player's own chat, through MCP).
 *
 *   interpretPrompt   a request in words → a brief: which skill (archetype), the mood, the style,
 *                     size, colours, what must read from 20 m, proportions to aim for, and a
 *                     starting design from the skill's template
 *   critiqueDesign    a built design against its brief: required parts, proportions for the mood,
 *                     eyes, wingspan, feet on the ground, colour and form language. Each finding
 *                     has a path and a hint, like the rule checks, plus a score
 *   skillMarkdown     a skill as a SKILL.md document (frontmatter + guidance), for chat apps that
 *                     load skills
 *
 * Skills are data: adding an archetype is adding an entry, and its checks run for everyone.
 */
import type { Standards } from "../standards";
import { parseHex } from "../texture";
import type { DesignInput } from "./design";
import { styleFromWords, type ModelStyle } from "./mesh";
import { EXAMPLE_SHAPE, expandShape, shapeBounds, type AnimRole, type ShapeIssue, type ShapeSpec } from "./shape";
import { COLOR_WORDS, SIZE_WORDS, planSummon, type BodyPlan, type Movement, type SummonSpec, type Surface, type Temperament } from "./spec";
import { lookupCreature, type Gait } from "./bestiary";
import { TEMPLATES } from "./templates";
import { applyFeatureKit, featherWing } from "./features";
import { BIRDS, BUILDS, PEOPLE } from "./anatomy";
import type { VoxelModel, VoxelPart } from "./voxel";

export type Mood = "cute" | "menacing" | "heroic" | "elegant" | "comic" | "neutral";
export const MOODS: Mood[] = ["cute", "menacing", "heroic", "elegant", "comic", "neutral"];

const MOOD_WORDS: [Mood, RegExp][] = [
  ["cute", /\b(cute|adorable|baby|chibi|kawaii|fluffy|cuddly|tiny|little|sweet|friendly)\b/],
  ["menacing", /\b(scary|menacing|evil|angry|fierce|terrifying|dark|vicious|demonic|monstrous|feral|dread)\b/],
  ["heroic", /\b(noble|heroic|majestic|mighty|ancient|royal|legendary|brave|guardian)\b/],
  ["elegant", /\b(elegant|graceful|delicate|ethereal|slender|regal|serene)\b/],
  ["comic", /\b(silly|funny|goofy|derpy|clumsy|wobbly)\b/],
];

/** Proportion targets per mood. headRatio: head height ÷ total height (upright) or head length ÷ body length. */
const MOOD_TARGETS: Record<Mood, { headRatio?: [number, number]; rounded?: number; spikes?: [number, number]; mainLight?: [number, number]; guidance: string[] }> = {
  cute: {
    headRatio: [0.38, 0.75], rounded: 0.65, spikes: [0, 3],
    guidance: ["Big head (about half the height for upright creatures), big eyes low on the face, short limbs.", "Round forms (ellipsoids, capsules), soft blends, no sharp spikes.", "Light, warm or pastel colours; a pale belly."],
  },
  menacing: {
    headRatio: [0.1, 0.32], spikes: [2, 99], mainLight: [0, 0.45],
    guidance: ["Small head low and forward, heavy shoulders, long claws or horns.", "Sharp forms: cones and wedges for horns, spines and claws (at least two).", "Dark main colour; eyes small, or glowing (finish: glow)."],
  },
  heroic: {
    headRatio: [0.12, 0.3],
    guidance: ["Broad chest and shoulders, upright posture, a small head.", "Clean, strong shapes; one bold accent colour; metal or gloss on armour and trim."],
  },
  elegant: {
    headRatio: [0.1, 0.3], rounded: 0.5,
    guidance: ["Long and slender: long neck, tail or wings; thin limbs.", "Few, flowing forms with soft blends; gloss finishes; a restrained palette."],
  },
  comic: {
    headRatio: [0.3, 0.8], rounded: 0.5,
    guidance: ["Exaggerate one feature (a huge nose, tiny wings on a big body).", "Bright colours; big eyes that don't match (one bigger)."],
  },
  neutral: { guidance: ["Readable first: a clear silhouette, a contrasting belly or face, eyes."] },
};

export interface SkillPart {
  role: AnimRole;
  why: string;
  required: boolean;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  /** Body plans and words this skill is for. */
  bodies: BodyPlan[];
  words: RegExp;
  movement: Movement;
  /** Parts (by animation role) and why. */
  parts: SkillPart[];
  upright: boolean;
  guidance: string[];
  /** Notes per model style. */
  styles: Partial<Record<ModelStyle, string>>;
  template: ShapeSpec;
  /** Wingspan ÷ body length, for flyers. */
  minWingspan?: number;
}

const v = (x: number, y: number, z: number): [number, number, number] => [x, y, z];

export const SKILLS: Skill[] = [
  {
    id: "four-legged-creature", name: "Four-legged creature",
    description: "Animals and beasts that walk on four legs: dogs, cats, wolves, bears, lions, dragons on the ground, boars, foxes.",
    bodies: ["quadruped"], words: /\b(dog|cat|wolf|fox|bear|lion|tiger|boar|pig|cow|horse|deer|goat|sheep|lizard|beast|hound|panther|rabbit|bunny)\b/, movement: "walk", upright: false,
    parts: [
      { role: "body", why: "the torso: everything else hangs off it", required: true },
      { role: "head", why: "turns to look; its size sets the mood", required: true },
      { role: "legL", why: "front and back legs walk in a diagonal gait (mirror each to get the other side)", required: true },
      { role: "legR", why: "the other diagonal", required: true },
      { role: "tail", why: "sways; a strong silhouette cue", required: false },
    ],
    guidance: [
      "Body is a horizontal ellipsoid or capsule; legs are capsules under its four corners, slightly inside the body's width.",
      "Head at the front (+z), a little above the back; a snout or muzzle in a lighter colour makes the face read.",
      "Legs reach the ground; paws or hooves in a darker accent.",
      "Ears, horns or a mane change the species more than the body does.",
    ],
    styles: { voxel: "Keep legs at least 2 voxels thick.", lowpoly: "Fewer, larger primitives; let the facets show the forms.", sculpted: "Use blend 0.05–0.1 for a soft neck; keep a hard join (blend 0) at paws." },
    template: {
      parts: [
        { name: "body", anim: "body", shapes: [
          { type: "ellipsoid", at: v(0, 1.0, 0), size: v(0.9, 0.8, 1.6), color: "main" },
          { type: "ellipsoid", at: v(0, 0.86, 0.05), size: v(0.7, 0.5, 1.3), color: "belly" },
          { type: "tube", at: v(0, 1.2, 0.75), size: v(0.4, 0.4, 0.4), points: [v(0, 1.1, 0.55), v(0, 1.3, 0.8)], radius: [0.26, 0.2], color: "main" },
        ] },
        { name: "head", anim: "head", pivot: v(0, 1.25, 0.65), shapes: [
          { type: "ellipsoid", at: v(0, 1.45, 0.95), size: v(0.7, 0.65, 0.7), color: "main" },
          { type: "ellipsoid", at: v(0, 1.32, 1.28), size: v(0.4, 0.3, 0.35), color: "belly" },
          { type: "ellipsoid", at: v(0, 1.38, 1.46), size: v(0.12, 0.09, 0.06), color: "neutral1" },
          { type: "ellipsoid", at: v(0.2, 1.56, 1.23), size: v(0.16, 0.18, 0.1), color: "neutral8", mirror: true },
          { type: "ellipsoid", at: v(0.21, 1.56, 1.28), size: v(0.09, 0.11, 0.05), color: "neutral1", mirror: true },
          { type: "cone", at: v(0.22, 1.83, 0.92), size: v(0.18, 0.3, 0.12), rotate: v(0, 0, -15), color: "accent", mirror: true },
        ] },
        { name: "front leg", anim: "legL", mirror: true, pivot: v(0.27, 0.85, 0.5), shapes: [
          { type: "ellipsoid", at: v(0.27, 0.72, 0.5), size: v(0.3, 0.42, 0.34), color: "main" },
          { type: "capsule", at: v(0.27, 0.36, 0.52), size: v(0.2, 0.7, 0.2), taper: 0.75, color: "main" },
          { type: "ellipsoid", at: v(0.27, 0.06, 0.58), size: v(0.24, 0.12, 0.3), color: "accent" },
        ] },
        { name: "back leg", anim: "legR", mirror: true, pivot: v(0.27, 0.85, -0.5), shapes: [
          { type: "ellipsoid", at: v(0.27, 0.72, -0.5), size: v(0.34, 0.5, 0.42), color: "main" },
          { type: "capsule", at: v(0.27, 0.36, -0.46), size: v(0.2, 0.7, 0.2), taper: 0.75, color: "main" },
          { type: "ellipsoid", at: v(0.27, 0.06, -0.4), size: v(0.24, 0.12, 0.3), color: "accent" },
        ] },
        { name: "tail", anim: "tail", pivot: v(0, 1.1, -0.75), shapes: [
          { type: "tube", at: v(0, 1.3, -1.0), size: v(0.2, 0.5, 0.5), points: [v(0, 1.1, -0.72), v(0, 1.3, -1.0), v(0, 1.5, -1.15)], radius: [0.1, 0.05], color: "accent" },
        ] },
      ],
    },
  },
  {
    id: "humanoid", name: "Humanoid",
    description: "Anything that stands on two legs with two arms: knights, samurai, villagers, goblins, robots, golems, skeletons, bosses.",
    bodies: ["biped"], words: /\b(knight|samurai|ninja|villager|goblin|orc|troll|robot|cyborg|golem|skeleton|zombie|wizard|warrior|king|queen|pirate|viking|giant|man|woman|person|elf|dwarf)\b/, movement: "walk", upright: true,
    parts: [
      { role: "body", why: "torso and hips", required: true },
      { role: "head", why: "looks around; head-to-height ratio sets the mood (heroic ~1/7, cute ~1/2)", required: true },
      { role: "armL", why: "arms swing and strike (the right arm raises a weapon while winding up an attack)", required: true },
      { role: "legL", why: "legs walk (mirror one to get both)", required: true },
    ],
    guidance: [
      "Stack: legs (about 45% of the height), torso, head. Shoulders wider than hips reads as strong.",
      "Arms hang from the top corners of the torso; hands slightly lighter or a contrasting glove colour.",
      "A face needs only eyes (and maybe a mouth or visor) on the front of the head.",
      "Silhouette props sell the role: a hat, horns, a sword, a cape (wedge), a backpack.",
    ],
    styles: { voxel: "Heads at least 6 voxels across so a face fits.", sculpted: "Blend the neck and shoulders (0.05); keep belt and armour edges hard (blend 0) and use metal for armour." },
    template: {
      parts: [
        { name: "body", anim: "body", shapes: [
          { type: "capsule", at: v(0, 1.15, 0), size: v(0.7, 0.85, 0.45), color: "main" },
          { type: "box", at: v(0, 0.82, 0), size: v(0.72, 0.1, 0.47), color: "accent", blend: 0 },
          { type: "capsule", at: v(0, 1.6, 0), size: v(0.2, 0.28, 0.2), color: "orange5" },
        ] },
        { name: "head", anim: "head", pivot: v(0, 1.6, 0), shapes: [
          { type: "ellipsoid", at: v(0, 1.86, 0.02), size: v(0.52, 0.55, 0.5), color: "orange5" },
          { type: "ellipsoid", at: v(0.11, 1.9, 0.27), size: v(0.1, 0.12, 0.07), color: "neutral1", mirror: true },
          { type: "ellipsoid", at: v(0, 2.06, -0.02), size: v(0.56, 0.24, 0.54), color: "accent" },
        ] },
        { name: "arm", anim: "armL", mirror: true, pivot: v(0.42, 1.45, 0), shapes: [
          { type: "capsule", at: v(0.41, 1.12, 0), size: v(0.19, 0.72, 0.19), color: "main" },
          { type: "ellipsoid", at: v(0.42, 0.73, 0.02), size: v(0.17, 0.17, 0.17), color: "orange5" },
        ] },
        { name: "leg", anim: "legL", mirror: true, pivot: v(0.17, 0.75, 0), shapes: [
          { type: "capsule", at: v(0.17, 0.4, 0), size: v(0.22, 0.8, 0.22), color: "accent" },
          { type: "box", at: v(0.17, 0.05, 0.06), size: v(0.22, 0.1, 0.32), color: "neutral2", blend: 0 },
        ] },
      ],
    },
  },
  {
    id: "winged-creature", name: "Winged creature",
    description: "Things that fly by flapping: birds, bats, moths, butterflies, bees, dragons and griffins in the air.",
    bodies: ["bird"], words: /\b(bird|bat|moth|butterfly|bee|wasp|dragon|griffin|owl|eagle|hawk|crow|parrot|phoenix|fairy|insect|dragonfly)\b/, movement: "fly", upright: false, minWingspan: 1.2,
    parts: [
      { role: "body", why: "a compact, light body", required: true },
      { role: "wingL", why: "wings flap from the shoulder; mirror one wing", required: true },
      { role: "head", why: "optional but makes it look around", required: false },
      { role: "tail", why: "steers and balances the silhouette", required: false },
    ],
    guidance: [
      "Wingspan at least 1.2× the body's length (birds 2×, moths and bats 1.5×): the wings are the silhouette.",
      "Wings are flat ellipsoids or wedges (thickness ~5% of their width), pivoting at the shoulder, tilted up 10–20° (a V reads as flight).",
      "Two-tone wings (an accent on the tips or a spot) make the flap visible.",
      "Keep the body small and light; the head at the front with a beak, snout or antennae.",
    ],
    styles: { lowpoly: "Wedges for wings read beautifully as folded paper.", sculpted: "Blend the wing roots into the body (0.05); glow on spots for night flyers." },
    template: {
      parts: [
        { name: "body", anim: "body", shapes: [
          { type: "ellipsoid", at: v(0, 1, 0), size: v(0.55, 0.55, 1.3), color: "main" },
          { type: "ellipsoid", at: v(0, 0.9, 0.05), size: v(0.42, 0.36, 1.05), color: "belly" },
        ] },
        { name: "head", anim: "head", pivot: v(0, 1.12, 0.55), shapes: [
          { type: "ellipsoid", at: v(0, 1.2, 0.78), size: v(0.48, 0.46, 0.48), color: "main" },
          { type: "cone", axis: "z", at: v(0, 1.14, 1.08), size: v(0.14, 0.12, 0.3), color: "accent" },
          { type: "ellipsoid", at: v(0.15, 1.27, 0.94), size: v(0.12, 0.13, 0.08), color: "neutral1", mirror: true },
        ] },
        { name: "wing", anim: "wingL", mirror: true, pivot: v(0.22, 1.12, 0.1), shapes: featherWing(v(0.22, 1.12, 0.1), 1.45, 0.62) },
        { name: "tail", anim: "tail", pivot: v(0, 1, -0.6), shapes: [
          { type: "wedge", at: v(0, 1.02, -0.85), size: v(0.5, 0.05, 0.5), rotate: v(0, 180, 0), color: "accent" },
        ] },
      ],
    },
  },
  {
    id: "swimmer", name: "Swimmer",
    description: "Fish, sharks, whales, dolphins, eels and other things that swim.",
    bodies: ["fish"], words: /\b(fish|shark|whale|dolphin|eel|koi|carp|ray|seal|orca|piranha)\b/, movement: "swim", upright: false,
    parts: [
      { role: "body", why: "a spindle, thick near the front", required: true },
      { role: "tail", why: "sways side to side; the main motion", required: true },
      { role: "finL", why: "pectoral fins (mirror one)", required: false },
    ],
    guidance: [
      "Spindle body: widest at a third from the front, tapering to the tail.",
      "Countershading: darker back (main), pale belly; the eye high and near the front.",
      "A vertical tail fin (forked = fast, round = slow) and a dorsal fin for sharks and dolphins.",
    ],
    styles: { sculpted: "Blend fins into the body (0.04); gloss on the body reads as wet." },
    template: EXAMPLE_SHAPE,
  },
  {
    id: "floating-spirit", name: "Floating spirit",
    description: "Ghosts, wisps, slimes, jellyfish, spirits and anything that hovers or drifts.",
    bodies: ["blob", "cloud"], words: /\b(ghost|spirit|wisp|slime|jelly|jellyfish|blob|soul|lantern|orb|will-o)\b/, movement: "hover", upright: true,
    parts: [
      { role: "body", why: "one soft mass that bobs", required: true },
      { role: "tail", why: "a trailing wisp or tentacles that sway", required: false },
    ],
    guidance: [
      "One big rounded mass, a face low on the front, and a trailing tail or tentacles.",
      "Glow finish on the core or eyes makes it a light at night.",
    ],
    styles: { sculpted: "Large blends (0.15) for a gooey, soft look." },
    template: {
      blend: 0.12,
      parts: [
        { name: "body", anim: "body", shapes: [
          { type: "ellipsoid", at: v(0, 1.2, 0), size: v(1, 1.05, 1), color: "main" },
          { type: "ellipsoid", at: v(0, 1.1, 0.12), size: v(0.6, 0.6, 0.7), color: "belly", finish: "glow" },
          { type: "ellipsoid", at: v(0.2, 1.35, 0.44), size: v(0.16, 0.22, 0.1), color: "neutral1", mirror: true },
          { type: "ellipsoid", at: v(0, 1.12, 0.47), size: v(0.22, 0.1, 0.08), color: "neutral1", blend: 0 },
        ] },
        { name: "tail", anim: "tail", pivot: v(0, 0.8, 0), shapes: [
          { type: "cone", at: v(0, 0.45, -0.1), size: v(0.55, 0.8, 0.55), rotate: v(180, 0, 0), color: "main" },
        ] },
      ],
    },
  },
  {
    id: "crawler", name: "Crawler",
    description: "Many-legged things: spiders, crabs, scorpions, ants, beetles, insects on the ground.",
    bodies: [], words: /\b(spider|crab|lobster|scorpion|ant|beetle|ladybug|insect|bug|tick|mite)\b/, movement: "walk", upright: false,
    parts: [
      { role: "body", why: "a thorax and a bigger abdomen behind it", required: true },
      { role: "legL", why: "three (or four) leg pairs that bend up at the knee and down to the ground; mirror them, alternate legL/legR so they scuttle", required: true },
      { role: "head", why: "small, low and at the front, with several eyes or eye stalks", required: false },
    ],
    guidance: [
      "Low and wide: the body sits between knees that rise above it; legs are tubes with a knee point (up, then down to the ground).",
      "Alternate legL and legR down each side, so the legs move in waves.",
      "Pincers are the front legs made thicker, with a claw (two ellipsoids) at the end; a scorpion's tail is a tube curling up over its back to a stinger.",
    ],
    styles: { sculpted: "Thin, tapering leg tubes; gloss on shells (crabs, beetles)." },
    template: TEMPLATES.crawler,
  },
  {
    id: "serpent", name: "Serpent",
    description: "Things with no legs that slither: snakes, worms, eels on land, basilisks.",
    bodies: [], words: /\b(snake|serpent|worm|eel|cobra|python|viper|naga|basilisk|caterpillar|centipede)\b/, movement: "walk", upright: false,
    parts: [
      { role: "head", why: "a wedge-shaped head that leads; the eyes high on its sides", required: true },
      { role: "tail", why: "the whole body as a tube with 4–6 points in an S: it becomes a chain that slithers", required: true },
    ],
    guidance: [
      "The body is one long tube in a gentle S, thickest behind the head and thinning to a point; it slithers by itself.",
      "A belly stripe (a flatter, lighter ellipsoid) and a pattern along the back (repeat) make it read as a snake, not a rope.",
    ],
    styles: { sculpted: "Blend the head into the neck (0.08) for a smooth snake." },
    template: TEMPLATES.serpent,
  },
  {
    id: "shelled", name: "Shelled creature",
    description: "Creatures carrying a shell: turtles, tortoises, snails.",
    bodies: [], words: /\b(turtle|tortoise|terrapin|snail|slug)\b/, movement: "walk", upright: false,
    parts: [
      { role: "body", why: "the shell (a high dome, or a spiral for snails) over a softer body", required: true },
      { role: "head", why: "pokes out at the front on a neck (or eye stalks, for snails)", required: true },
    ],
    guidance: ["The shell is most of the silhouette: give it a pattern (repeat plates, or rings for a spiral) in the accent colour.", "Gloss on the shell; matte skin."],
    styles: { sculpted: "Gloss shells; soft blends where skin meets shell." },
    template: TEMPLATES.turtle,
  },
  {
    id: "tentacled", name: "Tentacled creature",
    description: "Octopuses, squid, krakens and jellyfish: a soft body and many tentacles.",
    bodies: [], words: /\b(octopus|squid|kraken|cuttlefish|jellyfish|medusa)\b/, movement: "swim", upright: true,
    parts: [
      { role: "body", why: "the mantle or bell, with big eyes", required: true },
      { role: "tail", why: "each tentacle a tail-role part with a curving tube: they become chains that sway", required: true },
    ],
    guidance: ["Tentacles as tubes that curl outward and down, thinning to a tip; mirror them for symmetry.", "Spots or suckers with repeat; glow for deep-sea or jellyfish."],
    styles: { sculpted: "Large blends (0.08–0.12) for soft, rubbery forms." },
    template: TEMPLATES.tentacled,
  },
  {
    id: "walking-bird", name: "Walking bird",
    description: "Birds that walk more than they fly: penguins, chickens, ducks, flamingos.",
    bodies: [], words: /\b(penguin|chicken|hen|rooster|duck|goose|flamingo|ostrich|emu|turkey|chick)\b/, movement: "walk", upright: true,
    parts: [
      { role: "body", why: "an egg-shaped upright body with a pale front", required: true },
      { role: "head", why: "round, with a beak (a cone pointing forward)", required: true },
      { role: "legL", why: "short legs with flat feet (mirror)", required: true },
      { role: "wingL", why: "small wings at the sides (mirror) that flap when it hurries", required: false },
    ],
    guidance: ["Upright and round; the beak and feet in the accent colour.", "It waddles: short legs, a body that rolls side to side."],
    styles: {},
    template: TEMPLATES["walking-bird"],
  },
  {
    id: "plant-creature", name: "Plant creature",
    description: "Living plants: mushrooms, treants, cacti, flower creatures.",
    bodies: [], words: /\b(mushroom|toadstool|fungus|treant|ent|cactus|flower|plant)\b/, movement: "walk", upright: true,
    parts: [
      { role: "body", why: "a stem or trunk; the cap or crown is the silhouette", required: true },
      { role: "legL", why: "stubby feet or roots", required: false },
      { role: "armL", why: "branches, for trees", required: false },
    ],
    guidance: ["A face low on the stem or trunk (glowing eyes in bark for treants).", "Spots on caps; leaf clusters as overlapping ellipsoids."],
    styles: {},
    template: TEMPLATES.mushroom,
  },
  {
    id: "elemental", name: "Elemental",
    description: "Beings of an element: fire, ice, stone, water, storm, crystal.",
    bodies: [], words: /\b(elemental|elementals)\b/, movement: "hover", upright: true,
    parts: [
      { role: "body", why: "a core that glows, tapering to nothing below (it floats)", required: true },
      { role: "armL", why: "arms of the element, ending in a glowing hand", required: true },
      { role: "head", why: "small, with glowing eyes", required: false },
    ],
    guidance: ["The element sets the colours and the accents: flames (glow cones) for fire, crystals (gloss cones) for ice, rough blocks for stone."],
    styles: { sculpted: "Large blends; glow on the core and the crown." },
    template: TEMPLATES.elemental,
  },
];

export interface Brief {
  prompt: string;
  skill: string;
  mood: Mood;
  style: ModelStyle;
  /** Starting values for the design. */
  name: string;
  movement: Movement;
  temperament: Temperament;
  length: number;
  colors: { main: string; belly: string; accent: string };
  /** What must read from 20 m away. */
  mustRead: string[];
  targets: (typeof MOOD_TARGETS)[Mood];
  guidance: string[];
  notes: string[];
}

/** The skill for a body plan or words, if there is one. */
export function skillFor(text: string, body?: BodyPlan): Skill | undefined {
  const t = text.toLowerCase();
  return SKILLS.find((s) => s.words.test(t)) ?? (body ? SKILLS.find((s) => s.bodies.includes(body)) : undefined);
}

/** Read a request the way an art director would: what it is, its mood and style, and how to make it well. */
export function interpretPrompt(prompt: string, std: Standards): { brief: Brief; skill: Skill; start: DesignInput } | { error: string } {
  const t = prompt.toLowerCase();
  const words = t.match(/[a-z-]+/g) ?? [];
  const plan = planSummon(prompt);
  // What it is: the bestiary first (it knows the body and the look), then the planner's body plan.
  const known = lookupCreature(t);
  // Never a dead end: something unknown starts as a creature on four legs, and the brief says so.
  const skill = (known ? SKILLS.find((k) => k.id === known.creature.skill) : undefined) ?? skillFor(t, plan.spec?.body) ?? SKILLS.find((k) => k.id === "four-legged-creature");
  if (!skill) return { error: `no skill for "${prompt}"` };
  const cr = known?.creature;
  const mods = known?.modifiers ?? [];
  const spec = plan.spec;
  // Temperament: the request's words first (angry, friendly…), then the modifiers, then the creature.
  const angry = words.some((w) => ["angry", "evil", "hostile", "fierce", "vicious", "aggressive", "scary", "menacing", "killer", "deadly"].includes(w));
  const kind = words.some((w) => ["friendly", "cute", "tame", "gentle", "pet", "baby", "peaceful"].includes(w));
  const temperament: Temperament = angry ? "hostile" : kind ? "passive" : mods.find((m) => m.temperament)?.temperament ?? cr?.temperament ?? spec?.temperament ?? "passive";
  const mood = MOOD_WORDS.find(([, re]) => re.test(t))?.[0] ?? (temperament === "hostile" ? "menacing" : "neutral");
  const worldStyle = ((std.art as { modelStyle?: string }).modelStyle ?? "voxel") as ModelStyle;
  const asked = styleFromWords(t);
  const style = asked && (std.art as { promptStyles?: boolean }).promptStyles !== false ? asked : worldStyle;
  const flying = /\b(flying|winged)\b/.test(t);
  const movement: Movement = flying ? "fly" : mods.find((m) => m.movement)?.movement ?? cr?.movement ?? spec?.movement ?? skill.movement;
  // Colours: the creature's own, then its material (robot, fire…), then colour words in the request.
  let colors = { ...(cr?.colors ?? spec?.colors ?? { main: "neutral5", belly: "neutral7", accent: "neutral2" }) };
  for (const m of mods) colors = { ...colors, ...m.colors };
  const colourWord = words.find((w) => COLOR_WORDS[w] && !mods.some((m) => m.words.includes(w)));
  if (colourWord) { const [m, b, a] = COLOR_WORDS[colourWord]; colors = { main: m, belly: b, accent: cr ? colors.accent : a }; }
  // Size: the creature's length, scaled by size words.
  const sizeWord = words.find((w) => SIZE_WORDS[w]);
  const length = Math.max(0.3, Math.round((cr?.length ?? spec?.length ?? 2) * (sizeWord ? SIZE_WORDS[sizeWord] : 1) * 100) / 100);
  const templateId = cr?.template ?? (skill.id === "four-legged-creature" ? "canine" : skill.id === "humanoid" && !(spec?.features.length) ? "person" : undefined);
  const natural = !!templateId && (templateId in BUILDS || templateId in PEOPLE || templateId in BIRDS || templateId === "dragon" || templateId === "saurian" || templateId === "theropod");
  // Small creatures get bigger eyes: a face that reads at a few pixels is what makes them charming.
  const features = [...new Set([...(cr?.features ?? spec?.features ?? []), ...mods.flatMap((m) => m.features), ...(flying && cr?.movement !== "fly" ? ["wings"] : []), ...(length < 1 && !natural ? ["big eyes"] : [])])];
  const finish = mods.find((m) => m.finish)?.finish;
  const name = (() => {
    // The word the player used, when it's a kind of its own ("a kraken" is drawn as an octopus, but it's a Kraken).
    const said = known ? words.filter((w) => cr?.words.includes(w)).pop() : undefined;
    const own = said && cr && said !== cr.words[0] && !cr.words.slice(0, 2).includes(said) && !said.endsWith("s") ? said.replace(/\b\w/g, (ch) => ch.toUpperCase()) : undefined;
    const base = own ?? cr?.name ?? spec?.name ?? prompt.replace(/^(a|an|the)\s+/i, "");
    const adj = words.filter((w) => (SIZE_WORDS[w] || COLOR_WORDS[w] || mods.some((m) => m.words.includes(w)) || MOOD_WORDS.some(([, re]) => re.test(w))) && !base.toLowerCase().includes(w));
    return [...adj, base].join(" ").replace(/\b\w/g, (ch) => ch.toUpperCase()).slice(0, 32);
  })();
  const notes: string[] = [];
  if (asked && style !== asked) notes.push(`asked for ${asked}, but this world draws everything ${worldStyle}`);
  else if (asked && asked !== worldStyle) notes.push(`drawn ${asked} as asked (this world's default is ${worldStyle}); everyone sees it that way`);
  if (mood === "cute" && temperament === "hostile") notes.push("cute and hostile: keep it cute in shape, and let the warning pulse show the danger");
  if (!cr && !spec) notes.push(`"${prompt}" isn't in the bestiary: this is the ${skill.name.toLowerCase()} template; make it yours`);
  const mustRead = [
    ...skill.parts.filter((p) => p.required && p.role !== "body").map((p) => p.role.replace(/[LR]$/, "s")),
    ...features.filter((f) => !["metal", "stone", "glow", "glossy"].includes(f)),
    mood === "cute" ? "big eyes" : mood === "menacing" ? "horns or spikes" : "eyes",
  ];
  const gait: Gait = cr?.gait ?? (movement === "fly" ? "glide" : movement === "hover" ? "float" : "walk");
  const brief: Brief = {
    prompt, skill: skill.id, mood, style, name,
    movement, temperament, length, colors,
    mustRead: [...new Set(mustRead)], targets: MOOD_TARGETS[mood],
    guidance: [...skill.guidance, ...MOOD_TARGETS[mood].guidance, ...(skill.styles[style] ? [skill.styles[style]!] : [])],
    notes: [...notes, ...(spec && !cr ? plan.notes : [])],
  };
  const template = structuredClone((templateId && TEMPLATES[templateId]) || skill.template);
  const abilities = temperament === "hostile" ? (cr?.abilities ?? spec?.abilities ?? ["bite"]) : [];
  const start: DesignInput = {
    name, description: prompt.slice(0, 300), movement, temperament, length, colors, gait, surface: surfaceFor(templateId, skill.id, mods.map((m) => m.words[0])),
    ...(abilities.length ? { abilities } : {}), ...(spec?.role ? { role: spec.role } : {}), ...(asked && style === asked ? { style } : {}),
    shape: withFinish(applyFeatureKit(addFeatures(applyMood(template, mood, natural), features, mood), features, skill.id, mood), finish),
  };
  return { brief, skill, start };
}

/** A material modifier's finish (metal robots, glossy ice, glowing spirits) on the main-coloured forms. */
function withFinish(shape: ShapeSpec, finish?: "gloss" | "metal" | "glow"): ShapeSpec {
  if (!finish) return shape;
  for (const p of shape.parts) for (const q of p.shapes) if ((q.color ?? "main") === "main" && !q.finish) q.finish = finish === "glow" ? "gloss" : finish;
  return shape;
}

/** Push a template towards a mood: cute grows the head, menacing adds horns and glowing eyes. */
function applyMood(shape: ShapeSpec, mood: Mood, natural = false): ShapeSpec {
  const head = shape.parts.find((p) => p.anim === "head");
  if (!head) return shape;
  const pv = head.pivot ?? head.shapes[0].at;
  if (natural) {
    // Anatomical bodies are already in proportion: moods nudge them instead of caricaturing them.
    // A menacing wolf carries its head low with amber eyes; a cute one has a bigger head and eyes.
    // Babies and cute things have big heads (and big eyes, below).
    const k = mood === "cute" ? 1.75 : mood === "comic" ? 1.2 : mood === "neutral" ? 1 : 0.95;
    const drop = mood === "menacing" ? head.shapes[0].size[1] * 0.35 : 0;
    for (const q of head.shapes) {
      q.at = [pv[0] + (q.at[0] - pv[0]) * k, pv[1] + (q.at[1] - pv[1]) * k - drop, pv[2] + (q.at[2] - pv[2]) * k];
      q.size = [q.size[0] * k, q.size[1] * k, q.size[2] * k];
    }
    for (const q of head.shapes) {
      if (!(q.color === "neutral1" && q.mirror && q.type === "ellipsoid")) continue;
      // Menacing: narrowed eyes (colour would smear at this size; the lowered head says enough).
      if (mood === "menacing") q.size = [q.size[0], q.size[1] * 0.7, q.size[2]];
      if (mood === "cute") q.size = [q.size[0] * 1.4, q.size[1] * 1.4, q.size[2] * 1.2];
    }
    return shape;
  }
  if (mood !== "neutral") {
    // Cute and comic heads grow; menacing, heroic and elegant ones shrink (the head ratio sets the mood).
    const k = mood === "cute" ? 1.4 : mood === "comic" ? 1.25 : mood === "menacing" ? 0.62 : 0.72;
    for (const q of head.shapes) {
      q.at = [pv[0] + (q.at[0] - pv[0]) * k, pv[1] + (q.at[1] - pv[1]) * k, pv[2] + (q.at[2] - pv[2]) * k];
      q.size = [q.size[0] * k, q.size[1] * k, q.size[2] * k];
    }
  }
  if (mood === "menacing") {
    // Head low and forward, horns, no eye whites: small glowing eyes.
    for (const q of head.shapes) q.at = [q.at[0], q.at[1] - 0.12, q.at[2] + 0.06];
    const top = head.shapes[0];
    head.shapes.push({ type: "cone", at: [top.size[0] * 0.3, top.at[1] + top.size[1] * 0.55, top.at[2] - top.size[2] * 0.1], size: [top.size[0] * 0.18, top.size[1] * 0.55, top.size[2] * 0.18], rotate: [-25, 0, -20], color: "neutral8", mirror: true });
    for (const q of head.shapes) {
      if (q.color === "neutral8" && q.mirror && q.type === "ellipsoid") { q.color = top.color; }
      if (q.color === "neutral1" && q.mirror) { q.color = "yellow4"; q.finish = "glow"; q.size = [q.size[0] * 0.8, q.size[1] * 0.6, q.size[2]]; }
    }
  }
  return shape;
}

/**
 * Features the planner understood ("horns", "spines", "wings", "mane", "antennae", "tail"), added to a
 * starting design so a dragon starts as a dragon and not as a bird.
 */
function addFeatures(shape: ShapeSpec, features: string[], mood: Mood): ShapeSpec {
  const head = shape.parts.find((p) => p.anim === "head");
  const body = shape.parts.find((p) => p.anim === "body" || p.name === "body");
  const top = head?.shapes[0];
  const core = body?.shapes[0];
  const soft = mood === "cute";
  if (features.includes("horns") && head && top && !head.shapes.some((q) => (q.type === "cone" || q.type === "tube") && (q.points?.[0]?.[1] ?? q.at[1]) > top.at[1] + top.size[1] * 0.3)) {
    // Horns sweep back and up from the top of the head, thinning to a tip (cute ones stay short and stubby).
    const [hx, hy, hz] = [top.size[0] * 0.25, top.at[1] + top.size[1] * 0.4, top.at[2] - top.size[2] * 0.1];
    const l = top.size[1] * (soft ? 0.35 : 0.75);
    head.shapes.push({ type: "tube", at: [hx, hy, hz], size: [l, l, l], points: [[hx, hy, hz], [hx + l * 0.25, hy + l * 0.6, hz - l * 0.3], [hx + l * 0.35, hy + l * 0.9, hz - l * 0.8]], radius: [top.size[0] * 0.1, top.size[0] * (soft ? 0.06 : 0.015)], color: "accent", mirror: true });
  }
  if (features.includes("spines") && body && core) {
    // A ridge along the back, shrinking towards the tail.
    body.shapes.push({ type: soft ? "ellipsoid" : "cone", at: [0, core.at[1] + core.size[1] * 0.45, core.at[2] + core.size[2] * 0.3], size: [0.06 * core.size[0], core.size[1] * (soft ? 0.18 : 0.3), core.size[2] * 0.1], rotate: [-20, 0, 0], color: "accent", repeat: { count: 5, offset: [0, -core.size[1] * 0.02, -core.size[2] * 0.17], scale: 0.88 } });
  }
  // Humanoid kit: armour, helmet, sword, shield, crown (the generators' features, as shapes).
  const arm = shape.parts.find((p) => p.anim === "armL");
  if (core && body && features.includes("armor")) {
    // A breastplate that follows the chest, a ridge down the middle, and plates over the hips.
    const [w, hh, d] = core.size;
    body.shapes.push(
      { type: "box", at: [0, core.at[1] + hh * 0.02, core.at[2] + d * 0.02], size: [w * 1.05, hh * 0.98, d * 1.12], round: core.round ?? Math.min(w, d) * 0.35, color: "neutral6", finish: "metal" },
      { type: "box", at: [0, core.at[1], core.at[2] + d * 0.56], size: [w * 0.05, hh * 0.85, d * 0.07], round: w * 0.02, color: "neutral7", finish: "metal" },
      { type: "box", at: [0, core.at[1] - hh * 0.64, core.at[2] + d * 0.02], size: [w * 0.92, hh * 0.18, d * 1.08], round: d * 0.2, color: "neutral6", finish: "metal", repeat: { count: 2, offset: [0, -hh * 0.16, 0], scale: 1.04 } },
    );
    if (arm) {
      // Layered pauldrons over the shoulders, sized to the arm.
      const sh = arm.shapes.find((q) => q.type === "ellipsoid" && q.at[1] > arm.shapes[0].at[1]) ?? arm.shapes[0];
      const pw = sh === arm.shapes[0] ? 0.3 : Math.max(sh.size[0], sh.size[2]) * 1.15;
      arm.shapes.push({ type: "ellipsoid", at: [sh.at[0] + pw * 0.08, sh === arm.shapes[0] ? sh.at[1] + sh.size[1] * 0.42 : sh.at[1] + sh.size[1] * 0.18, sh.at[2]], size: [pw, pw * 0.5, pw * 1.05], color: "neutral6", finish: "metal", repeat: { count: 2, offset: [pw * 0.04, -pw * 0.22, 0], scale: 0.92 } });
    }
  }
  if (features.includes("helmet") && head && top) {
    // A great helm: a dome over the head, a visor slit, a ridge and a plume.
    const [s0, s1, s2] = top.size, [c0, c1, c2] = top.at;
    head.shapes.push(
      { type: "ellipsoid", at: [c0, c1 + s1 * 0.06, c2 - s2 * 0.02], size: [s0 * 1.2, s1 * 1.14, s2 * 1.16], color: "neutral6", finish: "metal" },
      { type: "box", at: [c0, c1 + s1 * 0.05, c2 + s2 * 0.5], size: [s0 * 0.7, s1 * 0.07, s2 * 0.3], color: "neutral1", paint: true },
      { type: "box", at: [c0, c1 + s1 * 0.6, c2 - s2 * 0.02], size: [s0 * 0.08, s1 * 0.12, s2 * 1.05], round: s0 * 0.03, color: "neutral7", finish: "metal" },
      { type: "ellipsoid", at: [c0, c1 + s1 * 0.78, c2 - s2 * 0.25], size: [s0 * 0.22, s1 * 0.38, s2 * 0.95], rotate: [18, 0, 0], color: "red3" },
    );
  }
  if (features.includes("sword") && arm) {
    // In the right hand (the mirror of armL is armR): sword down along the arm, hilt at the hand.
    const hand = arm.shapes[arm.shapes.length > 1 ? 1 : 0];
    shape.parts.push({ name: "sword", anim: "armR", pivot: arm.pivot ? [-arm.pivot[0], arm.pivot[1], arm.pivot[2]] : undefined, shapes: [
      // Crossguard at the hand, the blade hanging down and a little forward, narrowing to the tip.
      { type: "box", at: [-hand.at[0], hand.at[1] - 0.06, hand.at[2] + 0.04], size: [0.05, 0.04, 0.22], color: "yellow4", finish: "metal" },
      { type: "box", at: [-hand.at[0], hand.at[1] - 0.4, hand.at[2] + 0.12], size: [0.035, 0.62, 0.08], rotate: [160, 0, 0], taper: [1, 0.15], color: "neutral7", finish: "metal" },
    ] });
  }
  if (features.includes("shield") && arm) {
    // On the left forearm only: its own part (the arm part is mirrored, the shield isn't).
    const fore = arm.shapes[0];
    const k = Math.min(1, (arm.pivot?.[1] ?? 1.5) / 1.5);
    shape.parts.push({ name: "shield", anim: "armL", pivot: arm.pivot, shapes: [
      { type: "cylinder", axis: "x", at: [fore.at[0] + 0.1 * k, fore.at[1] - 0.05 * k, fore.at[2] + 0.06 * k], size: [0.05 * k, 0.55 * k, 0.46 * k], round: 0.02 * k, color: "accent", finish: "gloss" },
      { type: "ellipsoid", at: [fore.at[0] + 0.13 * k, fore.at[1] - 0.05 * k, fore.at[2] + 0.06 * k], size: [0.06 * k, 0.14 * k, 0.14 * k], color: "neutral6", finish: "metal" },
    ] });
  }
  if (features.includes("crown") && head && top) {
    head.shapes.push({ type: "cylinder", at: [0, top.at[1] + top.size[1] * 0.55, top.at[2]], size: [top.size[0] * 0.7, top.size[1] * 0.2, top.size[2] * 0.7], color: "yellow4", finish: "metal" });
    head.shapes.push({ type: "cylinder", at: [0, top.at[1] + top.size[1] * 0.6, top.at[2]], size: [top.size[0] * 0.55, top.size[1] * 0.3, top.size[2] * 0.55], color: "yellow4", cut: true });
  }
  if (features.includes("mane") && !features.includes("hooves") && head && top) {
    // A lion's mane: a big shaggy ruff framing the face and running down onto the chest.
    head.shapes.splice(1, 0,
      { type: "ellipsoid", at: [0, top.at[1] - top.size[1] * 0.05, top.at[2] - top.size[2] * 0.3], size: [top.size[0] * 2.1, top.size[1] * 2.1, top.size[2] * 0.95], color: "accent" },
      { type: "ellipsoid", at: [0, top.at[1] - top.size[1] * 0.75, top.at[2] - top.size[2] * 0.35], size: [top.size[0] * 1.5, top.size[1] * 1.5, top.size[2] * 1.0], color: "accent" },
      { type: "ellipsoid", at: [0, top.at[1] + top.size[1] * 0.05, top.at[2] - top.size[2] * 0.3], size: [top.size[0] * 2.2, top.size[1] * 2.2, top.size[2] * 0.4], color: "accent-1", paint: true, blend: top.size[1] * 0.3 },
    );
  }
  if (features.includes("antennae") && head && top) {
    head.shapes.push({ type: "cylinder", at: [top.size[0] * 0.18, top.at[1] + top.size[1] * 0.7, top.at[2] + top.size[2] * 0.2], size: [0.03, top.size[1] * 0.8, 0.03], rotate: [35, 0, -20], color: "accent", mirror: true });
    head.shapes.push({ type: "ellipsoid", at: [top.size[0] * 0.32, top.at[1] + top.size[1] * 1.05, top.at[2] + top.size[2] * 0.42], size: [0.08, 0.08, 0.08], color: "belly", finish: "glow", mirror: true });
  }
  if ((features.includes("spines") || features.includes("horns")) && core && !shape.parts.some((p) => p.anim === "tail" && p.shapes.some((q) => Math.max(...q.size) > core.size[2] * 0.5))) {
    // Dragons and beasts with horns get a long tail.
    const tail = shape.parts.find((p) => p.anim === "tail");
    // A long whip tail: a tube that dips, then curls up, thinning to a tip.
    const [y0, z0, L] = [core.at[1], core.at[2] - core.size[2] * 0.42, core.size[2] * 1.1];
    const piece = { type: "tube" as const, at: [0, y0, z0 - L / 2] as [number, number, number], size: [L, L, L] as [number, number, number],
      points: [[0, y0, z0], [0, y0 - L * 0.05, z0 - L * 0.4], [L * 0.08, y0 + L * 0.05, z0 - L * 0.75], [0, y0 + L * 0.25, z0 - L]] as [number, number, number][],
      radius: [core.size[0] * 0.2, core.size[0] * 0.03] as [number, number], color: "main" };
    if (tail) tail.shapes.unshift(piece);
    else shape.parts.push({ name: "tail", anim: "tail", pivot: [0, core.at[1], core.at[2] - core.size[2] * 0.45], shapes: [piece] });
  }
  return shape;
}

// ---------------------------------------------------------------- critique

const ROUNDED = new Set(["ellipsoid", "capsule", "torus", "cylinder"]);
const lum = (hex: string) => { const [r, g, b] = parseHex(hex).map((x) => x / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

function bounds(parts: VoxelPart[]): { min: number[]; max: number[] } | null {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) for (let y = 0; y < p.grid.h; y++) for (let z = 0; z < p.grid.d; z++) for (let x = 0; x < p.grid.w; x++) {
    if (!p.grid.get(x, y, z)) continue;
    const c = [p.origin[0] + x, p.origin[1] + y, p.origin[2] + z];
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], c[i]); max[i] = Math.max(max[i], c[i] + 1); }
  }
  return Number.isFinite(min[0]) ? { min, max } : null;
}

export interface Critique {
  score: number;
  passed: string[];
  issues: ShapeIssue[];
}

/** How well a built design meets its brief and skill. Findings are warnings (taste), never errors (rules). */
export function critiqueDesign(design: DesignInput, model: VoxelModel, brief: Pick<Brief, "skill" | "mood">, std: Standards): Critique {
  const skill = SKILLS.find((s) => s.id === brief.skill);
  const issues: ShapeIssue[] = [];
  const passed: string[] = [];
  const warn = (path: string, message: string, hint: string) => issues.push({ path, level: "warning", message, hint });
  let checks = 0;
  const check = (ok: boolean, pass: string, path: string, message: string, hint: string) => { checks++; if (ok) passed.push(pass); else warn(path, message, hint); };
  const shape = design.shape;
  if (!skill || !shape) return { score: 0, passed, issues: [{ path: "shape", level: "warning", message: "no shape or no skill to compare with", hint: "start from interpret_prompt's design" }] };
  const targets = MOOD_TARGETS[brief.mood];
  const parts = expandShape(shape);
  const roles = new Set(parts.map((p) => p.anim ?? (p.name === "body" ? "body" : undefined)));
  for (const r of skill.parts.filter((p) => p.required)) {
    const has = roles.has(r.role) || (/[LR]$/.test(r.role) && (roles.has(r.role.replace(/L$/, "R") as AnimRole) || roles.has(r.role.replace(/R$/, "L") as AnimRole)));
    check(has, `has ${r.role}`, "parts", `no part with the "${r.role}" role`, `${skill.name}: ${r.why}`);
  }
  const all = bounds(model.parts);
  const byRole = (role: string) => model.parts.filter((p) => p.anim === role || (role === "head" && /head/i.test(p.name)));
  // Head proportion for the mood: the head's main form (its first primitive) against the body's, or
  // the whole height for upright creatures. Horns, ears and hats don't count.
  const headPart = shape.parts.find((p) => p.anim === "head" || /head/i.test(p.name));
  const bodyPart = shape.parts.find((p) => p.anim === "body" || p.name === "body");
  if (targets.headRatio && headPart?.shapes[0] && bodyPart?.shapes[0]) {
    const hb = shapeBounds(shape);
    const h0 = headPart.shapes[0].size, b0 = bodyPart.shapes[0].size;
    const ratio = skill.upright ? h0[1] / Math.max(1e-6, hb.max[1] - hb.min[1]) : h0[2] / Math.max(1e-6, b0[2]);
    // Lying-down bodies are long, so heads compare to a longer measure: allow a little more.
    const [lo, hi] = skill.upright ? targets.headRatio : [targets.headRatio[0], targets.headRatio[1] * 1.2];
    const what = skill.upright ? "head height ÷ total height" : "head length ÷ body length";
    check(ratio >= lo && ratio <= hi, `${what} ${ratio.toFixed(2)} suits ${brief.mood}`, `parts[${shape.parts.indexOf(headPart)}].shapes[0].size`, `${what} is ${ratio.toFixed(2)}; ${brief.mood} reads best at ${lo}–${+hi.toFixed(2)}`, ratio < lo ? "make the head bigger (scale its primitives about its pivot)" : "make the head smaller, or the body bigger");
  }
  // Eyes: small mirrored primitives on the head (or the front of the body).
  const eyeParts = shape.parts.filter((p) => p.anim === "head" || p.anim === "body" || p.name === "body");
  const eyes = eyeParts.some((p) => {
    const ext = Math.max(...p.shapes.filter((q) => !q.cut).map((q) => Math.max(...q.size)));
    return p.shapes.some((q) => q.mirror && !q.cut && Math.max(...q.size) < ext * 0.35 && q.at[2] > 0);
  });
  if (!["ship"].includes(design.body ?? "")) check(eyes, "has eyes", "parts", "no eyes found", "two small mirrored primitives (mirror: true) on the front of the head; dark pupils on light whites, or glow");
  // Wingspan for flyers.
  if (skill.minWingspan && all) {
    const wings = bounds(model.parts.filter((p) => /^wing/.test(p.anim ?? "")));
    const body = bounds(byRole("body"));
    if (wings && body) {
      const span = (all.max[0] - all.min[0]) / Math.max(1, body.max[2] - body.min[2]);
      check(span >= skill.minWingspan, `wingspan ${span.toFixed(2)}× its body`, "parts", `wingspan is only ${span.toFixed(2)}× the body's length`, `make the wings at least ${skill.minWingspan}× as wide as the body is long`);
    }
  }
  // Walkers stand on their feet.
  if ((design.movement ?? skill.movement) === "walk" && all) {
    const legs = bounds(model.parts.filter((p) => /^leg/.test(p.anim ?? "")));
    if (legs) check(legs.min[1] <= all.min[1] + 1, "legs reach the ground", "parts", "the legs don't reach the ground: the body is lowest", "lengthen the legs or raise the body");
  }
  // Form language for the mood.
  const prims = parts.flatMap((p) => p.shapes).filter((q) => !q.cut);
  if (targets.rounded !== undefined) {
    const share = prims.filter((q) => ROUNDED.has(q.type)).length / Math.max(1, prims.length);
    check(share >= targets.rounded, "rounded forms", "parts", `only ${Math.round(share * 100)}% of the primitives are rounded`, `${brief.mood} reads best with mostly ellipsoids and capsules (aim for ${Math.round(targets.rounded * 100)}%+)`);
  }
  if (targets.spikes) {
    const spikes = prims.filter((q) => q.type === "cone" || q.type === "wedge").length;
    const [lo, hi] = targets.spikes;
    check(spikes >= lo && spikes <= hi, `${spikes} sharp forms`, "parts", `${spikes} cones/wedges; ${brief.mood} wants ${lo}${hi < 99 ? `–${hi}` : "+"}`, spikes < lo ? "add horns, spines or claws (cones)" : "trade some cones for rounded forms");
  }
  if (targets.mainLight && design.colors?.main) {
    const P = std.art.palette as Record<string, string>;
    const l = lum(P[design.colors.main] ?? "#808080");
    check(l >= targets.mainLight[0] && l <= targets.mainLight[1], "main colour suits the mood", "colors.main", `main colour brightness ${l.toFixed(2)}`, `${brief.mood} reads best with a darker main colour (≤ ${targets.mainLight[1]})`);
  }
  check(prims.length >= 6 && prims.length <= 48, `${prims.length} primitives`, "parts", `${prims.length} primitives`, prims.length < 6 ? "add a few details that read from 20 m (eyes, a contrasting belly, a crest)" : "simplify: fewer, larger forms read better");
  return { score: Math.round((passed.length / Math.max(1, checks)) * 100), passed, issues };
}

/** A skill as a SKILL.md document, for chat apps and agents that load skills. */
export function skillMarkdown(skill: Skill): string {
  const roles = skill.parts.map((p) => `- \`${p.role}\`${p.required ? " (required)" : ""}: ${p.why}`).join("\n");
  const moods = MOODS.filter((m) => m !== "neutral").map((m) => {
    const t = MOOD_TARGETS[m];
    const nums = [t.headRatio ? `head ratio ${t.headRatio[0]}–${t.headRatio[1]}` : "", t.rounded ? `${Math.round(t.rounded * 100)}%+ rounded primitives` : "", t.spikes ? `${t.spikes[0]}${t.spikes[1] < 99 ? `–${t.spikes[1]}` : "+"} cones/wedges` : ""].filter(Boolean).join(", ");
    return `- **${m}**${nums ? ` (${nums})` : ""}: ${t.guidance.join(" ")}`;
  }).join("\n");
  const styles = Object.entries(skill.styles).map(([s, n]) => `- **${s}**: ${n}`).join("\n");
  return `---
name: lfg2-${skill.id}
description: Design a ${skill.name.toLowerCase()} for LFG2 as a shape (parts of primitives). ${skill.description}
---

# ${skill.name}

${skill.description}

## How to make one

${skill.guidance.map((g) => `- ${g}`).join("\n")}

## Parts and animation roles

${roles}

## Moods

${moods}

## Styles

${styles || "- (no special notes)"}

## The loop

1. \`interpret_prompt\` with the player's words: you get a brief (skill, mood, style, size, colours, what must read from 20 m) and a starting design from this skill's template.
2. Change the starting design to fit the request: proportions for the mood first, then the features that must read, then colours and finishes.
3. \`check_design\` with the prompt: rule checks must pass; the critique scores it against this skill.
4. \`render_design\` (try \`style: "sculpted"\` for the close-up look) and compare with the brief. Fix, repeat.
5. \`save_design\`.

## Starting shape

\`\`\`json
${JSON.stringify(skill.template, null, 1)}
\`\`\`
`;
}

/**
 * A planned summon drawn in the sculpted style needs a shape (the generators make voxels only).
 * Give it the skill's starting design for its words (mood applied, features added), so a quick
 * "/summon a sculpted wolf" gets blended forms too. Clouds, ships and costumed humanoids (their
 * generators know hats, armour and swords) keep their generator, drawn smooth.
 */
export function shapeForSculpting(spec: SummonSpec, prompt: string, std: Standards): SummonSpec {
  if (spec.shape || spec.body === "cloud" || spec.body === "ship") return spec;
  if (spec.body === "biped" && spec.features.length) return spec;
  const r = interpretPrompt(prompt, std);
  if ("error" in r || !r.skill.bodies.includes(spec.body) || !r.start.shape) return spec;
  return { ...spec, shape: r.start.shape };
}

/** What the skin is like up close, from the body and what it's made of. */
function surfaceFor(template: string | undefined, skill: string, materials: string[]): Surface {
  if (materials.some((m) => ["robot", "ice", "crystal", "ghostly", "golden", "water", "rainbow"].includes(m))) return "smooth";
  if (materials.includes("stone")) return "hide";
  const t = template ?? "";
  if (["canine", "feline", "ursine", "rodent", "lagomorph", "raptor", "songbird", "longtail", "owl"].includes(t)) return "fur";
  if (["reptile", "saurian", "theropod", "dragon", "serpent", "frog", "turtle"].includes(t) || skill === "serpent" || skill === "swimmer" && t !== "mermaid") return t === "frog" ? "smooth" : "scales";
  if (["person", "hero", "elf", "dwarf", "goblin", "orc", "mage", "zombie"].includes(t)) return "cloth";
  if (["slime", "jellyfish", "snowman", "elemental", "mushroom", "skeleton", "snail"].includes(t) || skill === "floating-spirit" || skill === "tentacled") return "smooth";
  return "hide";
}
