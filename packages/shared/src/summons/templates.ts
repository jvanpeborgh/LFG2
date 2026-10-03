/**
 * Starting shapes for the design skills: one per archetype, plus variants for creatures that share
 * a skill but not a body (a snail and a turtle are both "shelled"; a frog is a four-legged creature
 * built for hopping). Each is a complete, valid shape in its own units; interpretPrompt scales it to
 * the creature's length, pushes it towards the mood and adds the features asked for.
 */
import type { ShapeSpec } from "./shape";
import { ANATOMY_TEMPLATES, BIRD_TEMPLATES, DRAGON_TEMPLATE, PEOPLE_TEMPLATES, SAURIAN_TEMPLATE, THEROPOD_TEMPLATE } from "./anatomy";

const v = (x: number, y: number, z: number): [number, number, number] => [x, y, z];
const eyes = (x: number, y: number, z: number, s = 0.14) => [
  { type: "ellipsoid" as const, at: v(x, y, z), size: v(s, s * 1.1, s * 0.7), color: "neutral8", mirror: true },
  { type: "ellipsoid" as const, at: v(x + s * 0.12, y, z + s * 0.3), size: v(s * 0.55, s * 0.65, s * 0.4), color: "neutral1", mirror: true },
];

/** Natural eyes: a coloured iris (gold for frogs and octopuses) with a dark pupil, round or slit. */
const natEyes = (x: number, y: number, z: number, s: number, iris: string, slit = false) => [
  { type: "ellipsoid" as const, at: v(x, y, z), size: v(s, s, s * 0.9), color: iris, finish: "gloss" as const, mirror: true },
  { type: "ellipsoid" as const, at: v(x + s * 0.06, y, z + s * 0.4), size: slit ? v(s * 0.6, s * 0.28, s * 0.2) : v(s * 0.45, s * 0.45, s * 0.2), color: "neutral1", finish: "gloss" as const, mirror: true },
];

export const TEMPLATES: Record<string, ShapeSpec> = {
  // Four-legged bodies built from proportions (anatomy.ts): equine, cervine, canine, feline, ursine...
  ...ANATOMY_TEMPLATES,
  // People built from proportions: person, hero, elf, dwarf, goblin, orc, mage.
  ...PEOPLE_TEMPLATES,
  // Birds (raptor, songbird, longtail) and a dragon on four legs.
  ...BIRD_TEMPLATES,
  dragon: DRAGON_TEMPLATE,
  saurian: SAURIAN_TEMPLATE,
  theropod: THEROPOD_TEMPLATE,
  // ------------------------------------------------------------- crawlers: six legs (eight with a mirror pair more)
  crawler: {
    parts: [
      { name: "body", anim: "body", shapes: [
        { type: "ellipsoid", at: v(0, 0.6, -0.4), size: v(0.95, 0.65, 1.05), color: "main" },
        { type: "ellipsoid", at: v(0, 0.58, 0.3), size: v(0.6, 0.45, 0.55), color: "main" },
        { type: "ellipsoid", at: v(0, 0.48, -0.4), size: v(0.75, 0.4, 0.85), color: "belly" },
      ] },
      { name: "head", anim: "head", pivot: v(0, 0.6, 0.55), shapes: [
        { type: "ellipsoid", at: v(0, 0.62, 0.75), size: v(0.42, 0.36, 0.38), color: "main" },
        ...eyes(0.11, 0.7, 0.88, 0.12),
      ] },
      { name: "front leg", anim: "legL", mirror: true, pivot: v(0.22, 0.58, 0.4), shapes: [
        { type: "tube", at: v(0, 0, 0), size: v(0, 0, 0), points: [v(0.22, 0.58, 0.4), v(0.65, 0.9, 0.65), v(0.95, 0.03, 0.9)], radius: [0.065, 0.035], color: "accent" },
      ] },
      { name: "middle leg", anim: "legR", mirror: true, pivot: v(0.28, 0.58, 0.2), shapes: [
        { type: "tube", at: v(0, 0, 0), size: v(0, 0, 0), points: [v(0.28, 0.58, 0.2), v(0.8, 0.92, 0.2), v(1.15, 0.03, 0.15)], radius: [0.065, 0.035], color: "accent" },
      ] },
      { name: "back leg", anim: "legL", mirror: true, pivot: v(0.28, 0.58, 0.0), shapes: [
        { type: "tube", at: v(0, 0, 0), size: v(0, 0, 0), points: [v(0.28, 0.58, 0.0), v(0.75, 0.9, -0.3), v(1.0, 0.03, -0.6)], radius: [0.065, 0.035], color: "accent" },
      ] },
    ],
  },
  // ------------------------------------------------------------- serpents: a head and a long chained body
  serpent: {
    blend: 0.08,
    parts: [
      { name: "body", anim: "body", shapes: [
        { type: "ellipsoid", at: v(0, 0.2, 0.6), size: v(0.34, 0.3, 0.6), color: "main" },
        { type: "ellipsoid", at: v(0, 0.12, 0.6), size: v(0.26, 0.14, 0.55), color: "belly" },
      ] },
      { name: "head", anim: "head", pivot: v(0, 0.25, 0.85), shapes: [
        { type: "ellipsoid", at: v(0, 0.27, 1.05), size: v(0.36, 0.24, 0.48), color: "main" },
        ...eyes(0.12, 0.34, 1.12, 0.1),
        { type: "box", at: v(0, 0.21, 1.31), size: v(0.03, 0.02, 0.14), color: "red3" },
      ] },
      { name: "tail", anim: "tail", pivot: v(0, 0.2, 0.4), shapes: [
        { type: "tube", at: v(0, 0, 0), size: v(0, 0, 0), points: [v(0, 0.2, 0.42), v(0.16, 0.18, 0), v(-0.16, 0.17, -0.45), v(0.13, 0.15, -0.9), v(0, 0.12, -1.3)], radius: [0.16, 0.04], color: "main" },
      ] },
    ],
  },
  // ------------------------------------------------------------- shelled: a turtle (and a snail variant)
  turtle: {
    blend: 0.05,
    parts: [
      { name: "body", anim: "body", shapes: [
        { type: "ellipsoid", at: v(0, 0.55, 0), size: v(1.1, 0.64, 1.3), color: "main" },
        { type: "ellipsoid", at: v(0, 0.36, 0), size: v(1.2, 0.12, 1.4), color: "main-1" },
        { type: "ellipsoid", at: v(0, 0.3, 0), size: v(1.0, 0.18, 1.2), color: "belly" },
        // Scutes: a ridge of plates down the middle, flanked by more on each side.
        { type: "ellipsoid", at: v(0, 0.86, 0.36), size: v(0.34, 0.2, 0.32), color: "accent", paint: true, blend: 0.03, repeat: { count: 3, offset: v(0, 0.02, -0.36) } },
        { type: "ellipsoid", at: v(0.36, 0.74, 0.22), size: v(0.3, 0.26, 0.3), rotate: v(0, 0, -30), color: "accent", paint: true, blend: 0.03, mirror: true, repeat: { count: 2, offset: v(0, 0, -0.42) } },
        { type: "cone", axis: "z", at: v(0, 0.36, -0.7), size: v(0.1, 0.08, 0.16), rotate: v(0, 180, 0), color: "accent" },
      ] },
      { name: "head", anim: "head", pivot: v(0, 0.42, 0.58), shapes: [
        { type: "ellipsoid", at: v(0, 0.5, 0.9), size: v(0.26, 0.22, 0.32), color: "accent" },
        { type: "tube", at: v(0, 0.44, 0.7), size: v(0.2, 0.2, 0.3), points: [v(0, 0.4, 0.55), v(0, 0.46, 0.8)], radius: 0.11, color: "accent" },
        { type: "box", at: v(0, 0.46, 1.0), size: v(0.2, 0.015, 0.14), color: "neutral1", paint: true },
        ...natEyes(0.1, 0.55, 0.96, 0.055, "orange2"),
      ] },
      { name: "front leg", anim: "legL", mirror: true, pivot: v(0.42, 0.32, 0.4), shapes: [
        { type: "capsule", at: v(0.46, 0.18, 0.46), size: v(0.17, 0.32, 0.19), color: "accent" },
        { type: "ellipsoid", at: v(0.47, 0.04, 0.5), size: v(0.2, 0.06, 0.22), color: "accent" },
      ] },
      { name: "back leg", anim: "legR", mirror: true, pivot: v(0.42, 0.32, -0.4), shapes: [
        { type: "capsule", at: v(0.46, 0.18, -0.44), size: v(0.18, 0.32, 0.2), color: "accent" },
        { type: "ellipsoid", at: v(0.47, 0.04, -0.42), size: v(0.21, 0.06, 0.22), color: "accent" },
      ] },
    ],
  },
  snail: {
    blend: 0.05,
    parts: [
      { name: "body", anim: "body", shapes: [
        { type: "capsule", axis: "z", at: v(0, 0.13, 0.05), size: v(0.34, 0.22, 1.15), taper: 0.8, color: "belly" },
        // The shell: a spiral of shrinking whorls.
        { type: "torus", axis: "x", at: v(0, 0.5, -0.12), size: v(0.34, 0.8, 0.8), color: "main" },
        { type: "torus", axis: "x", at: v(0.07, 0.52, -0.1), size: v(0.26, 0.48, 0.48), color: "main-1" },
        { type: "ellipsoid", at: v(0.12, 0.53, -0.09), size: v(0.2, 0.2, 0.2), color: "main" },
        { type: "ellipsoid", at: v(0.16, 0.53, -0.09), size: v(0.1, 0.1, 0.1), color: "main-2" },
        { type: "ellipsoid", at: v(0, 0.5, -0.12), size: v(0.3, 0.72, 0.72), color: "main" },
      ] },
      { name: "head", anim: "head", pivot: v(0, 0.2, 0.45), shapes: [
        { type: "tube", at: v(0, 0.25, 0.55), size: v(0.2, 0.2, 0.2), points: [v(0, 0.14, 0.45), v(0, 0.3, 0.6)], radius: [0.13, 0.11], color: "belly" },
        { type: "tube", at: v(0, 0.5, 0.65), size: v(0.2, 0.3, 0.1), points: [v(0.06, 0.36, 0.63), v(0.12, 0.62, 0.7)], radius: [0.025, 0.018], color: "belly", mirror: true },
        { type: "ellipsoid", at: v(0.12, 0.64, 0.71), size: v(0.05, 0.05, 0.05), color: "neutral1", finish: "gloss", mirror: true },
        { type: "tube", at: v(0, 0.3, 0.7), size: v(0.1, 0.1, 0.1), points: [v(0.05, 0.28, 0.68), v(0.09, 0.24, 0.78)], radius: [0.02, 0.012], color: "belly", mirror: true },
      ] },
    ],
  },
  // ------------------------------------------------------------- tentacled: a mantle and chained tentacles
  tentacled: {
    blend: 0.08,
    parts: [
      { name: "body", anim: "body", shapes: [
        { type: "ellipsoid", at: v(0, 1.12, -0.28), size: v(0.8, 0.95, 1.05), rotate: v(-32, 0, 0), color: "main" },
        { type: "ellipsoid", at: v(0, 0.78, 0.12), size: v(0.76, 0.58, 0.66), color: "main" },
        { type: "ellipsoid", at: v(0.2, 1.25, -0.35), size: v(0.14, 0.12, 0.16), color: "main-1", paint: true, blend: 0.03, mirror: true, repeat: { count: 3, offset: v(-0.06, -0.15, 0.08) } },
        { type: "ellipsoid", at: v(0.3, 0.9, 0.24), size: v(0.18, 0.2, 0.18), color: "main", mirror: true },
        ...natEyes(0.33, 0.9, 0.27, 0.13, "yellow4", true),
      ] },
      ...[20, 62, 110, 158].map((a, i) => {
        const r = (a * Math.PI) / 180, sx = Math.sin(r), cz = Math.cos(r);
        const at = (k: number, y: number) => v(sx * k, y, 0.05 + cz * k);
        const pts = [at(0.2, 0.6), at(0.55, 0.2), at(0.95, 0.06), at(1.25, 0.12), at(1.32, 0.3)];
        return { name: `tentacle ${i + 1}`, anim: "tentacle" as const, mirror: true, pivot: pts[0], shapes: [
          { type: "tube" as const, at: v(0, 0, 0), size: v(0, 0, 0), points: pts, radius: [0.12, 0.02] as [number, number], color: "main" },
          { type: "tube" as const, at: v(0, 0, 0), size: v(0, 0, 0), points: pts.map(([x, y, z]) => v(x, y - 0.04, z)), radius: [0.09, 0.015] as [number, number], color: "belly", paint: true },
        ] };
      }),
    ],
  },
  jellyfish: {
    blend: 0.1,
    parts: [
      { name: "body", anim: "body", shapes: [
        { type: "ellipsoid", at: v(0, 1.45, 0), size: v(1.25, 0.85, 1.25), color: "main", finish: "glow" },
        { type: "ellipsoid", at: v(0, 1.1, 0), size: v(1.05, 0.3, 1.05), color: "main", cut: true },
        { type: "torus", at: v(0, 1.12, 0), size: v(1.22, 0.08, 1.22), color: "accent", finish: "glow" },
        { type: "ellipsoid", at: v(0, 1.4, 0), size: v(0.55, 0.4, 0.55), color: "accent", finish: "glow" },
        { type: "ellipsoid", at: v(0.18, 1.62, 0.3), size: v(0.18, 0.1, 0.18), color: "belly", paint: true, finish: "glow", mirror: true },
      ] },
      // Frilly oral arms in the middle: twisted, wavy ribbons.
      { name: "oral arm", anim: "tail", mirror: true, pivot: v(0.08, 1.15, 0.05), shapes: [
        { type: "tube", at: v(0, 0, 0), size: v(0, 0, 0), points: [v(0.08, 1.15, 0.05), v(0.16, 0.85, 0.1), v(0.06, 0.6, 0.02), v(0.15, 0.35, 0.08)], radius: [0.09, 0.04], color: "accent", finish: "gloss" },
      ] },
      // Long, thin, wavy tendrils around the rim.
      { name: "tendril", anim: "tail", mirror: true, pivot: v(0.45, 1.12, 0.2), shapes: [
        { type: "tube", at: v(0, 0, 0), size: v(0, 0, 0), points: [v(0.45, 1.12, 0.2), v(0.52, 0.85, 0.28), v(0.42, 0.58, 0.22), v(0.53, 0.32, 0.3), v(0.46, 0.06, 0.24)], radius: [0.035, 0.015], color: "belly" },
      ] },
      { name: "back tendril", anim: "tail", mirror: true, pivot: v(0.38, 1.12, -0.32), shapes: [
        { type: "tube", at: v(0, 0, 0), size: v(0, 0, 0), points: [v(0.38, 1.12, -0.32), v(0.3, 0.82, -0.4), v(0.4, 0.55, -0.34), v(0.3, 0.3, -0.42), v(0.38, 0.08, -0.36)], radius: [0.035, 0.015], color: "belly" },
      ] },
      { name: "front tendril", anim: "tail", pivot: v(0, 1.12, 0.5), shapes: [
        { type: "tube", at: v(0, 0, 0), size: v(0, 0, 0), points: [v(0, 1.12, 0.5), v(0.06, 0.82, 0.58), v(-0.04, 0.52, 0.5), v(0.05, 0.22, 0.58)], radius: [0.035, 0.015], color: "belly" },
      ] },
    ],
  },
  // ------------------------------------------------------------- walking birds: penguins, chickens, ducks, owls
  "walking-bird": {
    blend: 0.05,
    parts: [
      { name: "body", anim: "body", shapes: [
        { type: "ellipsoid", at: v(0, 0.72, 0), size: v(0.72, 1.18, 0.64), color: "main" },
        { type: "ellipsoid", at: v(0, 0.66, 0.12), size: v(0.56, 0.98, 0.48), color: "belly", paint: true, blend: 0.04 },
        { type: "cone", axis: "z", at: v(0, 0.3, -0.36), size: v(0.26, 0.1, 0.22), rotate: v(0, 180, 0), color: "main" },
      ] },
      { name: "head", anim: "head", pivot: v(0, 1.15, 0), shapes: [
        { type: "ellipsoid", at: v(0, 1.38, 0.03), size: v(0.46, 0.44, 0.48), color: "main" },
        { type: "cone", axis: "z", at: v(0, 1.33, 0.33), size: v(0.1, 0.08, 0.26), color: "accent" },
        { type: "ellipsoid", at: v(0, 1.3, 0.12), size: v(0.3, 0.16, 0.3), color: "belly", paint: true, blend: 0.03 },
        ...natEyes(0.13, 1.44, 0.17, 0.045, "neutral2"),
      ] },
      { name: "wing", anim: "wingL", mirror: true, pivot: v(0.34, 1.0, 0), shapes: [
        { type: "ellipsoid", at: v(0.38, 0.74, -0.02), size: v(0.09, 0.66, 0.3), rotate: v(6, 0, 12), color: "main" },
      ] },
      { name: "leg", anim: "legL", mirror: true, pivot: v(0.15, 0.24, 0), shapes: [
        { type: "cylinder", at: v(0.15, 0.13, 0), size: v(0.07, 0.24, 0.07), color: "accent" },
        { type: "ellipsoid", at: v(0.15, 0.02, 0.09), size: v(0.18, 0.04, 0.24), color: "accent" },
      ] },
    ],
  },
  // ------------------------------------------------------------- owls: upright, round, all face
  owl: {
    blend: 0.06,
    parts: [
      { name: "body", anim: "body", shapes: [
        { type: "ellipsoid", at: v(0, 0.62, 0), size: v(0.78, 0.95, 0.7), color: "main" },
        { type: "ellipsoid", at: v(0, 0.55, 0.16), size: v(0.56, 0.72, 0.45), color: "belly" },
        { type: "ellipsoid", at: v(0, 0.52, 0.37), size: v(0.07, 0.07, 0.04), color: "accent", paint: true, mirror: false, repeat: { count: 3, offset: v(0, -0.14, -0.01) } },
      ] },
      { name: "head", anim: "head", pivot: v(0, 1.0, 0), shapes: [
        { type: "ellipsoid", at: v(0, 1.22, 0.02), size: v(0.72, 0.6, 0.6), color: "main" },
        // The facial disc: two pale rings around the eyes.
        { type: "ellipsoid", at: v(0.15, 1.24, 0.24), size: v(0.3, 0.32, 0.16), color: "belly", mirror: true },
        ...eyes(0.15, 1.26, 0.31, 0.17),
      ] },
      { name: "wing", anim: "wingL", mirror: true, pivot: v(0.34, 0.95, 0), shapes: [
        { type: "ellipsoid", at: v(0.37, 0.6, -0.04), size: v(0.14, 0.75, 0.52), rotate: v(8, 0, 6), color: "main" },
        { type: "ellipsoid", at: v(0.38, 0.3, -0.12), size: v(0.12, 0.3, 0.36), rotate: v(8, 0, 6), color: "accent", paint: true },
      ] },
      { name: "leg", anim: "legL", mirror: true, pivot: v(0.15, 0.2, 0.05), shapes: [
        { type: "ellipsoid", at: v(0.15, 0.06, 0.12), size: v(0.18, 0.1, 0.22), color: "yellow4" },
      ] },
    ],
  },
  // ------------------------------------------------------------- snowmen: three balls, stick arms, coal eyes
  snowman: {
    blend: 0.04,
    parts: [
      { name: "body", anim: "body", shapes: [
        { type: "ellipsoid", at: v(0, 0.5, 0), size: v(0.95, 0.88, 0.95), color: "main", finish: "gloss" },
        { type: "ellipsoid", at: v(0, 1.18, 0), size: v(0.7, 0.66, 0.7), color: "main", finish: "gloss" },
        { type: "ellipsoid", at: v(0, 1.3, 0.33), size: v(0.08, 0.08, 0.06), color: "neutral1", repeat: { count: 3, offset: v(0, -0.17, 0.0) } },
        { type: "torus", at: v(0, 1.5, 0), size: v(0.5, 0.11, 0.5), color: "accent" },
      ] },
      { name: "head", anim: "head", pivot: v(0, 1.5, 0), shapes: [
        { type: "ellipsoid", at: v(0, 1.75, 0), size: v(0.5, 0.48, 0.5), color: "main", finish: "gloss" },
        { type: "ellipsoid", at: v(0.1, 1.82, 0.22), size: v(0.07, 0.07, 0.05), color: "neutral1", mirror: true },
        { type: "ellipsoid", at: v(0.05, 1.62, 0.23), size: v(0.04, 0.04, 0.03), color: "neutral1", mirror: true, repeat: { count: 2, offset: v(0.05, 0.015, -0.02) } },
      ] },
      { name: "arm", anim: "armL", mirror: true, pivot: v(0.3, 1.25, 0), shapes: [
        { type: "tube", at: v(0, 0, 0), size: v(0, 0, 0), points: [v(0.28, 1.25, 0), v(0.55, 1.4, 0.05), v(0.78, 1.6, 0.0)], radius: [0.035, 0.02], color: "orange1" },
        { type: "tube", at: v(0, 0, 0), size: v(0, 0, 0), points: [v(0.62, 1.47, 0.03), v(0.72, 1.4, 0.12)], radius: 0.018, color: "orange1" },
      ] },
      { name: "foot", anim: "legL", mirror: true, pivot: v(0.2, 0.15, 0), shapes: [
        { type: "ellipsoid", at: v(0.2, 0.08, 0.05), size: v(0.3, 0.16, 0.34), color: "main", finish: "gloss" },
      ] },
    ],
  },
  // ------------------------------------------------------------- brutes: golems, trolls, ogres (hunched, huge arms, small head)
  brute: {
    blend: 0.06,
    parts: [
      { name: "body", anim: "body", shapes: [
        { type: "capsule", at: v(0, 1.3, 0), size: v(1.3, 1.15, 0.85), color: "main" },
        { type: "ellipsoid", at: v(0, 1.1, 0.2), size: v(0.95, 0.8, 0.5), color: "belly" },
        { type: "ellipsoid", at: v(0.52, 1.66, 0), size: v(0.62, 0.5, 0.62), color: "main", mirror: true },
      ] },
      // The head sits forward of the shoulders, not between them (brutes are hunched).
      { name: "head", anim: "head", pivot: v(0, 1.85, 0.35), shapes: [
        { type: "ellipsoid", at: v(0, 2.12, 0.62), size: v(0.55, 0.52, 0.52), color: "main" },
        { type: "box", at: v(0, 2.24, 0.85), size: v(0.48, 0.09, 0.12), round: 0.03, color: "main" },
        { type: "ellipsoid", at: v(0, 1.98, 0.74), size: v(0.46, 0.22, 0.38), color: "main" },
        ...eyes(0.12, 2.15, 0.86, 0.1),
      ] },
      { name: "arm", anim: "armL", mirror: true, pivot: v(0.75, 1.75, 0), shapes: [
        { type: "capsule", at: v(0.85, 1.25, 0.05), size: v(0.38, 0.95, 0.38), color: "main" },
        { type: "ellipsoid", at: v(0.88, 0.64, 0.12), size: v(0.46, 0.42, 0.46), color: "main" },
      ] },
      { name: "leg", anim: "legL", mirror: true, pivot: v(0.3, 0.75, 0), shapes: [
        { type: "capsule", at: v(0.32, 0.42, 0), size: v(0.42, 0.85, 0.45), color: "main" },
        { type: "ellipsoid", at: v(0.33, 0.08, 0.1), size: v(0.46, 0.16, 0.55), color: "main" },
      ] },
    ],
  },
  // ------------------------------------------------------------- skeletons: bones (thin limbs, ribs, a skull with dark sockets)
  skeleton: {
    blend: 0.02,
    parts: [
      { name: "body", anim: "body", shapes: [
        { type: "cylinder", at: v(0, 1.2, -0.05), size: v(0.08, 0.8, 0.08), color: "main" },
        { type: "torus", at: v(0, 1.48, 0), size: v(0.5, 0.05, 0.36), color: "main", repeat: { count: 4, offset: v(0, -0.11, 0), scale: 0.9 } },
        { type: "capsule", axis: "x", at: v(0, 1.6, 0), size: v(0.7, 0.09, 0.09), color: "main" },
        { type: "ellipsoid", at: v(0, 0.86, 0), size: v(0.45, 0.18, 0.28), color: "main" },
      ] },
      { name: "head", anim: "head", pivot: v(0, 1.65, 0), shapes: [
        { type: "ellipsoid", at: v(0, 1.92, 0.02), size: v(0.46, 0.46, 0.48), color: "main" },
        { type: "box", at: v(0, 1.73, 0.1), size: v(0.3, 0.12, 0.28), round: 0.04, color: "main" },
        { type: "ellipsoid", at: v(0.1, 1.92, 0.22), size: v(0.13, 0.14, 0.09), color: "neutral1", mirror: true },
        { type: "cone", at: v(0, 1.82, 0.25), size: v(0.06, 0.07, 0.04), rotate: v(180, 0, 0), color: "neutral1" },
      ] },
      { name: "arm", anim: "armL", mirror: true, pivot: v(0.36, 1.58, 0), shapes: [
        { type: "tube", at: v(0, 0, 0), size: v(0, 0, 0), points: [v(0.36, 1.58, 0), v(0.42, 1.2, 0.02), v(0.44, 0.86, 0.08)], radius: 0.04, color: "main" },
        { type: "ellipsoid", at: v(0.44, 0.78, 0.1), size: v(0.1, 0.15, 0.08), color: "main" },
      ] },
      { name: "leg", anim: "legL", mirror: true, pivot: v(0.14, 0.84, 0), shapes: [
        { type: "tube", at: v(0, 0, 0), size: v(0, 0, 0), points: [v(0.14, 0.84, 0), v(0.15, 0.46, 0.03), v(0.15, 0.08, 0)], radius: 0.05, color: "main" },
        { type: "ellipsoid", at: v(0.15, 0.04, 0.08), size: v(0.13, 0.07, 0.25), color: "main" },
      ] },
    ],
  },
  // ------------------------------------------------------------- zombies: shambling people, arms out in front
  zombie: {
    parts: [
      { name: "body", anim: "body", shapes: [
        { type: "capsule", at: v(0, 1.15, 0), size: v(0.7, 0.85, 0.45), color: "main" },
        { type: "box", at: v(0.12, 0.9, 0.2), size: v(0.2, 0.25, 0.1), rotate: v(0, 0, 25), color: "belly", paint: true },
        { type: "capsule", at: v(0, 1.6, 0), size: v(0.2, 0.28, 0.2), color: "belly" },
      ] },
      { name: "head", anim: "head", pivot: v(0, 1.6, 0), shapes: [
        { type: "ellipsoid", at: v(0, 1.85, 0.05), size: v(0.52, 0.55, 0.5), rotate: v(0, 0, 8), color: "belly" },
        { type: "ellipsoid", at: v(0.11, 1.9, 0.29), size: v(0.11, 0.12, 0.07), color: "neutral1", mirror: true },
        { type: "box", at: v(0, 1.7, 0.29), size: v(0.2, 0.05, 0.05), round: 0.015, color: "neutral1" },
        { type: "ellipsoid", at: v(0, 2.04, -0.04), size: v(0.5, 0.2, 0.5), color: "neutral2" },
      ] },
      { name: "arm", anim: "armL", mirror: true, pivot: v(0.42, 1.45, 0), shapes: [
        { type: "capsule", axis: "z", at: v(0.42, 1.42, 0.35), size: v(0.19, 0.19, 0.72), color: "main" },
        { type: "ellipsoid", at: v(0.42, 1.4, 0.74), size: v(0.16, 0.14, 0.2), color: "belly" },
      ] },
      { name: "leg", anim: "legL", mirror: true, pivot: v(0.17, 0.75, 0), shapes: [
        { type: "capsule", at: v(0.17, 0.4, 0), size: v(0.22, 0.8, 0.22), color: "neutral3" },
        { type: "box", at: v(0.17, 0.05, 0.06), size: v(0.22, 0.1, 0.32), color: "neutral2", blend: 0 },
      ] },
    ],
  },
  // ------------------------------------------------------------- slimes: a glossy dome that wobbles and hops
  slime: {
    blend: 0.12,
    parts: [
      { name: "body", anim: "body", shapes: [
        { type: "ellipsoid", at: v(0, 0.45, 0), size: v(1.2, 0.95, 1.1), color: "main", finish: "gloss" },
        { type: "ellipsoid", at: v(0, 0.12, 0), size: v(1.35, 0.28, 1.25), color: "main", finish: "gloss" },
        { type: "ellipsoid", at: v(-0.2, 0.75, 0.15), size: v(0.3, 0.16, 0.25), color: "belly", paint: true, finish: "glow" },
        { type: "ellipsoid", at: v(0.15, 0.4, -0.1), size: v(0.35, 0.35, 0.35), color: "accent", paint: true },
        ...eyes(0.2, 0.55, 0.5, 0.2),
        { type: "ellipsoid", at: v(0, 0.36, 0.53), size: v(0.18, 0.08, 0.05), color: "neutral1" },
      ] },
    ],
  },
  // ------------------------------------------------------------- cacti: a ribbed column with arms and a flower
  cactus: {
    blend: 0.05,
    parts: [
      { name: "body", anim: "body", shapes: [
        { type: "capsule", at: v(0, 0.95, 0), size: v(0.64, 1.6, 0.64), color: "main" },
        { type: "box", at: v(0, 0.95, 0), size: v(0.05, 1.7, 0.7), color: "belly", paint: true, repeat: { count: 3, offset: v(0, 0, 0), rotate: v(0, 60, 0) } },
        { type: "ellipsoid", at: v(0, 1.78, 0), size: v(0.34, 0.14, 0.34), color: "accent" },
        { type: "ellipsoid", at: v(0, 1.84, 0), size: v(0.12, 0.08, 0.12), color: "yellow4" },
        ...eyes(0.12, 1.22, 0.28, 0.12),
        { type: "ellipsoid", at: v(0, 1.02, 0.31), size: v(0.14, 0.06, 0.04), color: "neutral1" },
      ] },
      { name: "arm", anim: "armL", mirror: true, pivot: v(0.28, 1.0, 0), shapes: [
        { type: "tube", at: v(0, 0, 0), size: v(0, 0, 0), points: [v(0.25, 1.0, 0), v(0.58, 1.0, 0), v(0.62, 1.42, 0)], radius: 0.13, color: "main" },
      ] },
      { name: "foot", anim: "legL", mirror: true, pivot: v(0.15, 0.2, 0), shapes: [
        { type: "ellipsoid", at: v(0.16, 0.1, 0.04), size: v(0.24, 0.2, 0.3), color: "main" },
      ] },
    ],
  },
  // ------------------------------------------------------------- fairies: a tiny person with glowing wings
  fairy: {
    blend: 0.04,
    parts: [
      { name: "body", anim: "body", shapes: [
        { type: "cone", at: v(0, 0.95, 0), size: v(0.62, 0.75, 0.62), color: "main" },
        { type: "capsule", at: v(0, 1.33, 0), size: v(0.28, 0.42, 0.22), color: "main" },
      ] },
      { name: "head", anim: "head", pivot: v(0, 1.52, 0), shapes: [
        { type: "ellipsoid", at: v(0, 1.76, 0.02), size: v(0.5, 0.5, 0.48), color: "orange5" },
        { type: "ellipsoid", at: v(0, 1.84, -0.08), size: v(0.56, 0.5, 0.5), color: "accent" },
        ...eyes(0.1, 1.76, 0.22, 0.1),
      ] },
      { name: "wing", anim: "wingL", mirror: true, pivot: v(0.06, 1.4, -0.12), shapes: [
        { type: "ellipsoid", at: v(0.42, 1.68, -0.18), size: v(0.75, 0.9, 0.03), rotate: v(0, 25, -20), color: "belly", finish: "glow" },
        { type: "ellipsoid", at: v(0.32, 1.18, -0.16), size: v(0.45, 0.5, 0.03), rotate: v(0, 25, 30), color: "belly", finish: "glow" },
      ] },
      { name: "arm", anim: "armL", mirror: true, pivot: v(0.16, 1.48, 0), shapes: [
        { type: "capsule", at: v(0.2, 1.28, 0.02), size: v(0.1, 0.4, 0.1), color: "orange5" },
      ] },
      { name: "leg", anim: "legL", mirror: true, pivot: v(0.08, 0.62, 0), shapes: [
        { type: "capsule", at: v(0.09, 0.36, 0), size: v(0.1, 0.52, 0.1), color: "orange5" },
      ] },
    ],
  },
  // ------------------------------------------------------------- merfolk: a person above, a fish tail below
  mermaid: {
    blend: 0.05,
    parts: [
      { name: "body", anim: "body", shapes: [
        { type: "capsule", at: v(0, 1.25, 0), size: v(0.42, 0.6, 0.3), color: "orange5" },
        { type: "ellipsoid", at: v(0, 1.38, 0.06), size: v(0.44, 0.18, 0.3), color: "accent", finish: "gloss" },
        { type: "ellipsoid", at: v(0, 0.95, 0), size: v(0.44, 0.32, 0.34), color: "main", finish: "gloss" },
      ] },
      { name: "head", anim: "head", pivot: v(0, 1.55, 0), shapes: [
        { type: "ellipsoid", at: v(0, 1.75, 0.03), size: v(0.4, 0.44, 0.4), color: "orange5" },
        { type: "ellipsoid", at: v(0, 1.8, -0.06), size: v(0.48, 0.48, 0.42), color: "belly" },
        { type: "tube", at: v(0, 1.5, -0.2), size: v(0.4, 0.6, 0.3), points: [v(0, 1.78, -0.12), v(0, 1.5, -0.22), v(0, 1.2, -0.2)], radius: [0.2, 0.1], color: "belly" },
        ...eyes(0.08, 1.76, 0.2, 0.065),
      ] },
      { name: "tail", anim: "tail", pivot: v(0, 0.9, 0), shapes: [
        { type: "tube", at: v(0, 0.5, -0.4), size: v(0.4, 0.8, 0.9), points: [v(0, 0.9, 0), v(0, 0.55, -0.08), v(0, 0.32, -0.35), v(0, 0.24, -0.75)], radius: [0.2, 0.07], color: "main", finish: "gloss" },
        { type: "ellipsoid", at: v(0.15, 0.24, -0.88), size: v(0.36, 0.05, 0.3), rotate: v(0, 30, 0), color: "accent", finish: "gloss", mirror: true },
      ] },
      { name: "arm", anim: "armL", mirror: true, pivot: v(0.22, 1.45, 0), shapes: [
        { type: "capsule", at: v(0.26, 1.22, 0.04), size: v(0.1, 0.45, 0.1), color: "orange5" },
      ] },
    ],
  },
  // ------------------------------------------------------------- plant creatures: a mushroom (and a treant variant)
  mushroom: {
    blend: 0.05,
    parts: [
      { name: "body", anim: "body", shapes: [
        { type: "capsule", at: v(0, 0.55, 0), size: v(0.6, 0.9, 0.6), taper: 0.85, color: "belly" },
        { type: "ellipsoid", at: v(0, 1.15, 0), size: v(1.4, 0.75, 1.4), color: "main" },
        { type: "ellipsoid", at: v(0, 0.95, 0), size: v(1.25, 0.2, 1.25), color: "belly", cut: true },
        { type: "ellipsoid", at: v(0.35, 1.38, 0.2), size: v(0.2, 0.1, 0.2), color: "neutral8", mirror: true },
        { type: "ellipsoid", at: v(0, 1.5, -0.15), size: v(0.24, 0.1, 0.24), color: "neutral8" },
        { type: "ellipsoid", at: v(0.15, 1.3, -0.45), size: v(0.18, 0.1, 0.18), color: "neutral8", mirror: true },
        ...eyes(0.11, 0.65, 0.28, 0.12),
      ] },
      { name: "foot", anim: "legL", mirror: true, pivot: v(0.15, 0.2, 0), shapes: [
        { type: "ellipsoid", at: v(0.16, 0.08, 0.06), size: v(0.22, 0.16, 0.3), color: "belly" },
      ] },
    ],
  },
  treant: {
    blend: 0.06,
    parts: [
      { name: "body", anim: "body", shapes: [
        { type: "cylinder", at: v(0, 1.2, 0), size: v(0.75, 1.5, 0.65), taper: 0.8, color: "main" },
        { type: "ellipsoid", at: v(0, 2.35, 0), size: v(1.6, 1.0, 1.4), color: "accent" },
        { type: "ellipsoid", at: v(0.45, 2.65, -0.2), size: v(0.9, 0.7, 0.8), color: "accent", mirror: true },
        { type: "box", at: v(0, 1.55, 0.31), size: v(0.36, 0.08, 0.06), round: 0.03, color: "neutral1" },
        { type: "ellipsoid", at: v(0.13, 1.72, 0.3), size: v(0.12, 0.1, 0.08), color: "yellow4", finish: "glow", mirror: true },
      ] },
      { name: "branch", anim: "armL", mirror: true, pivot: v(0.35, 1.7, 0), shapes: [
        { type: "tube", at: v(0, 0, 0), size: v(0, 0, 0), points: [v(0.33, 1.7, 0), v(0.75, 1.55, 0.1), v(0.95, 1.05, 0.15)], radius: [0.13, 0.06], color: "main" },
        { type: "tube", at: v(0, 0, 0), size: v(0, 0, 0), points: [v(0.75, 1.55, 0.1), v(1.0, 1.75, 0.05)], radius: [0.05, 0.03], color: "main" },
        { type: "ellipsoid", at: v(1.02, 1.85, 0.05), size: v(0.35, 0.3, 0.35), color: "accent" },
      ] },
      { name: "root", anim: "legL", mirror: true, pivot: v(0.2, 0.55, 0), shapes: [
        { type: "tube", at: v(0, 0, 0), size: v(0, 0, 0), points: [v(0.2, 0.6, 0), v(0.3, 0.25, 0.08), v(0.42, 0.04, 0.2)], radius: [0.16, 0.08], color: "main" },
      ] },
    ],
  },
  // ------------------------------------------------------------- elementals: a glowing core, arms of the element, no legs
  elemental: {
    blend: 0.1,
    parts: [
      { name: "body", anim: "body", shapes: [
        { type: "ellipsoid", at: v(0, 1.25, 0), size: v(0.9, 1.0, 0.7), color: "main" },
        { type: "ellipsoid", at: v(0, 1.25, 0.12), size: v(0.5, 0.55, 0.4), color: "accent", finish: "glow" },
        { type: "cone", at: v(0, 0.5, 0), size: v(0.7, 0.9, 0.55), rotate: v(180, 0, 0), color: "main" },
        { type: "cone", at: v(0.25, 1.95, -0.1), size: v(0.22, 0.6, 0.22), rotate: v(-10, 0, -15), color: "accent", finish: "glow", mirror: true },
        { type: "cone", at: v(0, 2.05, -0.05), size: v(0.26, 0.7, 0.26), color: "accent", finish: "glow" },
      ] },
      { name: "head", anim: "head", pivot: v(0, 1.7, 0), shapes: [
        { type: "ellipsoid", at: v(0, 1.85, 0.05), size: v(0.5, 0.48, 0.45), color: "main" },
        { type: "ellipsoid", at: v(0.11, 1.88, 0.25), size: v(0.12, 0.08, 0.06), color: "neutral8", finish: "glow", mirror: true },
      ] },
      { name: "arm", anim: "armL", mirror: true, pivot: v(0.42, 1.5, 0), shapes: [
        { type: "tube", at: v(0, 0, 0), size: v(0, 0, 0), points: [v(0.4, 1.5, 0), v(0.7, 1.2, 0.1), v(0.78, 0.85, 0.2)], radius: [0.16, 0.1], color: "main" },
        { type: "ellipsoid", at: v(0.8, 0.8, 0.22), size: v(0.26, 0.26, 0.26), color: "accent", finish: "glow" },
      ] },
    ],
  },
  // ------------------------------------------------------------- four-legged variants
  reptile: {
    parts: [
      { name: "body", anim: "body", shapes: [
        { type: "capsule", axis: "z", at: v(0, 0.42, 0), size: v(0.75, 0.42, 1.5), color: "main" },
        { type: "capsule", axis: "z", at: v(0, 0.32, 0.05), size: v(0.6, 0.22, 1.3), color: "belly" },
        { type: "cone", at: v(0, 0.66, 0.45), size: v(0.06, 0.12, 0.12), color: "accent", repeat: { count: 6, offset: v(0, -0.01, -0.2), scale: 0.95 } },
      ] },
      { name: "head", anim: "head", pivot: v(0, 0.45, 0.75), shapes: [
        { type: "capsule", axis: "z", at: v(0, 0.45, 1.15), size: v(0.42, 0.26, 0.9), taper: [0.75, 0.6], color: "main" },
        ...eyes(0.13, 0.6, 0.95, 0.1),
        { type: "box", at: v(0, 0.37, 1.2), size: v(0.36, 0.02, 0.7), color: "neutral8" },
      ] },
      { name: "front leg", anim: "legL", mirror: true, pivot: v(0.3, 0.38, 0.5), shapes: [
        { type: "tube", at: v(0, 0, 0), size: v(0, 0, 0), points: [v(0.3, 0.38, 0.5), v(0.5, 0.25, 0.55), v(0.5, 0.04, 0.6)], radius: [0.1, 0.07], color: "main" },
      ] },
      { name: "back leg", anim: "legR", mirror: true, pivot: v(0.3, 0.38, -0.45), shapes: [
        { type: "tube", at: v(0, 0, 0), size: v(0, 0, 0), points: [v(0.3, 0.38, -0.45), v(0.52, 0.25, -0.5), v(0.52, 0.04, -0.4)], radius: [0.11, 0.07], color: "main" },
      ] },
      { name: "tail", anim: "tail", pivot: v(0, 0.4, -0.75), shapes: [
        { type: "tube", at: v(0, 0, 0), size: v(0, 0, 0), points: [v(0, 0.4, -0.72), v(0.1, 0.33, -1.2), v(-0.08, 0.25, -1.65), v(0, 0.18, -2.0)], radius: [0.22, 0.04], color: "main" },
      ] },
    ],
  },
  frog: {
    blend: 0.05,
    parts: [
      { name: "body", anim: "body", shapes: [
        { type: "ellipsoid", at: v(0, 0.4, -0.05), size: v(0.74, 0.46, 0.88), rotate: v(-16, 0, 0), color: "main" },
        { type: "ellipsoid", at: v(0, 0.3, 0.06), size: v(0.62, 0.32, 0.78), color: "belly", paint: true, blend: 0.05 },
        { type: "ellipsoid", at: v(0.18, 0.58, -0.12), size: v(0.14, 0.08, 0.16), color: "main-1", paint: true, blend: 0.02, mirror: true, repeat: { count: 2, offset: v(-0.08, -0.04, -0.2) } },
      ] },
      { name: "head", anim: "head", pivot: v(0, 0.48, 0.25), shapes: [
        { type: "ellipsoid", at: v(0, 0.53, 0.42), size: v(0.72, 0.34, 0.56), color: "main" },
        { type: "ellipsoid", at: v(0, 0.44, 0.45), size: v(0.68, 0.16, 0.52), color: "belly" },
        // The mouth: a thin dark line around the front of the jaw.
        { type: "torus", at: v(0, 0.485, 0.42), size: v(0.74, 0.02, 0.58), color: "main-2", paint: true },
        { type: "ellipsoid", at: v(0.2, 0.66, 0.46), size: v(0.2, 0.18, 0.2), color: "main", mirror: true },
        ...natEyes(0.22, 0.69, 0.5, 0.13, "yellow4", true),
        { type: "ellipsoid", at: v(0.05, 0.57, 0.69), size: v(0.025, 0.02, 0.02), color: "neutral1", mirror: true },
      ] },
      { name: "front leg", anim: "legL", mirror: true, pivot: v(0.2, 0.34, 0.33), shapes: [
        { type: "tube", at: v(0, 0, 0), size: v(0, 0, 0), points: [v(0.2, 0.34, 0.33), v(0.3, 0.16, 0.44), v(0.3, 0.03, 0.5)], radius: [0.06, 0.035], color: "main" },
        { type: "ellipsoid", at: v(0.32, 0.02, 0.56), size: v(0.16, 0.04, 0.14), color: "main" },
      ] },
      { name: "back leg", anim: "legR", mirror: true, pivot: v(0.24, 0.34, -0.3), shapes: [
        { type: "ellipsoid", at: v(0.33, 0.27, -0.2), size: v(0.22, 0.22, 0.42), rotate: v(0, -18, 0), color: "main" },
        { type: "tube", at: v(0, 0, 0), size: v(0, 0, 0), points: [v(0.32, 0.28, -0.36), v(0.44, 0.12, -0.04), v(0.4, 0.05, -0.34), v(0.38, 0.03, -0.04)], radius: [0.07, 0.035], color: "main" },
        { type: "ellipsoid", at: v(0.4, 0.02, 0.04), size: v(0.22, 0.03, 0.28), color: "main" },
      ] },
    ],
  },
};

/** Wings for insects (bees, wasps, dragonflies, flies): two clear, glossy pairs. */
export const INSECT_WINGS = [
  { type: "ellipsoid" as const, at: v(0.55, 1.35, 0.05), size: v(0.95, 0.03, 0.42), rotate: v(0, -20, 15), color: "neutral8", finish: "gloss" as const },
  { type: "ellipsoid" as const, at: v(0.45, 1.3, -0.25), size: v(0.7, 0.03, 0.32), rotate: v(0, 15, 12), color: "neutral7", finish: "gloss" as const },
];
