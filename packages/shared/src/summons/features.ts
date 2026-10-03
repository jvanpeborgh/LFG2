/**
 * The feature kit: what makes a species read. A unicorn is a horse with a spiral horn and a mane;
 * a bee is stripes, clear wings and a stinger; a crab is pincers and eye stalks. Each feature here
 * adds or reshapes primitives relative to the template's head and body, so it works at any size,
 * on any template, and in every style. interpretPrompt applies the bestiary's features (and the
 * modifiers') through this; agents can read the result and change anything.
 */
import type { ShapePartSpec, ShapePrimitive, ShapeSpec } from "./shape";
import { INSECT_WINGS } from "./templates";

type Vec3 = [number, number, number];
type Mood = "cute" | "menacing" | "heroic" | "elegant" | "comic" | "neutral";

interface Frame { part: ShapePartSpec; c: Vec3; s: Vec3 }
interface Kit {
  shape: ShapeSpec;
  skill: string;
  mood: Mood;
  has: (f: string) => boolean;
  head?: Frame;
  body?: Frame;
}

const frame = (p?: ShapePartSpec): Frame | undefined => (p && p.shapes[0] ? { part: p, c: p.shapes[0].at, s: p.shapes[0].size } : undefined);
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const isPart = (role: string) => (p: ShapePartSpec) => p.anim === role;
/** Small mirrored primitives on the front of the head: the eyes (whites and pupils). */
const eyeShapes = (h: Frame) => h.part.shapes.filter((q, i) => i > 0 && q.mirror && !q.cut && !q.paint && q.type === "ellipsoid" && Math.max(...q.size) < Math.max(...h.s) * 0.4 && q.at[2] > h.c[2]);
const pupils = (h: Frame) => eyeShapes(h).filter((q) => q.color === "neutral1");

/** A feathered wing from a shoulder pivot: a leading edge, the membrane, and a fan of tip feathers. */
export function featherWing(p: Vec3, span: number, chord: number): ShapePrimitive[] {
  return [
    { type: "tube", at: add(p, [span / 2, span * 0.1, 0]), size: [span, span * 0.3, chord], points: [p, add(p, [span * 0.45, span * 0.16, chord * 0.08]), add(p, [span, span * 0.22, -chord * 0.25])], radius: [chord * 0.11, chord * 0.035], color: "main" },
    { type: "ellipsoid", at: add(p, [span * 0.5, span * 0.1, -chord * 0.3]), size: [span * 0.95, chord * 0.07, chord], rotate: [0, -6, 10], color: "main" },
    // Primary feathers fanning along the trailing edge, in the accent colour (the flap reads).
    { type: "ellipsoid", at: add(p, [span * 0.32, span * 0.06, -chord * 0.72]), size: [chord * 0.24, chord * 0.05, chord * 0.85], rotate: [0, -6, 8], color: "accent", repeat: { count: 4, offset: [span * 0.17, span * 0.035, chord * 0.02], rotate: [0, -9, 0], scale: 1.04 } },
  ];
}

const FEATURES: Record<string, (k: Kit) => void> = {
  // ------------------------------------------------------------------ build (first: the others measure the result)
  heavy: ({ shape, body: b }) => {
    // Elephants, rhinos, bears: pillar legs and a bigger barrel.
    for (const p of shape.parts.filter((q) => /^leg/.test(q.anim ?? ""))) for (const q of p.shapes) {
      q.size = [q.size[0] * 1.7, q.size[1], q.size[2] * 1.6];
      if (q.taper !== undefined) q.taper = 0.95;
      // Pillar legs: as thick at the foot as at the top.
      if (Array.isArray(q.radius)) q.radius = [q.radius[0] * 1.6, q.radius[0] * 1.5];
    }
    if (b) for (const q of b.part.shapes.filter((q) => q.type === "ellipsoid")) q.size = [q.size[0] * 1.15, q.size[1] * 1.08, q.size[2]];
  },
  "dragon head": ({ head: h, body: b, mood }) => {
    // A neck reaching forward and a long snout: the head of a dragon, not a bird.
    if (!h || !b) return;
    const k = mood === "cute" ? 0.4 : 1;
    const pv = h.part.pivot ?? h.c;
    // Grown dragons have big heads for their bodies (the jaw is the threat).
    const g = mood === "cute" ? 1 : 1.35;
    for (const q of h.part.shapes) {
      q.at = [pv[0] + (q.at[0] - pv[0]) * g, pv[1] + (q.at[1] - pv[1]) * g, pv[2] + (q.at[2] - pv[2]) * g];
      q.size = [q.size[0] * g, q.size[1] * g, q.size[2] * g];
      if (q.points) q.points = q.points.map((pt) => [pv[0] + (pt[0] - pv[0]) * g, pv[1] + (pt[1] - pv[1]) * g, pv[2] + (pt[2] - pv[2]) * g] as Vec3);
      if (typeof q.radius === "number") q.radius *= g; else if (q.radius) q.radius = [q.radius[0] * g, q.radius[1] * g];
    }
    h.s = h.part.shapes[0].size; h.c = h.part.shapes[0].at;
    const dz = h.s[2] * 0.9 * k, dy = h.s[1] * 0.25 * k;
    for (const q of h.part.shapes) { q.at = add(q.at, [0, dy, dz]); if (q.points) q.points = q.points.map((pt) => add(pt, [0, dy, dz])); }
    h.part.pivot = add(pv, [0, dy, dz]);
    const [s0, s1, s2] = h.s, c = add(h.c, [0, dy, dz]);
    {
      b.part.shapes.push({ type: "tube", at: add(pv, [0, dy / 2, dz / 2]), size: [s0, s1, dz], points: [[0, b.c[1] + b.s[1] * 0.15, b.c[2] + b.s[2] * 0.35], add(pv, [0, dy * 0.6, dz * 0.4]), add(pv, [0, dy, dz])], radius: [b.s[0] * 0.28, s0 * 0.3], color: "main" });
      b.part.shapes.push({ type: "tube", at: add(pv, [0, dy / 2 - s1 * 0.2, dz / 2]), size: [s0, s1, dz], points: [[0, b.c[1] - b.s[1] * 0.05, b.c[2] + b.s[2] * 0.35], add(pv, [0, dy * 0.6 - s1 * 0.25, dz * 0.4])], radius: [b.s[0] * 0.2, s0 * 0.2], color: "belly", paint: true });
    }
    h.part.shapes.splice(1, 0,
      { type: "ellipsoid", at: [0, c[1] - s1 * 0.12, c[2] + s2 * 0.5], size: [s0 * 0.62, s1 * 0.5, s2 * 0.95 * (0.6 + 0.4 * k)], color: "main" },
      { type: "ellipsoid", at: [0, c[1] - s1 * 0.3, c[2] + s2 * 0.42], size: [s0 * 0.5, s1 * 0.22, s2 * 0.8 * (0.6 + 0.4 * k)], color: "belly" },
    );
    h.part.shapes.push({ type: "ellipsoid", at: [s0 * 0.12, c[1] - s1 * 0.02, c[2] + s2 * (0.5 + 0.45 * (0.6 + 0.4 * k))], size: [s0 * 0.07, s0 * 0.05, s0 * 0.05], color: "neutral1", mirror: true });
  },
  "long neck": ({ head: h, body: b }) => {
    if (!h || !b) return;
    const dy = h.s[1] * 2.2, dz = h.s[2] * 0.2;
    const pv = h.part.pivot ?? h.c;
    for (const q of h.part.shapes) { q.at = add(q.at, [0, dy, dz]); if (q.points) q.points = q.points.map((pt) => add(pt, [0, dy, dz])); }
    h.part.pivot = add(pv, [0, dy, dz]);
    const from: Vec3 = [0, b.c[1] + b.s[1] * 0.25, b.c[2] + b.s[2] * 0.3];
    b.part.shapes.push({ type: "tube", at: add(pv, [0, dy / 2, 0]), size: [h.s[0], dy, dz], points: [from, add(pv, [0, dy * 0.45, dz * 0.4 + h.s[2] * 0.05]), add(pv, [0, dy + h.s[1] * 0.1, dz])], radius: [b.s[0] * 0.22, h.s[0] * 0.26], color: "main" });
  },
  // ------------------------------------------------------------------ heads
  horn: ({ head: h }) => {
    if (!h) return;
    const L = h.s[1] * 0.95;
    h.part.shapes.push({ type: "cone", at: [0, h.c[1] + h.s[1] * 0.42 + L * 0.42, h.c[2] + h.s[2] * 0.18 + L * 0.2], size: [h.s[0] * 0.17, L, h.s[0] * 0.17], rotate: [26, 0, 0], twist: 900, color: "yellow5", finish: "gloss" });
  },
  "nose horn": ({ head: h }) => {
    if (!h) return;
    const L = h.s[1] * 0.95;
    h.part.shapes.push({ type: "cone", at: [0, h.c[1] + h.s[1] * 0.02 + L * 0.4, h.c[2] + h.s[2] * 0.58], size: [h.s[0] * 0.3, L, h.s[0] * 0.3], rotate: [-12, 0, 0], color: "neutral7" });
    h.part.shapes.push({ type: "cone", at: [0, h.c[1] + h.s[1] * 0.42, h.c[2] + h.s[2] * 0.05], size: [h.s[0] * 0.16, L * 0.4, h.s[0] * 0.16], rotate: [15, 0, 0], color: "neutral7" });
  },
  antlers: ({ head: h }) => {
    if (!h) return;
    const [s0, s1, s2] = h.s, [c0, c1, c2] = [0, h.c[1], h.c[2]];
    const r: [number, number] = [s0 * 0.07, s0 * 0.035];
    h.part.shapes.push(
      { type: "tube", at: [s0 * 0.5, c1 + s1, c2], size: [s0, s1, s1], points: [[c0 + s0 * 0.2, c1 + s1 * 0.42, c2 - s2 * 0.1], [s0 * 0.5, c1 + s1 * 0.95, c2 - s2 * 0.3], [s0 * 0.75, c1 + s1 * 1.5, c2 - s2 * 0.15]], radius: r, color: "accent", mirror: true },
      { type: "tube", at: [s0 * 0.4, c1 + s1, c2], size: [s0, s1, s1], points: [[s0 * 0.42, c1 + s1 * 0.85, c2 - s2 * 0.25], [s0 * 0.38, c1 + s1 * 1.2, c2 + s2 * 0.15]], radius: [r[0] * 0.8, r[1]], color: "accent", mirror: true },
      { type: "tube", at: [s0 * 0.6, c1 + s1, c2], size: [s0, s1, s1], points: [[s0 * 0.62, c1 + s1 * 1.22, c2 - s2 * 0.22], [s0 * 1.0, c1 + s1 * 1.4, c2 - s2 * 0.45]], radius: [r[0] * 0.75, r[1]], color: "accent", mirror: true },
    );
  },
  "curled horns": ({ head: h }) => {
    if (!h) return;
    const [s0, s1, s2] = h.s, [c1, c2] = [h.c[1], h.c[2]];
    h.part.shapes.push({ type: "tube", at: [s0 * 0.5, c1 + s1 * 0.2, c2 - s2 * 0.2], size: [s0, s1, s2], points: [[s0 * 0.25, c1 + s1 * 0.42, c2], [s0 * 0.5, c1 + s1 * 0.62, c2 - s2 * 0.35], [s0 * 0.62, c1 + s1 * 0.2, c2 - s2 * 0.6], [s0 * 0.66, c1 - s1 * 0.15, c2 - s2 * 0.25], [s0 * 0.62, c1 + s1 * 0.05, c2 + s2 * 0.05]], radius: [s0 * 0.14, s0 * 0.05], color: "neutral6", mirror: true });
  },
  ossicones: ({ head: h }) => {
    if (!h) return;
    const [s0, s1, s2] = h.s;
    h.part.shapes.push({ type: "cylinder", at: [s0 * 0.16, h.c[1] + s1 * 0.6, h.c[2] - s2 * 0.15], size: [s0 * 0.1, s1 * 0.45, s0 * 0.1], color: "main", mirror: true });
    h.part.shapes.push({ type: "ellipsoid", at: [s0 * 0.16, h.c[1] + s1 * 0.85, h.c[2] - s2 * 0.15], size: [s0 * 0.16, s0 * 0.16, s0 * 0.16], color: "accent", mirror: true });
  },
  "long ears": ({ head: h }) => {
    if (!h) return;
    dropEars(h);
    const [s0, s1, s2] = h.s, L = s1 * 1.35;
    h.part.shapes.push({ type: "capsule", at: [s0 * 0.2, h.c[1] + s1 * 0.4 + L * 0.42, h.c[2] - s2 * 0.12], size: [s0 * 0.24, L, s0 * 0.13], rotate: [-12, 0, -12], color: "main", mirror: true });
    h.part.shapes.push({ type: "capsule", at: [s0 * 0.2, h.c[1] + s1 * 0.4 + L * 0.45, h.c[2] - s2 * 0.12 + s0 * 0.04], size: [s0 * 0.13, L * 0.75, s0 * 0.08], rotate: [-12, 0, -12], color: "accent", paint: true, mirror: true });
  },
  "round ears": ({ head: h }) => {
    if (!h) return;
    dropEars(h);
    const [s0, s1] = h.s, d = s0 * 0.5;
    h.part.shapes.push({ type: "ellipsoid", at: [s0 * 0.36, h.c[1] + s1 * 0.45, h.c[2] - h.s[2] * 0.05], size: [d, d, d * 0.22], color: "main", mirror: true });
    h.part.shapes.push({ type: "ellipsoid", at: [s0 * 0.36, h.c[1] + s1 * 0.45, h.c[2] - h.s[2] * 0.05 + d * 0.1], size: [d * 0.65, d * 0.65, d * 0.15], color: "accent", paint: true, mirror: true });
  },
  "big ears": ({ head: h, skill }) => {
    if (!h) return;
    dropEars(h);
    const [s0, s1, s2] = h.s;
    if (skill === "humanoid") {
      // Goblin ears: long points out to the sides.
      h.part.shapes.push({ type: "cone", axis: "x", at: [s0 * 0.62, h.c[1] + s1 * 0.05, h.c[2] - s2 * 0.05], size: [s0 * 0.55, s1 * 0.28, s0 * 0.12], rotate: [0, 0, 18], color: "main", mirror: true });
    } else if (skill === "winged-creature") {
      h.part.shapes.push({ type: "cone", at: [s0 * 0.25, h.c[1] + s1 * 0.75, h.c[2] - s2 * 0.05], size: [s0 * 0.4, s1 * 0.85, s0 * 0.15], rotate: [0, 0, -18], color: "main", mirror: true });
    } else {
      // Elephant ears: big flat fans behind the head.
      h.part.shapes.push({ type: "ellipsoid", at: [s0 * 0.58, h.c[1] - s1 * 0.05, h.c[2] - s2 * 0.18], size: [s0 * 0.1, s1 * 1.3, s2 * 1.0], rotate: [0, 28, -8], color: "main", mirror: true });
      h.part.shapes.push({ type: "ellipsoid", at: [s0 * 0.6, h.c[1] - s1 * 0.05, h.c[2] - s2 * 0.12], size: [s0 * 0.09, s1 * 0.95, s2 * 0.7], rotate: [0, 28, -8], color: "pink4", paint: true, mirror: true });
    }
  },
  "ear tufts": ({ head: h }) => {
    if (!h) return;
    h.part.shapes.push({ type: "cone", at: [h.s[0] * 0.3, h.c[1] + h.s[1] * 0.52, h.c[2] - h.s[2] * 0.05], size: [h.s[0] * 0.16, h.s[1] * 0.38, h.s[0] * 0.1], rotate: [0, 0, -22], color: "main", mirror: true });
  },
  "big eyes": ({ head: h }) => {
    if (!h) return;
    for (const q of eyeShapes(h)) q.size = [q.size[0] * 1.5, q.size[1] * 1.5, q.size[2] * 1.2];
  },
  "bead eyes": ({ head: h }) => {
    // Small creatures: one glossy dark bead per eye instead of white and pupil, which would blur
    // together at a few samples across (the gloss catches a highlight, so it still sparkles).
    if (!h) return;
    const whites = eyeShapes(h).filter((q) => q.color === "neutral8");
    if (!whites.length || !pupils(h).length) return;
    // Round beads that bulge out of the face (a flat disc would be thinner than one sample).
    for (const w of whites) {
      w.color = "neutral1"; w.finish = "gloss";
      const d = Math.max(w.size[0], w.size[1]) * 0.9;
      w.size = [d, d, d];
      w.at = [w.at[0], w.at[1], w.at[2] + d * 0.15];
    }
    h.part.shapes = h.part.shapes.filter((q) => !pupils(h).includes(q) || whites.includes(q));
    // A smaller nose, so the face isn't all nose.
    for (const q of h.part.shapes) if (!q.mirror && q.color === "neutral1" && Math.max(...q.size) < h.s[0] * 0.25) q.size = [q.size[0] * 0.7, q.size[1] * 0.7, q.size[2]];
  },
  "many eyes": ({ head: h }) => {
    if (!h) return;
    for (const q of pupils(h).slice()) {
      h.part.shapes.push({ ...q, at: [q.at[0] * 0.45, q.at[1] + h.s[1] * 0.2, q.at[2] - h.s[2] * 0.03], size: [q.size[0] * 0.65, q.size[1] * 0.65, q.size[2]], finish: "gloss" });
      h.part.shapes.push({ ...q, at: [q.at[0] * 1.35, q.at[1] + h.s[1] * 0.12, q.at[2] - h.s[2] * 0.12], size: [q.size[0] * 0.5, q.size[1] * 0.5, q.size[2]], finish: "gloss" });
    }
  },
  "eye patches": ({ head: h }) => {
    if (!h) return;
    const whites = eyeShapes(h).filter((q) => q.color === "neutral8");
    const first = h.part.shapes.indexOf(whites[0] ?? eyeShapes(h)[0]);
    if (first < 0) return;
    const q = h.part.shapes[first];
    // Painted before the eyes, so the eyes sit on the patches.
    h.part.shapes.splice(first, 0, { type: "ellipsoid", at: [q.at[0] * 1.05, q.at[1] - q.size[1] * 0.1, q.at[2] - q.size[2] * 0.3], size: [q.size[0] * 2, q.size[1] * 2.3, q.size[2] * 3], rotate: [0, 0, -20], color: "neutral1", paint: true, mirror: true });
  },
  "eye stalks": ({ head: h }) => {
    if (!h || h.part.shapes.some((q) => q.type === "tube")) return;
    const [s0, s1, s2] = h.s, top: Vec3 = [s0 * 0.32, h.c[1] + s1 * 1.05, h.c[2] + s2 * 0.15];
    h.part.shapes.push({ type: "tube", at: [s0 * 0.28, h.c[1] + s1 * 0.7, h.c[2]], size: [s0, s1, s2], points: [[s0 * 0.2, h.c[1] + s1 * 0.25, h.c[2] + s2 * 0.1], top], radius: [s0 * 0.07, s0 * 0.05], color: "main", mirror: true });
    h.part.shapes.push({ type: "ellipsoid", at: top, size: [s0 * 0.2, s0 * 0.2, s0 * 0.2], color: "neutral8", mirror: true });
    h.part.shapes.push({ type: "ellipsoid", at: add(top, [0, 0, s0 * 0.08]), size: [s0 * 0.12, s0 * 0.12, s0 * 0.08], color: "neutral1", mirror: true });
  },
  "glowing eyes": ({ head: h }) => {
    if (!h) return;
    for (const q of pupils(h)) { q.color = "accent"; q.finish = "glow"; }
  },
  bill: ({ head: h }) => {
    // A duck's bill: broad and flat, replacing a pointed beak.
    if (!h) return;
    h.part.shapes = h.part.shapes.filter((q) => !(q.type === "cone" && q.axis === "z"));
    h.part.shapes.push({ type: "ellipsoid", at: [0, h.c[1] - h.s[1] * 0.12, h.c[2] + h.s[2] * 0.62], size: [h.s[0] * 0.42, h.s[1] * 0.14, h.s[2] * 0.55], color: "accent" });
  },
  "white head": ({ head: h }) => {
    // A bald eagle: a white head over the dark body.
    if (!h) return;
    h.part.shapes.splice(1, 0, { type: "ellipsoid", at: h.c, size: [h.s[0] * 1.1, h.s[1] * 1.1, h.s[2] * 1.1], color: "neutral8", paint: true });
  },
  beak: ({ head: h }) => {
    if (!h || h.part.shapes.some((q) => q.type === "cone" && q.axis === "z")) return;
    const L = h.s[2] * 0.45;
    h.part.shapes.push({ type: "cone", axis: "z", at: [0, h.c[1] - h.s[1] * 0.05, h.c[2] + h.s[2] * 0.42 + L * 0.3], size: [h.s[0] * 0.3, h.s[1] * 0.26, L], color: "yellow4" });
  },
  crest: ({ head: h }) => {
    if (!h) return;
    const [s0, s1, s2] = h.s;
    h.part.shapes.push({ type: "cone", at: [0, h.c[1] + s1 * 0.55, h.c[2] + s2 * 0.05], size: [s0 * 0.08, s1 * 0.5, s0 * 0.22], rotate: [-35, 0, 0], color: "accent", repeat: { count: 3, offset: [0, -s1 * 0.06, -s2 * 0.18], rotate: [-10, 0, 0], scale: 0.85 } });
  },
  comb: ({ head: h }) => {
    if (!h) return;
    const [s0, s1, s2] = h.s;
    h.part.shapes.push({ type: "ellipsoid", at: [0, h.c[1] + s1 * 0.52, h.c[2] + s2 * 0.18], size: [s0 * 0.1, s1 * 0.3, s0 * 0.2], color: "red3", repeat: { count: 3, offset: [0, -s1 * 0.02, -s2 * 0.16], scale: 0.85 } });
    h.part.shapes.push({ type: "ellipsoid", at: [0, h.c[1] - s1 * 0.35, h.c[2] + s2 * 0.38], size: [s0 * 0.14, s1 * 0.28, s0 * 0.12], color: "red3" });
  },
  snout: ({ head: h }) => {
    if (!h) return;
    dropEars(h);
    const [s0, s1, s2] = h.s, z = h.c[2] + s2 * 0.74;
    h.part.shapes.push({ type: "cylinder", axis: "z", at: [0, h.c[1] - s1 * 0.12, z], size: [s0 * 0.46, s1 * 0.38, s2 * 0.3], round: s0 * 0.05, color: "belly" });
    h.part.shapes.push({ type: "ellipsoid", at: [s0 * 0.34, h.c[1] + s1 * 0.4, h.c[2] + s2 * 0.05], size: [s0 * 0.36, s0 * 0.08, s0 * 0.3], rotate: [-35, 0, -30], color: "main", mirror: true });
    h.part.shapes.push({ type: "ellipsoid", at: [s0 * 0.08, h.c[1] - s1 * 0.12, z + s2 * 0.15], size: [s0 * 0.07, s1 * 0.12, s0 * 0.05], color: "accent", mirror: true });
  },
  trunk: ({ head: h }) => {
    if (!h) return;
    const [s0, s1, s2] = h.s, [c1, c2] = [h.c[1], h.c[2]];
    h.part.shapes.push({ type: "tube", at: [0, c1 - s1 * 0.5, c2 + s2 * 0.6], size: [s0, s1, s2], points: [[0, c1 - s1 * 0.02, c2 + s2 * 0.38], [0, c1 - s1 * 0.35, c2 + s2 * 0.62], [0, c1 - s1 * 0.85, c2 + s2 * 0.6], [0, c1 - s1 * 1.15, c2 + s2 * 0.78]], radius: [s0 * 0.17, s0 * 0.08], color: "main" });
  },
  tusks: ({ head: h }) => {
    if (!h) return;
    const [s0, s1, s2] = h.s, [c1, c2] = [h.c[1], h.c[2]];
    h.part.shapes.push({ type: "tube", at: [s0 * 0.2, c1 - s1 * 0.4, c2 + s2 * 0.55], size: [s0, s1, s2], points: [[s0 * 0.17, c1 - s1 * 0.22, c2 + s2 * 0.32], [s0 * 0.22, c1 - s1 * 0.58, c2 + s2 * 0.58], [s0 * 0.14, c1 - s1 * 0.45, c2 + s2 * 0.88]], radius: [s0 * 0.07, s0 * 0.015], color: "neutral8", finish: "gloss", mirror: true });
  },
  teeth: ({ head: h, mood }) => {
    // Cute things don't bare their teeth.
    if (!h || mood === "cute") return;
    const [s0, s1, s2] = h.s;
    h.part.shapes.push({ type: "cone", at: [s0 * 0.2, h.c[1] - s1 * 0.18, h.c[2] + s2 * 0.4], size: [s0 * 0.08, s1 * 0.2, s0 * 0.08], rotate: [180, 0, 0], color: "neutral8", mirror: true, repeat: { count: 3, offset: [s0 * 0.02, 0, -s2 * 0.12], scale: 0.9 } });
  },
  "forked tongue": ({ head: h }) => {
    // Only where the template has none (and tubes this thin only show on big serpents).
    if (!h || h.part.shapes.some((q) => q.color === "red3")) return;
    const [s0, s1, s2] = h.s, y = h.c[1] - h.s[1] * 0.15, z = h.c[2] + s2 * 0.42;
    h.part.shapes.push({ type: "tube", at: [0, y, z + s2 * 0.12], size: [s0, s1, s2], points: [[0, y, z], [0, y - s1 * 0.04, z + s2 * 0.22]], radius: s0 * 0.02, color: "red3" });
    h.part.shapes.push({ type: "tube", at: [0, y, z + s2 * 0.26], size: [s0, s1, s2], points: [[0, y - s1 * 0.04, z + s2 * 0.2], [s0 * 0.06, y - s1 * 0.06, z + s2 * 0.3]], radius: [s0 * 0.018, s0 * 0.01], color: "red3", mirror: true });
  },
  hat: ({ head: h }) => {
    if (!h) return;
    const [s0, s1, s2] = h.s, y = h.c[1] + h.s[1] * 0.38, H = s1 * 1.5;
    h.part.shapes.push({ type: "cylinder", at: [0, y, h.c[2]], size: [s0 * 1.7, s1 * 0.07, s2 * 1.7], round: s1 * 0.02, color: "main" });
    h.part.shapes.push({ type: "cone", at: [0, y + H * 0.48, h.c[2] - s2 * 0.12], size: [s0 * 1.0, H, s2 * 1.0], rotate: [-14, 0, 0], color: "main" });
    h.part.shapes.push({ type: "cylinder", at: [0, y + s1 * 0.08, h.c[2]], size: [s0 * 1.02, s1 * 0.12, s2 * 1.02], color: "accent", paint: true });
    h.part.shapes.push({ type: "ellipsoid", at: [s0 * 0.18, y + H * 0.35, h.c[2] + s2 * 0.3], size: [s0 * 0.12, s0 * 0.12, s0 * 0.08], color: "accent", finish: "glow" });
  },
  tricorn: ({ head: h }) => {
    if (!h) return;
    const [s0, s1, s2] = h.s, y = h.c[1] + s1 * 0.36;
    h.part.shapes.push({ type: "cylinder", at: [0, y + s1 * 0.12, h.c[2]], size: [s0 * 1.05, s1 * 0.38, s2 * 1.0], taper: 0.85, color: "neutral1" });
    // Three brims turned up into a triangle.
    for (const a of [0, 120, 240]) {
      const r = (a * Math.PI) / 180;
      h.part.shapes.push({ type: "box", at: [Math.sin(r) * s0 * 0.55, y + s1 * 0.12, h.c[2] + Math.cos(r) * s2 * 0.55], size: [s0 * 1.25, s1 * 0.32, s0 * 0.07], rotate: [-25, a, 0], round: s0 * 0.03, color: "neutral1" });
    }
    h.part.shapes.push({ type: "box", at: [0, y + s1 * 0.02, h.c[2]], size: [s0 * 1.08, s1 * 0.05, s2 * 1.03], color: "yellow4", paint: true });
  },
  "top hat": ({ head: h }) => {
    if (!h) return;
    const [s0, s1, s2] = h.s, y = h.c[1] + h.s[1] * 0.42;
    h.part.shapes.push({ type: "cylinder", at: [0, y, h.c[2]], size: [s0 * 1.25, s1 * 0.07, s2 * 1.25], color: "neutral1", blend: 0 });
    h.part.shapes.push({ type: "cylinder", at: [0, y + s1 * 0.35, h.c[2]], size: [s0 * 0.78, s1 * 0.7, s2 * 0.78], color: "neutral1", blend: 0 });
    h.part.shapes.push({ type: "cylinder", at: [0, y + s1 * 0.1, h.c[2]], size: [s0 * 0.8, s1 * 0.12, s2 * 0.8], color: "red3", paint: true });
  },
  beard: ({ head: h }) => {
    if (!h) return;
    const [s0, s1, s2] = h.s;
    h.part.shapes.push({ type: "cone", at: [0, h.c[1] - s1 * 0.62, h.c[2] + s2 * 0.3], size: [s0 * 0.7, s1 * 0.95, s2 * 0.45], rotate: [168, 0, 0], color: "neutral8" });
  },
  "carrot nose": ({ head: h }) => {
    if (!h) return;
    h.part.shapes.push({ type: "cone", axis: "z", at: [0, h.c[1] - h.s[1] * 0.02, h.c[2] + h.s[2] * 0.6], size: [h.s[0] * 0.14, h.s[0] * 0.14, h.s[2] * 0.45], color: "orange4" });
  },
  visor: ({ head: h }) => {
    if (!h) return;
    const eye = eyeShapes(h)[0];
    const [s0, s1, s2] = h.s;
    h.part.shapes.push({ type: "box", at: [0, eye?.at[1] ?? h.c[1] + s1 * 0.05, h.c[2] + s2 * 0.38], size: [s0 * 0.85, s1 * 0.18, s2 * 0.25], round: s1 * 0.05, color: "accent", finish: "glow", blend: 0 });
  },

  // ------------------------------------------------------------------ bodies
  hooves: ({ shape }) => {
    for (const p of shape.parts.filter((q) => /^leg/.test(q.anim ?? ""))) {
      const foot = p.shapes.reduce((a, q) => (q.at[1] < a.at[1] ? q : a));
      foot.color = "neutral2";
      foot.finish = "gloss";
    }
  },
  "horse mane": ({ head: h, body: b }) => {
    if (!h || !b) return;
    const [s0, s1, s2] = h.s;
    // Along the crest of the neck (the body's neck tube, when there is one), then a forelock.
    const neck = b.part.shapes.find((q) => q.type === "tube" && q.points && q.points[q.points.length - 1][1] > b.c[1] + b.s[1] * 0.4);
    if (neck?.points) {
      const r = Array.isArray(neck.radius) ? neck.radius : [neck.radius ?? 0.1, neck.radius ?? 0.1];
      const pts = neck.points.map((pt, i, all) => { const t = i / (all.length - 1); const rr = r[0] + (r[1] - r[0]) * t; return add(pt, [0, rr * 0.82, -rr * 0.35]) as Vec3; });
      b.part.shapes.push({ type: "tube", at: pts[1], size: [s0, s1, s2], points: [...pts, add(pts[pts.length - 1], [0, s1 * 0.25, s2 * 0.05])], radius: [r[0] * 0.42, r[1] * 0.5], color: "accent" });
    } else {
      const pv = h.part.pivot ?? h.c;
      h.part.shapes.push({ type: "tube", at: [0, pv[1] + s1 * 0.4, pv[2]], size: [s0, s1, s2], points: [[0, h.c[1] + s1 * 0.5, h.c[2] + s2 * 0.05], [0, h.c[1] + s1 * 0.32, h.c[2] - s2 * 0.48], [0, b.c[1] + b.s[1] * 0.4, b.c[2] + b.s[2] * 0.28]], radius: [s0 * 0.13, s0 * 0.18], color: "accent" });
    }
    h.part.shapes.push({ type: "ellipsoid", at: [0, h.c[1] + s1 * 0.45, h.c[2] + s2 * 0.2], size: [s0 * 0.3, s1 * 0.25, s2 * 0.4], rotate: [-30, 0, 0], color: "accent" });
  },

  "flowing tail": ({ shape, body: b }) => {
    if (!b) return;
    const w = b.s[0], L = b.s[1] * 1.1;
    const P: Vec3 = [0, b.c[1] + b.s[1] * 0.3, b.c[2] - b.s[2] * 0.46];
    setTail(shape, P, [{ type: "tube", at: add(P, [0, -L * 0.4, -L * 0.3]), size: [w, L, L], points: [P, add(P, [0, L * 0.05, -L * 0.28]), add(P, [0, -L * 0.4, -L * 0.45]), add(P, [0, -L * 0.85, -L * 0.45])], radius: [w * 0.1, w * 0.17], color: "accent" }]);
  },
  "bushy tail": ({ shape, body: b, has }) => {
    if (!b) return;
    const w = b.s[0], L = b.s[2] * 0.75;
    const P: Vec3 = [0, b.c[1] + b.s[1] * 0.15, b.c[2] - b.s[2] * 0.45];
    const end = add(P, [0, L * 0.45, -L * 0.8]);
    setTail(shape, P, [
      { type: "tube", at: add(P, [0, L * 0.2, -L * 0.4]), size: [w, L, L], points: [P, add(P, [0, -L * 0.05, -L * 0.35]), add(P, [0, L * 0.15, -L * 0.65]), end], radius: [w * 0.13, w * 0.28], color: "main" },
      // A pale tip (foxes): the accent, if it's light, otherwise a darker tip.
      { type: "ellipsoid", at: add(end, [0, L * 0.04, -L * 0.06]), size: [w * 0.55, w * 0.55, w * 0.6], color: has("pale tail tip") ? "neutral8" : "main-1", paint: true, blend: w * 0.08 },
    ]);
  },
  "long tail": ({ shape, body: b, skill, has }) => {
    if (!b || skill !== "winged-creature" || has("horns") || has("spines")) return;
    const w = b.s[0], L = b.s[2] * 1.15;
    const P: Vec3 = [0, b.c[1] + b.s[1] * 0.05, b.c[2] - b.s[2] * 0.42];
    const glow = has("flames") ? { finish: "glow" as const } : {};
    setTail(shape, P, [-1, 0, 1].map((k): ShapePrimitive => ({
      type: "ellipsoid", at: add(P, [k * w * 0.22, -L * 0.08 + Math.abs(k) * L * 0.03, -L * (0.5 - Math.abs(k) * 0.08)]), size: [w * 0.28, w * 0.06, L * (1 - Math.abs(k) * 0.18)], rotate: [-8, k * 14, 0], color: k === 0 ? "accent" : "main", ...glow,
    })));
  },
  stripes: ({ body: b }) => {
    if (!b) return;
    b.part.shapes.push({ type: "box", at: [0, b.c[1], b.c[2] + b.s[2] * 0.28], size: [b.s[0] * 1.3, b.s[1] * 1.3, b.s[2] * 0.055], rotate: [12, 0, 0], color: "accent", paint: true, repeat: { count: 6, offset: [0, 0, -b.s[2] * 0.13] } });
  },
  spots: ({ body: b }) => {
    if (!b) return;
    const spots: Vec3[] = [[0.42, 0.15, 0.22], [-0.42, 0.22, -0.1], [0.15, 0.45, -0.3], [-0.22, 0.38, 0.3], [0.42, 0.02, -0.3], [-0.1, 0.48, 0.05], [-0.4, -0.05, 0.38], [0.3, 0.35, 0.02]];
    for (const [i, [x, y, z]] of spots.entries()) { const k = 0.42 + (i % 3) * 0.1; b.part.shapes.push({ type: "ellipsoid", at: [b.c[0] + x * b.s[0], b.c[1] + y * b.s[1], b.c[2] + z * b.s[2]], size: [b.s[0] * k, b.s[0] * k * 0.8, b.s[0] * k * 1.2], rotate: [0, i * 37, 0], color: "accent", paint: true, blend: b.s[0] * 0.03 }); }
  },
  grooves: ({ body: b }) => {
    if (!b) return;
    b.part.shapes.push({ type: "box", at: [-b.s[0] * 0.24, b.c[1] - b.s[1] * 0.42, b.c[2] + b.s[2] * 0.12], size: [b.s[0] * 0.035, b.s[1] * 0.3, b.s[2] * 0.55], color: "neutral6", paint: true, repeat: { count: 5, offset: [b.s[0] * 0.12, 0, 0] } });
  },
  dorsal: ({ body: b }) => {
    if (!b || b.part.shapes.some((q) => q.at[1] - q.size[1] / 2 > b.c[1] + b.s[1] * 0.3)) return;
    b.part.shapes.push({ type: "cone", at: [0, b.c[1] + b.s[1] * 0.62, b.c[2] - b.s[2] * 0.02], size: [b.s[0] * 0.09, b.s[1] * 0.6, b.s[2] * 0.3], rotate: [-28, 0, 0], color: "main" });
  },
  ruff: ({ body: b, head: h }) => {
    // A thick collar of fur at the neck and chest (wolves, huskies), slightly lighter.
    if (!b || !h) return;
    const pv = h.part.pivot ?? h.c;
    b.part.shapes.push({ type: "ellipsoid", at: [0, (pv[1] + b.c[1]) / 2, (pv[2] + b.c[2] + b.s[2] * 0.4) / 2], size: [b.s[0] * 1.15, b.s[1] * 1.15, b.s[1] * 0.95], color: "main" });
    b.part.shapes.push({ type: "ellipsoid", at: [0, (pv[1] + b.c[1]) / 2 - b.s[1] * 0.3, (pv[2] + b.c[2] + b.s[2] * 0.4) / 2 + b.s[1] * 0.2], size: [b.s[0] * 0.8, b.s[1] * 0.7, b.s[1] * 0.6], color: "belly", paint: true, blend: b.s[1] * 0.1 });
  },
  quills: ({ body: b }) => {
    if (!b) return;
    // Rows of spikes pointing back and out over the whole back.
    const L = b.s[1] * 0.55, w = b.s[0] * 0.14;
    b.part.shapes.push({ type: "cone", at: [0, b.c[1] + b.s[1] * 0.42, b.c[2] + b.s[2] * 0.25], size: [w, L, w], rotate: [-55, 0, 0], color: "accent", repeat: { count: 5, offset: [0, -b.s[1] * 0.015, -b.s[2] * 0.15] } });
    b.part.shapes.push({ type: "cone", at: [b.s[0] * 0.25, b.c[1] + b.s[1] * 0.3, b.c[2] + b.s[2] * 0.2], size: [w, L, w], rotate: [-55, 0, -40], color: "accent", mirror: true, repeat: { count: 5, offset: [0, -b.s[1] * 0.02, -b.s[2] * 0.15] } });
    b.part.shapes.push({ type: "cone", at: [b.s[0] * 0.42, b.c[1] + b.s[1] * 0.08, b.c[2] + b.s[2] * 0.15], size: [w, L * 0.85, w], rotate: [-55, 0, -75], color: "accent", mirror: true, repeat: { count: 4, offset: [0, 0, -b.s[2] * 0.16] } });
  },
  wool: ({ shape, head: h, body: b }) => {
    if (!b) return;
    const d = b.s[0] * 0.5;
    b.part.shapes.push({ type: "ellipsoid", at: [b.s[0] * 0.3, b.c[1] + b.s[1] * 0.12, b.c[2] + b.s[2] * 0.3], size: [d, d, d], color: "main", mirror: true, repeat: { count: 4, offset: [0, 0, -b.s[2] * 0.2] } });
    b.part.shapes.push({ type: "ellipsoid", at: [0, b.c[1] + b.s[1] * 0.38, b.c[2] + b.s[2] * 0.25], size: [d * 1.1, d, d * 1.1], color: "main", repeat: { count: 3, offset: [0, 0, -b.s[2] * 0.25] } });
    if (h) h.part.shapes[0].color = "accent";
    for (const p of shape.parts.filter((q) => /^leg/.test(q.anim ?? ""))) for (const q of p.shapes) if (q.color === "main") q.color = "accent";
  },
  stinger: ({ body: b }) => {
    if (!b) return;
    const L = b.s[2] * 0.28;
    b.part.shapes.push({ type: "cone", axis: "z", at: [0, b.c[1] - b.s[1] * 0.05, b.c[2] - b.s[2] * 0.45 - L * 0.3], size: [b.s[0] * 0.16, b.s[0] * 0.16, L], rotate: [0, 180, 0], color: "neutral1", finish: "gloss" });
  },
  "stinger tail": ({ shape, body: b }) => {
    if (!b) return;
    const w = b.s[0], L = b.s[2] * 1.1;
    const P: Vec3 = [0, b.c[1] + b.s[1] * 0.1, b.c[2] - b.s[2] * 0.45];
    setTail(shape, P, [{ type: "tube", at: add(P, [0, L * 0.5, 0]), size: [w, L, L], points: [P, add(P, [0, L * 0.25, -L * 0.3]), add(P, [0, L * 0.75, -L * 0.2]), add(P, [0, L * 0.98, L * 0.15]), add(P, [0, L * 0.8, L * 0.42])], radius: [w * 0.14, w * 0.03], color: "main" }]);
  },
  pincers: ({ shape, head: h, body: b }) => {
    if (!h || !b) return;
    const w = b.s[0];
    const P: Vec3 = [h.s[0] * 0.45, h.c[1] - h.s[1] * 0.1, h.c[2] - h.s[2] * 0.35];
    const elbow = add(P, [w * 0.32, w * 0.08, w * 0.25]);
    const claw = add(elbow, [-w * 0.02, w * 0.06, w * 0.38]);
    shape.parts.push({ name: "pincer", anim: "armL", mirror: true, pivot: P, shapes: [
      { type: "tube", at: elbow, size: [w, w, w], points: [P, elbow, claw], radius: [w * 0.065, w * 0.08], color: "main" },
      { type: "ellipsoid", at: claw, size: [w * 0.3, w * 0.22, w * 0.42], rotate: [0, -15, 0], color: "main", finish: "gloss" },
      { type: "box", at: add(claw, [0, 0, w * 0.15]), size: [w * 0.4, w * 0.06, w * 0.25], rotate: [0, -15, 0], color: "main", cut: true },
    ] });
  },
  "short legs": ({ shape }) => {
    // Pull tube legs in towards their hips (a crab's legs are short and bent, a spider's long).
    for (const p of shape.parts.filter((q) => /^leg/.test(q.anim ?? ""))) for (const q of p.shapes) {
      if (!q.points) continue;
      const [x0, y0, z0] = q.points[0];
      q.points = q.points.map(([x, y, z], i) => (i === 0 ? [x, y, z] : [x0 + (x - x0) * 0.72, y, z0 + (z - z0) * 0.72]));
    }
  },
  "eight legs": ({ shape }) => {
    const legs = shape.parts.filter((p) => /^leg/.test(p.anim ?? "") && p.shapes[0]?.points);
    const last = legs[legs.length - 1];
    if (!last || legs.length >= 4) return;
    const back = structuredClone(last);
    const dz = -Math.abs((legs[0].pivot?.[2] ?? 0) - (last.pivot?.[2] ?? 0)) / Math.max(1, legs.length - 1);
    back.name = "rear leg";
    back.anim = last.anim === "legL" ? "legR" : "legL";
    back.pivot = back.pivot && add(back.pivot, [0, 0, dz]);
    for (const q of back.shapes) { q.at = add(q.at, [0, 0, dz]); if (q.points) q.points = q.points.map((pt, i) => add(pt, [0, 0, dz * (i === 0 ? 1 : 1.6)])); }
    shape.parts.push(back);
  },
  "membrane wings": ({ shape, mood }) => {
    // Dragons and bats: an arm out to a wrist, finger bones fanning back, and the membrane between,
    // scalloped along the trailing edge.
    const wing = shape.parts.find(isPart("wingL"));
    if (!wing) return;
    const p = wing.pivot ?? wing.shapes[0].at;
    const span = Math.max(...wing.shapes.map((q) => q.at[0] + q.size[0] / 2)) - p[0];
    const wrist = add(p, [span * 0.42, span * 0.22, span * 0.05]);
    const r = span * 0.035;
    const tips: Vec3[] = [add(p, [span, span * 0.12, -span * 0.12]), add(p, [span * 0.82, 0, -span * 0.42]), add(p, [span * 0.55, -span * 0.04, -span * 0.55])];
    wing.shapes = [
      { type: "tube", at: wrist, size: [span, span, span], points: [p, add(p, [span * 0.2, span * 0.14, span * 0.06]), wrist], radius: [r * 1.6, r], color: "main" },
      { type: "ellipsoid", at: add(p, [span * 0.52, span * 0.08, -span * 0.25]), size: [span * 0.98, span * 0.025, span * 0.6], rotate: [0, -12, 6], color: "belly" },
      { type: "ellipsoid", at: add(p, [span * 0.25, span * 0.04, -span * 0.3]), size: [span * 0.45, span * 0.025, span * 0.45], rotate: [0, 0, 6], color: "belly" },
      ...tips.map((tip): ShapePrimitive => ({ type: "tube", at: tip, size: [span, span, span], points: [wrist, tip], radius: [r, r * 0.3], color: "main" })),
      // A thumb claw at the wrist (cute ones get a round knuckle instead).
      { type: mood === "cute" ? "ellipsoid" : "cone", at: add(wrist, [0, span * 0.06, span * 0.03]), size: [r * 2, span * 0.12, r * 2], rotate: [30, 0, 0], color: "neutral8" },
      // Scallops: bites out of the trailing edge between the fingers.
      { type: "ellipsoid", at: add(p, [span * 0.92, span * 0.06, -span * 0.4]), size: [span * 0.2, span * 0.2, span * 0.2], color: "belly", cut: true },
      { type: "ellipsoid", at: add(p, [span * 0.7, span * 0.02, -span * 0.62]), size: [span * 0.2, span * 0.2, span * 0.2], color: "belly", cut: true },
    ];
  },
  "insect wings": ({ shape, head: h }) => {
    const wing = shape.parts.find(isPart("wingL"));
    if (wing) wing.shapes = structuredClone(INSECT_WINGS);
    // Insects have mandibles and antennae, not beaks.
    if (h) h.part.shapes = h.part.shapes.filter((q) => !(q.type === "cone" && q.axis === "z"));
  },
  "patterned wings": ({ shape, head: h, body: b }) => {
    if (b) for (const q of b.part.shapes) q.size = [q.size[0] * 0.6, q.size[1] * 0.6, q.size[2] * 0.85];
    const wing = shape.parts.find(isPart("wingL"));
    if (h) h.part.shapes = h.part.shapes.filter((q) => !(q.type === "cone" && q.axis === "z"));
    if (!wing) return;
    const p = wing.pivot ?? wing.shapes[0].at;
    // Broad fore and hind wings, each with an eye spot (accent ring, dark centre) and dark edges.
    wing.shapes = [
      { type: "ellipsoid", at: add(p, [0.7, 0.3, 0.18]), size: [1.45, 0.04, 1.05], rotate: [0, -25, 22], color: "main", finish: "gloss" },
      { type: "ellipsoid", at: add(p, [0.5, 0.08, -0.45]), size: [0.95, 0.04, 0.75], rotate: [0, 30, 12], color: "main", finish: "gloss" },
      { type: "ellipsoid", at: add(p, [1.3, 0.55, 0.38]), size: [0.45, 0.3, 0.45], color: "neutral1", paint: true },
      { type: "ellipsoid", at: add(p, [0.75, 0.32, 0.18]), size: [0.42, 0.3, 0.42], color: "accent", paint: true },
      { type: "ellipsoid", at: add(p, [0.75, 0.32, 0.18]), size: [0.16, 0.3, 0.16], color: "neutral1", paint: true },
      { type: "ellipsoid", at: add(p, [0.55, 0.1, -0.5]), size: [0.32, 0.3, 0.32], color: "accent", paint: true },
    ];
  },
  wings: ({ shape, body: b, has }) => {
    if (!b || shape.parts.some(isPart("wingL"))) return;
    const P: Vec3 = [b.s[0] * 0.3, b.c[1] + b.s[1] * 0.32, b.c[2] + b.s[2] * 0.12];
    // Dragons' wings span about twice their body; a pegasus's or griffin's a little more than one.
    const k = has("membrane wings") ? 1.6 : 1.05;
    shape.parts.push({ name: "wing", anim: "wingL", mirror: true, pivot: P, shapes: featherWing(P, b.s[2] * k, b.s[2] * 0.42 * (k > 1.2 ? 1.3 : 1)) });
  },
  flames: ({ shape, head: h, body: b, skill }) => {
    if (skill === "elemental") return;
    const fire = (at: Vec3, s: number, color: string): ShapePrimitive => ({ type: "cone", at, size: [s * 0.45, s, s * 0.45], rotate: [-18, 0, 0], color, finish: "glow" });
    if (h) h.part.shapes.push(fire([0, h.c[1] + h.s[1] * 0.55, h.c[2] - h.s[2] * 0.1], h.s[1] * 0.7, "yellow4"), { ...fire([h.s[0] * 0.22, h.c[1] + h.s[1] * 0.45, h.c[2] - h.s[2] * 0.15], h.s[1] * 0.5, "orange4"), mirror: true });
    if (b && skill !== "winged-creature") b.part.shapes.push({ ...fire([0, b.c[1] + b.s[1] * 0.48, b.c[2] + b.s[2] * 0.25], b.s[1] * 0.45, "orange4"), repeat: { count: 3, offset: [0, -b.s[1] * 0.02, -b.s[2] * 0.22], scale: 0.85 } });
    // Burning wingtips.
    const wing = shape.parts.find(isPart("wingL"));
    if (wing) {
      const tip = wing.shapes.reduce((a, q) => (q.at[0] > a.at[0] ? q : a));
      wing.shapes.push({ type: "ellipsoid", at: tip.at, size: [tip.size[0] * 1.3, tip.size[1] * 4, tip.size[2] * 1.3], color: "orange4", finish: "glow", paint: true });
    }
  },
  crystals: ({ body: b, mood }) => {
    if (!b) return;
    const s = b.s[1] * (mood === "cute" ? 0.35 : 0.55);
    const at = (x: number, z: number): Vec3 => [b.c[0] + x * b.s[0], b.c[1] + b.s[1] * 0.38 + s * 0.3, b.c[2] + z * b.s[2]];
    b.part.shapes.push(
      { type: "cone", at: at(0, 0.1), size: [s * 0.35, s, s * 0.35], rotate: [-10, 0, 0], color: "accent", finish: "gloss" },
      { type: "cone", at: at(0.18, -0.12), size: [s * 0.28, s * 0.75, s * 0.28], rotate: [-15, 0, -25], color: "accent", finish: "gloss", mirror: true },
      { type: "cone", at: at(0.08, -0.32), size: [s * 0.22, s * 0.55, s * 0.22], rotate: [-30, 0, -15], color: "belly", finish: "gloss", mirror: true },
    );
  },
  stone: ({ body: b }) => {
    if (!b) return;
    b.part.shapes.push(
      { type: "ellipsoid", at: [b.s[0] * 0.35, b.c[1] + b.s[1] * 0.3, b.c[2]], size: [b.s[0] * 0.45, b.s[1] * 0.35, b.s[2] * 0.6], rotate: [0, 0, 20], color: "main", mirror: true },
      { type: "ellipsoid", at: [b.s[0] * 0.3, b.c[1] + b.s[1] * 0.42, b.c[2]], size: [b.s[0] * 0.35, b.s[1] * 0.2, b.s[2] * 0.5], color: "accent", paint: true, mirror: true },
    );
  },
  sparkles: ({ body: b }) => {
    if (!b) return;
    for (const [x, y, z] of [[0.45, 0.2, 0.2], [-0.4, 0.3, -0.1], [0.15, 0.5, -0.3], [-0.1, 0.45, 0.35]] as Vec3[])
      b.part.shapes.push({ type: "ellipsoid", at: [x * b.s[0], b.c[1] + y * b.s[1], b.c[2] + z * b.s[2]], size: [b.s[0] * 0.12, b.s[0] * 0.12, b.s[0] * 0.12], color: "yellow5", finish: "glow", paint: true });
  },
  staff: ({ shape }) => {
    const arm = shape.parts.find(isPart("armL"));
    if (!arm) return;
    const hand = arm.shapes[arm.shapes.length > 1 ? 1 : 0];
    const [x, y, z] = [-hand.at[0], hand.at[1], hand.at[2] + 0.1];
    shape.parts.push({ name: "staff", anim: "armR", pivot: arm.pivot ? [-arm.pivot[0], arm.pivot[1], arm.pivot[2]] : undefined, shapes: [
      { type: "cylinder", at: [x, y + 0.2, z], size: [0.07, 1.55, 0.07], taper: 0.8, color: "orange1" },
      { type: "ellipsoid", at: [x, y + 1.02, z], size: [0.2, 0.2, 0.2], color: "accent", finish: "glow" },
    ] });
  },
  // ------------------------------------------------------------------ outfits (people)
  cloak: ({ body: b }) => {
    if (!b) return;
    const [w, hgt, d] = b.s;
    b.part.shapes.push(
      { type: "ellipsoid", at: [0, b.c[1] - hgt * 0.75, b.c[2] - d * 0.55], size: [w * 1.12, hgt * 2.5, d * 0.14], rotate: [-7, 0, 0], color: "main-1" },
      { type: "ellipsoid", at: [0, b.c[1] + hgt * 0.32, b.c[2] - d * 0.08], size: [w * 1.12, hgt * 0.42, d * 1.12], color: "main-1" },
    );
  },
  hood: ({ head: h }) => {
    if (!h) return;
    const [s0, s1, s2] = h.s;
    h.part.shapes.push({ type: "ellipsoid", at: [0, h.c[1] + s1 * 0.1, h.c[2] - s2 * 0.16], size: [s0 * 1.3, s1 * 1.22, s2 * 1.18], color: "main-1" });
    h.part.shapes.push({ type: "cone", at: [0, h.c[1] + s1 * 0.2, h.c[2] - s2 * 0.72], size: [s0 * 0.5, s1 * 0.7, s2 * 0.4], rotate: [-120, 0, 0], color: "main-1" });
  },
  mask: ({ head: h }) => {
    if (!h) return;
    const [s0, s1, s2] = h.s;
    h.part.shapes.push({ type: "box", at: [0, h.c[1] - s1 * 0.26, h.c[2] + s2 * 0.25], size: [s0 * 1.15, s1 * 0.5, s2 * 0.75], color: "main-1", paint: true });
  },
  "samurai armor": ({ shape, body: b, head: h }) => {
    if (b) b.part.shapes.push({ type: "box", at: [0, b.c[1] + b.s[1] * 0.12, b.c[2] + b.s[2] * 0.03], size: [b.s[0] * 1.05, b.s[1] * 0.2, b.s[2] * 1.08], round: b.s[2] * 0.12, color: "red2", finish: "gloss", repeat: { count: 4, offset: [0, -b.s[1] * 0.23, 0], scale: 0.97 } });
    const arm = shape.parts.find(isPart("armL"));
    const sh = arm?.shapes[2];
    if (arm && sh) arm.shapes.push({ type: "box", at: [sh.at[0] + sh.size[0] * 0.25, sh.at[1] - sh.size[1] * 0.3, sh.at[2]], size: [sh.size[0] * 0.25, sh.size[1] * 1.15, sh.size[2] * 1.3], rotate: [0, 0, 14], round: sh.size[0] * 0.04, color: "red2", finish: "gloss", repeat: { count: 3, offset: [0, -sh.size[1] * 0.22, 0] } });
    if (h) {
      const [s0, s1, s2] = h.s;
      h.part.shapes.push(
        { type: "ellipsoid", at: [0, h.c[1] + s1 * 0.2, h.c[2] - s2 * 0.03], size: [s0 * 1.22, s1 * 0.9, s2 * 1.18], color: "neutral2", finish: "metal" },
        { type: "cylinder", at: [0, h.c[1] - s1 * 0.02, h.c[2] - s2 * 0.12], size: [s0 * 1.7, s1 * 0.32, s2 * 1.55], taper: 0.72, color: "neutral2", finish: "metal" },
        { type: "tube", at: [s0 * 0.3, h.c[1] + s1 * 0.6, h.c[2] + s2 * 0.4], size: [s0, s1, s2], points: [[s0 * 0.05, h.c[1] + s1 * 0.35, h.c[2] + s2 * 0.5], [s0 * 0.3, h.c[1] + s1 * 0.7, h.c[2] + s2 * 0.55], [s0 * 0.48, h.c[1] + s1 * 1.05, h.c[2] + s2 * 0.42]], radius: [s0 * 0.06, s0 * 0.02], color: "yellow4", finish: "metal", mirror: true },
      );
    }
  },
  katana: ({ shape }) => heldWeapon(shape, (x, y, z) => [
    { type: "cylinder", axis: "z", at: [x, y - 0.03, z + 0.06], size: [0.11, 0.11, 0.025], color: "neutral1", finish: "metal" },
    { type: "box", at: [x, y - 0.5, z + 0.18], size: [0.025, 0.85, 0.055], rotate: [165, 0, 0], taper: [1, 0.35], color: "neutral8", finish: "metal" },
  ]),
  axe: ({ shape }) => heldWeapon(shape, (x, y, z) => [
    { type: "cylinder", at: [x, y - 0.25, z + 0.06], size: [0.045, 0.85, 0.045], color: "orange1" },
    { type: "wedge", at: [x, y - 0.6, z + 0.2], size: [0.04, 0.3, 0.25], rotate: [0, 0, 0], color: "neutral6", finish: "metal" },
  ]),
  bow: ({ shape }) => {
    // In the left hand only (its own part: the arm is mirrored).
    const arm = shape.parts.find(isPart("armL"));
    const hand = arm?.shapes[1];
    if (!arm || !hand) return;
    const c = hand.at, k = Math.min(1, hand.at[1] / 1.0);
    shape.parts.push({ name: "bow", anim: "armL", pivot: arm.pivot, shapes: [
      { type: "tube", at: c, size: [0.1, 1, 0.3], points: [add(c, [0.02, 0.55 * k, 0.02]), add(c, [0.02, 0.25 * k, 0.14 * k]), add(c, [0.02, -0.25 * k, 0.14 * k]), add(c, [0.02, -0.55 * k, 0.02])], radius: [0.025 * k, 0.025 * k], color: "orange1" },
      { type: "tube", at: c, size: [0.1, 1, 0.1], points: [add(c, [0.02, 0.55 * k, 0.02]), add(c, [0.02, -0.55 * k, 0.02])], radius: 0.006, color: "neutral7" },
    ] });
  },
  "horned helmet": ({ head: h }) => {
    if (!h) return;
    const [s0, s1, s2] = h.s;
    h.part.shapes.push({ type: "ellipsoid", at: [0, h.c[1] + s1 * 0.2, h.c[2] - s2 * 0.02], size: [s0 * 1.18, s1 * 0.85, s2 * 1.15], color: "neutral6", finish: "metal" });
    h.part.shapes.push({ type: "tube", at: [s0 * 0.7, h.c[1] + s1 * 0.5, h.c[2]], size: [s0, s1, s2], points: [[s0 * 0.45, h.c[1] + s1 * 0.3, h.c[2]], [s0 * 0.85, h.c[1] + s1 * 0.45, h.c[2] + s2 * 0.05], [s0 * 0.95, h.c[1] + s1 * 0.9, h.c[2] + s2 * 0.15]], radius: [s0 * 0.12, s0 * 0.02], color: "neutral8", mirror: true });
  },
  glossy: ({ shape }) => setFinish(shape, "gloss"),
  metal: ({ shape }) => setFinish(shape, "metal"),
  glow: ({ shape }) => { if (!shape.parts.some((p) => p.shapes.some((q) => q.finish === "glow"))) setFinish(shape, "glow"); },
};

/** Templates' plain ear cones, to replace with a species' own ears. */
function dropEars(h: Frame) {
  h.part.shapes = h.part.shapes.filter((q, i) => !(i > 0 && q.type === "cone" && q.mirror && q.at[1] > h.c[1] + h.s[1] * 0.2 && !q.axis));
}

function setTail(shape: ShapeSpec, pivot: Vec3, shapes: ShapePrimitive[]) {
  const tail = shape.parts.find(isPart("tail"));
  if (tail) { tail.shapes = shapes; tail.pivot = pivot; tail.mirror = false; }
  else shape.parts.push({ name: "tail", anim: "tail", pivot, shapes });
}

function setFinish(shape: ShapeSpec, finish: "gloss" | "metal" | "glow") {
  for (const p of shape.parts) for (const q of p.shapes) if ((q.color ?? "main") === "main" && !q.cut && !q.paint) q.finish = finish;
}

/** Names the kit understands (the rest are the template's, or handled by the older feature code). */
export const FEATURE_KIT = Object.keys(FEATURES);

/** Apply a species' features to a template, in a stable order (bodies first, then heads, then finishes). */
export function applyFeatureKit(shape: ShapeSpec, features: string[], skill: string, mood: Mood): ShapeSpec {
  const set = new Set(features);
  // A horse's mane and a flowing tail; a lion's mane is the older ruff.
  if (set.has("mane") && set.has("hooves")) { set.add("horse mane"); set.add("flowing tail"); }
  if (set.has("hat") && skill === "humanoid" && set.has("carrot nose")) { set.delete("hat"); set.add("top hat"); }
  const has = (f: string) => set.has(f);
  // Wings first: membrane, insect and patterned wings reshape the wing part they make.
  const order = ["wings", ...Object.keys(FEATURES).filter((k) => k !== "wings")];
  for (const f of order) {
    if (!set.has(f)) continue;
    const head = frame(shape.parts.find(isPart("head")));
    const body = frame(shape.parts.find((p) => p.anim === "body" || p.name === "body"));
    FEATURES[f]({ shape, skill, mood, has, head, body });
  }
  return shape;
}

/** A weapon in the right hand (the mirror of the left arm), swinging with it. */
function heldWeapon(shape: ShapeSpec, make: (x: number, y: number, z: number) => ShapePrimitive[]) {
  const arm = shape.parts.find(isPart("armL"));
  if (!arm || shape.parts.some((p) => p.name === "weapon")) return;
  const hand = arm.shapes[arm.shapes.length > 1 ? 1 : 0];
  // Sized to the hand's height (a dwarf's axe is shorter), so it never reaches the ground.
  const k = Math.min(1, hand.at[1] / 1.0);
  const shapes = make(-hand.at[0], hand.at[1], hand.at[2]).map((q) => ({ ...q, at: [-hand.at[0] + (q.at[0] + hand.at[0]) * k, hand.at[1] + (q.at[1] - hand.at[1]) * k, hand.at[2] + (q.at[2] - hand.at[2]) * k] as Vec3, size: [q.size[0] * k, q.size[1] * k, q.size[2] * k] as Vec3 }));
  shape.parts.push({ name: "weapon", anim: "armR", pivot: arm.pivot ? [-arm.pivot[0], arm.pivot[1], arm.pivot[2]] : undefined, shapes });
}
