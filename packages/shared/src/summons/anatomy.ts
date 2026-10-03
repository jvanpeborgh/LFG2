/**
 * Anatomy: four-legged bodies built from proportions instead of one template for everything. A
 * horse is a deep chest on long jointed legs with a neck held high and a long head; a bear is a
 * heavy barrel on thick straight legs with a shoulder hump; a cat is low and supple with a short
 * muzzle and a long tail. The same builder makes all of them, so every species gets:
 *
 * - a torso that is a chest and hips (deeper at the chest), countershaded (darker back, lighter belly);
 * - shoulder and thigh muscle masses on the legs, and legs that bend where real ones do
 *   (elbow, wrist; stifle, hock), tapering to hooves or paws;
 * - a neck, and a head that is a skull and a muzzle (with a nose, a chin and a lighter jaw);
 * - eyes that are small, dark and glossy, set at the sides under a brow (cute moods enlarge them).
 *
 * Head and body keep their main form first (shapes[0]): the feature kit measures from them.
 */
import type { ShapePartSpec, ShapePrimitive, ShapeSpec } from "./shape";

type V = [number, number, number];

export interface QuadBuild {
  /** Torso length, leg length (ground to belly), chest depth and width. */
  L: number; H: number; D: number; W: number;
  /** Neck length and how steeply it rises (degrees above horizontal). */
  neck: number; pitch: number;
  /** Skull length, width and height; muzzle length, width, and how far it drops. */
  head: number; headW: number; headH: number;
  muzzle: number; muzzleW: number; drop: number;
  /** Leg radius at the top. */
  leg: number;
  feet: "hoof" | "paw";
  /** Bears and badgers stand on the whole foot (no raised hock). */
  plantigrade?: boolean;
  ears: "tall" | "pointed" | "round" | "floppy" | "side" | "none";
  tail: "brush" | "thin" | "tuft" | "stub" | "none";
  /** A shoulder hump (bears, bison), as a share of the chest depth. */
  hump?: number;
  /** Legs splayed out to the sides (lizards, crocodiles), as a share of the leg length. */
  splay?: number;
}

export const BUILDS: Record<string, QuadBuild> = {
  equine: { L: 1.25, H: 1.0, D: 0.66, W: 0.58, neck: 0.72, pitch: 55, head: 0.46, headW: 0.32, headH: 0.36, muzzle: 0.4, muzzleW: 0.24, drop: 0.1, leg: 0.065, feet: "hoof", ears: "tall", tail: "stub" },
  cervine: { L: 1.0, H: 0.95, D: 0.52, W: 0.42, neck: 0.62, pitch: 62, head: 0.4, headW: 0.26, headH: 0.26, muzzle: 0.3, muzzleW: 0.15, drop: 0.08, leg: 0.05, feet: "hoof", ears: "pointed", tail: "stub" },
  canine: { L: 0.95, H: 0.58, D: 0.54, W: 0.42, neck: 0.36, pitch: 40, head: 0.4, headW: 0.34, headH: 0.33, muzzle: 0.26, muzzleW: 0.2, drop: 0.03, leg: 0.065, feet: "paw", ears: "pointed", tail: "brush" },
  feline: { L: 1.0, H: 0.55, D: 0.48, W: 0.4, neck: 0.28, pitch: 32, head: 0.36, headW: 0.36, headH: 0.32, muzzle: 0.15, muzzleW: 0.2, drop: 0.02, leg: 0.07, feet: "paw", ears: "pointed", tail: "thin" },
  ursine: { L: 1.15, H: 0.55, D: 0.82, W: 0.74, neck: 0.3, pitch: 14, head: 0.46, headW: 0.42, headH: 0.38, muzzle: 0.26, muzzleW: 0.22, drop: 0.04, leg: 0.12, feet: "paw", plantigrade: true, ears: "round", tail: "stub", hump: 0.35 },
  bovine: { L: 1.35, H: 0.75, D: 0.82, W: 0.66, neck: 0.32, pitch: 12, head: 0.48, headW: 0.38, headH: 0.38, muzzle: 0.28, muzzleW: 0.3, drop: 0.1, leg: 0.075, feet: "hoof", ears: "side", tail: "tuft" },
  proboscid: { L: 1.3, H: 0.8, D: 0.95, W: 0.82, neck: 0.18, pitch: 20, head: 0.6, headW: 0.6, headH: 0.62, muzzle: 0.08, muzzleW: 0.3, drop: 0.12, leg: 0.15, feet: "hoof", ears: "none", tail: "tuft" },
  porcine: { L: 1.0, H: 0.38, D: 0.64, W: 0.56, neck: 0.16, pitch: 6, head: 0.42, headW: 0.4, headH: 0.36, muzzle: 0.2, muzzleW: 0.26, drop: 0, leg: 0.07, feet: "hoof", ears: "floppy", tail: "stub" },
  rodent: { L: 0.55, H: 0.22, D: 0.42, W: 0.4, neck: 0.1, pitch: 10, head: 0.36, headW: 0.34, headH: 0.3, muzzle: 0.14, muzzleW: 0.14, drop: 0.02, leg: 0.05, feet: "paw", ears: "round", tail: "thin" },
  lagomorph: { L: 0.6, H: 0.26, D: 0.46, W: 0.42, neck: 0.12, pitch: 28, head: 0.34, headW: 0.32, headH: 0.3, muzzle: 0.12, muzzleW: 0.16, drop: 0.02, leg: 0.055, feet: "paw", ears: "tall", tail: "stub" },
};

const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sc = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const deg = (r: number) => (r * 180) / Math.PI;

export function quadruped(b: QuadBuild): ShapeSpec {
  const { L, H, D, W, leg } = b;
  const cy = H + D / 2;
  const p = (b.pitch * Math.PI) / 180;

  // ------------------------------------------------------------ torso, neck
  const neckBase: V = [0, cy + D * 0.22, L * 0.5];
  const N: V = add(neckBase, [0, b.neck * Math.sin(p), b.neck * Math.cos(p)]);
  const body: ShapePrimitive[] = [
    { type: "capsule", axis: "z", at: [0, cy, 0], size: [W * 0.92, D * 0.86, L * 1.2], color: "main" },
    { type: "ellipsoid", at: [0, cy + D * 0.03, L * 0.26], size: [W * 1.04, D * 1.04, L * 0.72], color: "main" },
    { type: "ellipsoid", at: [0, cy + D * 0.06, -L * 0.32], size: [W * 0.98, D * 0.9, L * 0.62], color: "main" },
    ...(b.hump ? [{ type: "ellipsoid" as const, at: [0, cy + D * 0.42, L * 0.24] as V, size: [W * 0.78, D * b.hump * 1.6, L * 0.42] as V, color: "main" }] : []),
    { type: "tube", at: add(neckBase, sc(add(N, sc(neckBase, -1)), 0.5)), size: [W, b.neck, b.neck], points: [add(neckBase, [0, -D * 0.05, -L * 0.08]), add(neckBase, sc(add(N, sc(neckBase, -1)), 0.55)), N], radius: [D * 0.5, b.headH * 0.5], color: "main" },
    // Countershading: a darker back, a lighter belly and throat.
    { type: "ellipsoid", at: [0, cy + D * 0.55, -L * 0.04], size: [W * 0.9, D * 0.5, L * 1.2], color: "main-1", paint: true, blend: D * 0.45 },
    { type: "ellipsoid", at: [0, cy - D * 0.5, L * 0.04], size: [W * 0.95, D * 0.55, L * 1.05], color: "belly", paint: true, blend: D * 0.3 },
  ];

  // ------------------------------------------------------------ head
  const C: V = add(N, [0, b.headH * 0.32, b.head * 0.18]);
  const tilt = Math.atan2(b.drop, b.muzzle + b.head * 0.3);
  const mLen = b.muzzle + b.muzzleW;
  const M: V = add(C, [0, -b.headH * 0.12 - b.drop * 0.6, b.head * 0.3 + b.muzzle * 0.5]);
  const tip: V = add(M, [0, -Math.sin(tilt) * mLen * 0.5, Math.cos(tilt) * mLen * 0.5]);
  const eye: V = add(C, [b.headW * 0.36, b.headH * 0.1, b.head * 0.18]);
  const e = Math.max(b.headW * 0.11, 0.03);
  const head: ShapePrimitive[] = [
    { type: "ellipsoid", at: C, size: [b.headW, b.headH, b.head * 0.7], color: "main" },
    { type: "capsule", axis: "z", at: M, size: [b.muzzleW * 1.15, b.headH * 0.8, mLen], rotate: [deg(tilt), 0, 0], taper: [0.82, 0.68], color: "main" },
    // The cheek and jaw muscle at the back of the head, which makes it a wedge rather than a tube.
    { type: "ellipsoid", at: add(C, [b.headW * 0.22, -b.headH * 0.22, -b.head * 0.02]), size: [b.headW * 0.55, b.headH * 0.8, b.head * 0.62], color: "main", mirror: true },
    // The jaw, lighter underneath.
    { type: "ellipsoid", at: add(M, [0, -b.headH * 0.2, -b.muzzle * 0.12]), size: [b.muzzleW * 0.9, b.headH * 0.32, mLen * 0.82], rotate: [deg(tilt), 0, 0], color: "main" },
    { type: "ellipsoid", at: add(M, [0, -b.headH * 0.28, -b.muzzle * 0.05]), size: [b.muzzleW * 1.15, b.headH * 0.3, mLen * 1.05], rotate: [deg(tilt), 0, 0], color: "belly", paint: true, blend: b.headH * 0.08 },
    { type: "ellipsoid", at: add(C, [0, -b.headH * 0.38, -b.head * 0.1]), size: [b.headW * 0.8, b.headH * 0.35, b.head * 0.6], color: "belly", paint: true, blend: b.headH * 0.08 },
    { type: "ellipsoid", at: add(tip, [0, b.headH * 0.05, -b.muzzleW * 0.1]), size: [b.muzzleW * 0.5, b.headH * 0.16, b.muzzleW * 0.26], color: "neutral1", finish: "gloss" },
    // A brow over each eye, then the eye: small, dark and glossy, at the side of the head.
    { type: "ellipsoid", at: add(eye, [-b.headW * 0.06, e * 0.9, -e * 0.2]), size: [e * 2.4, e * 0.9, e * 2.2], color: "main", mirror: true },
    { type: "ellipsoid", at: eye, size: [e, e * 1.1, e * 1.2], color: "neutral1", finish: "gloss", mirror: true },
    ...ears(b, C),
  ];

  // ------------------------------------------------------------ legs
  const x = W * 0.3;
  const footH = H * 0.07;
  const fx = x + (b.splay ?? 0) * H * 1.15;
  const foot = (z: number): ShapePrimitive => b.feet === "hoof"
    ? { type: "cylinder", at: [fx, footH * 0.6, z], size: [leg * 2.3, footH * 1.2, leg * 2.4], taper: 0.85, color: "main-2", blend: leg * 0.3 }
    : { type: "ellipsoid", at: [fx, footH * 0.6, z + leg * 0.4], size: [leg * 2.1, footH * 1.4, leg * 2.8], color: "main" };
  const sp = (b.splay ?? 0) * H;
  const front: ShapePrimitive[] = [
    { type: "ellipsoid", at: [x * 1.08, cy - D * 0.08, L * 0.36], size: [W * 0.34, D * 0.85, L * 0.32], color: "main" },
    { type: "tube", at: [x, H * 0.5, L * 0.38], size: [leg, H, leg], points: [[x, cy - D * 0.15, L * 0.38], [x + sp * 0.8, H * 0.62 + sp * 0.3, L * 0.34], [x + sp * 1.1, H * 0.22, L * 0.38], [x + sp * 1.15, footH, L * 0.4]], radius: [leg * 1.75, leg * 0.8], color: "main" },
    foot(L * 0.4),
  ];
  const hock: V = b.plantigrade ? [x, H * 0.14, -L * 0.42] : [x, H * 0.34, -L * 0.5];
  const back: ShapePrimitive[] = [
    { type: "ellipsoid", at: [x * 1.08, cy - D * 0.1, -L * 0.34], size: [W * 0.4, D * 0.98, L * 0.42], color: "main" },
    { type: "tube", at: [x, H * 0.5, -L * 0.4], size: [leg, H, leg], points: [[x, cy - D * 0.22, -L * 0.36], [x + sp * 0.8, H * 0.7 + sp * 0.3, -L * 0.28], add(hock, [sp * 1.1, 0, 0]), [x + sp * 1.15, footH, -L * 0.45]], radius: [leg * 1.9, leg * 0.8], color: "main" },
    foot(-L * 0.45),
  ];

  const parts: ShapePartSpec[] = [
    { name: "body", anim: "body", shapes: body },
    { name: "head", anim: "head", pivot: N, shapes: head },
    { name: "front leg", anim: "legL", mirror: true, pivot: [x, cy - D * 0.05, L * 0.38], shapes: front },
    { name: "back leg", anim: "legR", mirror: true, pivot: [x, cy - D * 0.05, -L * 0.36], shapes: back },
  ];
  const t = tail(b, cy);
  if (t) parts.push(t);
  return { parts, blend: L * 0.035 };
}

function ears(b: QuadBuild, C: V): ShapePrimitive[] {
  const { headW: w, headH: h, head } = b;
  switch (b.ears) {
    case "tall": return [
      { type: "cone", at: add(C, [w * 0.24, h * 0.62, -head * 0.12]), size: [w * 0.22, h * 0.75, w * 0.12], rotate: [-12, 0, -10], color: "main", mirror: true },
      { type: "cone", at: add(C, [w * 0.24, h * 0.6, -head * 0.12 + w * 0.04]), size: [w * 0.12, h * 0.55, w * 0.06], rotate: [-12, 0, -10], color: "main-1", paint: true, mirror: true },
    ];
    case "pointed": return [
      { type: "cone", at: add(C, [w * 0.3, h * 0.6, -head * 0.1]), size: [w * 0.38, h * 0.8, w * 0.16], rotate: [-8, 0, -14], color: "main", mirror: true },
      { type: "cone", at: add(C, [w * 0.3, h * 0.56, -head * 0.1 + w * 0.06]), size: [w * 0.2, h * 0.55, w * 0.08], rotate: [-8, 0, -14], color: "belly", paint: true, mirror: true },
    ];
    case "round": return [
      { type: "ellipsoid", at: add(C, [w * 0.38, h * 0.42, -head * 0.1]), size: [w * 0.3, w * 0.3, w * 0.12], color: "main", mirror: true },
    ];
    case "floppy": return [
      { type: "ellipsoid", at: add(C, [w * 0.36, h * 0.35, head * 0.05]), size: [w * 0.34, w * 0.08, w * 0.42], rotate: [-30, 0, -35], color: "main", mirror: true },
    ];
    case "none": return [];
    case "side": return [
      { type: "ellipsoid", at: add(C, [w * 0.62, h * 0.2, -head * 0.1]), size: [w * 0.45, w * 0.12, w * 0.26], rotate: [0, 0, -15], color: "main", mirror: true },
    ];
  }
}

function tail(b: QuadBuild, cy: number): ShapePartSpec | null {
  const T: V = [0, cy + b.D * 0.28, -b.L * 0.62];
  const r = b.leg;
  const part = (shapes: ShapePrimitive[]): ShapePartSpec => ({ name: "tail", anim: "tail", pivot: T, shapes });
  const t = b.L * 0.75;
  switch (b.tail) {
    case "brush": return part([{ type: "tube", at: add(T, [0, -t * 0.3, -t * 0.3]), size: [r, t, t], points: [T, add(T, [0, -t * 0.1, -t * 0.22]), add(T, [0, -t * 0.4, -t * 0.38]), add(T, [0, -t * 0.72, -t * 0.4])], radius: [r * 1.3, r * 2.3], color: "main" },
      { type: "ellipsoid", at: add(T, [0, -t * 0.72, -t * 0.4]), size: [r * 4.6, r * 3.6, r * 4.6], color: "main-1", paint: true, blend: r }]);
    case "thin": return part([{ type: "tube", at: add(T, [0, -t * 0.2, -t * 0.5]), size: [r, t, t], points: [T, add(T, [0, -t * 0.32, -t * 0.25]), add(T, [0, -t * 0.4, -t * 0.62]), add(T, [0, -t * 0.12, -t * 0.95])], radius: [r * 0.6, r * 0.45], color: "main" }]);
    case "tuft": return part([
      { type: "tube", at: add(T, [0, -t * 0.4, -t * 0.08]), size: [r, t, t], points: [T, add(T, [0, -t * 0.3, -t * 0.08]), add(T, [0, -t * 0.75, -t * 0.06])], radius: [r * 0.5, r * 0.35], color: "main" },
      { type: "ellipsoid", at: add(T, [0, -t * 0.8, -t * 0.06]), size: [r * 1.6, r * 2.6, r * 1.6], color: "main-2" },
    ]);
    case "stub": return part([{ type: "ellipsoid", at: add(T, [0, -b.D * 0.04, b.L * 0.02]), size: [r * 2.4, r * 2.6, r * 2.6], rotate: [-30, 0, 0], color: "main" }]);
    default: return null;
  }
}

export const ANATOMY_TEMPLATES: Record<string, ShapeSpec> = Object.fromEntries(Object.entries(BUILDS).map(([k, b]) => [k, quadruped(b)]));

// ================================================================== people
/**
 * Upright people from proportions. Height is measured in heads: 7 for a person, 7.5–8 for a hero,
 * 5 for a dwarf or goblin (the big head is what makes them small). Colours by role: `main` is the
 * top (tunic, coat), `accent` the legs (trousers), `belly` the trim (belt, collar, cuffs); skin and
 * hair are the build's own palette colours.
 */
export interface PersonBuild {
  heads: number;
  /** Shoulder half-width and hip half-width, in head heights. */
  shoulders: number; hips: number;
  /** Limb radius, in head heights. */
  limb: number;
  skin: string; skinDark: string; hair: string;
  ears?: "round" | "pointed" | "long";
  /** A robe or long coat over the legs. */
  robe?: boolean;
}

export const PEOPLE: Record<string, PersonBuild> = {
  person: { heads: 6.5, shoulders: 0.95, hips: 0.72, limb: 0.13, skin: "orange5", skinDark: "orange4", hair: "orange1" },
  hero: { heads: 7, shoulders: 1.12, hips: 0.74, limb: 0.15, skin: "orange5", skinDark: "orange4", hair: "orange1" },
  elf: { heads: 7.1, shoulders: 0.88, hips: 0.68, limb: 0.115, skin: "orange5", skinDark: "orange4", hair: "yellow4", ears: "pointed" },
  dwarf: { heads: 4.8, shoulders: 1.2, hips: 0.95, limb: 0.19, skin: "orange5", skinDark: "orange4", hair: "red2" },
  goblin: { heads: 5, shoulders: 0.85, hips: 0.7, limb: 0.13, skin: "green3", skinDark: "green2", hair: "neutral2", ears: "long" },
  orc: { heads: 6.6, shoulders: 1.32, hips: 0.85, limb: 0.19, skin: "green2", skinDark: "green1", hair: "neutral1" },
  mage: { heads: 6.8, shoulders: 0.92, hips: 0.75, limb: 0.125, skin: "orange5", skinDark: "orange4", hair: "neutral7", robe: true },
};

export function person(b: PersonBuild): ShapeSpec {
  const total = 2.0;
  const h = total / b.heads; // head height
  const hw = h * 0.78, hd = h * 0.9;
  const hc = total - h / 2;
  const shY = total - h * 1.4;
  const sw = h * b.shoulders, hw2 = h * b.hips;
  const hipY = total * (b.heads >= 6 ? 0.5 : 0.42);
  const limb = h * b.limb * 1.2;
  const waistY = hipY + h * 0.55;
  const body: ShapePrimitive[] = [
    // Chest first (the frame features measure from), then waist and pelvis: a V from shoulders to hips.
    { type: "ellipsoid", at: [0, shY - h * 0.65, 0], size: [sw * 2, h * 1.55, h * 0.95], color: "main" },
    { type: "ellipsoid", at: [0, waistY + h * 0.05, 0], size: [sw * 1.45, h * 1.0, h * 0.78], color: "main" },
    { type: "ellipsoid", at: [0, hipY + h * 0.12, 0], size: [hw2 * 2.05, h * 0.75, h * 0.82], color: "accent" },
    { type: "box", at: [0, waistY - h * 0.12, 0], size: [sw * 1.52, h * 0.2, h * 0.86], round: h * 0.06, color: "belly" },
    { type: "capsule", at: [0, shY + h * 0.18, -h * 0.02], size: [hw * 0.55, h * 0.5, hw * 0.55], color: b.skin },
    // A collar at the neckline.
    { type: "torus", at: [0, shY + h * 0.02, 0], size: [hw * 0.9, h * 0.12, hw * 0.8], color: "belly" },
    ...(b.robe ? [{ type: "cone" as const, at: [0, hipY * 0.52, 0] as V, size: [hw2 * 2.6, hipY * 1.05, h * 1.25] as V, color: "main" }] : []),
  ];
  const ear: ShapePrimitive[] = b.ears === "pointed" || b.ears === "long"
    ? [{ type: "cone", axis: "x", at: [hw * (b.ears === "long" ? 0.75 : 0.58), hc + h * 0.06, -hd * 0.05], size: [hw * (b.ears === "long" ? 0.7 : 0.4), h * 0.2, hw * 0.1], rotate: [0, 0, 22], color: b.skin, mirror: true }]
    : [{ type: "ellipsoid", at: [hw * 0.48, hc, -hd * 0.05], size: [hw * 0.14, h * 0.24, hd * 0.2], color: b.skin, mirror: true }];
  const head: ShapePrimitive[] = [
    { type: "ellipsoid", at: [0, hc, 0], size: [hw, h, hd], color: b.skin },
    { type: "ellipsoid", at: [0, hc - h * 0.24, hd * 0.1], size: [hw * 0.78, h * 0.5, hd * 0.72], color: b.skin },
    { type: "ellipsoid", at: [0, hc - h * 0.04, hd * 0.47], size: [hw * 0.14, h * 0.2, hd * 0.18], color: b.skinDark },
    { type: "box", at: [0, hc + h * 0.1, hd * 0.42], size: [hw * 0.7, h * 0.05, hd * 0.12], round: h * 0.02, color: b.hair },
    { type: "ellipsoid", at: [hw * 0.19, hc + h * 0.02, hd * 0.42], size: [hw * 0.14, h * 0.1, hd * 0.1], color: "neutral1", finish: "gloss", mirror: true },
    { type: "box", at: [0, hc - h * 0.24, hd * 0.44], size: [hw * 0.3, h * 0.03, hd * 0.06], round: h * 0.01, color: b.skinDark, paint: true },
    ...ear,
    // Hair: a cap over the top and back, leaving the face.
    { type: "ellipsoid", at: [0, hc + h * 0.17, -hd * 0.08], size: [hw * 1.1, h * 0.78, hd * 1.02], color: b.hair },
  ];
  const ax = sw * 0.98, armLen = h * 2.5;
  const elbow: V = [ax + h * 0.06, shY - armLen * 0.5, -h * 0.02];
  const wrist: V = [ax + h * 0.08, shY - armLen * 0.93, h * 0.08];
  const arm: ShapePrimitive[] = [
    { type: "tube", at: elbow, size: [limb, armLen, limb], points: [[ax, shY - h * 0.05, 0], elbow, wrist], radius: [limb * 1.1, limb * 0.8], color: "main" },
    { type: "ellipsoid", at: add(wrist, [0, -h * 0.16, h * 0.02]), size: [limb * 1.7, h * 0.36, limb * 1.45], color: b.skin },
    { type: "ellipsoid", at: [ax - h * 0.04, shY - h * 0.1, 0], size: [limb * 2.6, h * 0.55, limb * 2.6], color: "main" },
    { type: "torus", at: add(wrist, [0, h * 0.04, 0]), size: [limb * 2.1, h * 0.08, limb * 2.1], color: "belly" },
  ];
  const lx = hw2 * 0.55;
  const knee: V = [lx, hipY * 0.5, h * 0.04];
  const ankle: V = [lx, h * 0.28, 0];
  const legPart: ShapePrimitive[] = [
    { type: "tube", at: knee, size: [limb, hipY, limb], points: [[lx, hipY + h * 0.05, 0], knee, ankle], radius: [limb * 1.55, limb * 0.95], color: "accent" },
    // Boots: a shaft and a foot.
    { type: "cylinder", at: [lx, h * 0.42, 0.0], size: [limb * 2.25, h * 0.75, limb * 2.25], taper: 1.05, color: "neutral2", blend: 0 },
    { type: "box", at: [lx, h * 0.1, h * 0.16], size: [limb * 2.2, h * 0.2, h * 0.75], round: h * 0.08, color: "neutral2", blend: 0 },
  ];
  return {
    blend: h * 0.08,
    parts: [
      { name: "body", anim: "body", shapes: body },
      { name: "head", anim: "head", pivot: [0, shY + h * 0.3, 0], shapes: head },
      { name: "arm", anim: "armL", mirror: true, pivot: [ax, shY - h * 0.05, 0], shapes: arm },
      { name: "leg", anim: "legL", mirror: true, pivot: [lx, hipY + h * 0.05, 0], shapes: legPart },
    ],
  };
}

export const PEOPLE_TEMPLATES: Record<string, ShapeSpec> = Object.fromEntries(Object.entries(PEOPLE).map(([k, b]) => [k, person(b)]));

// ================================================================== birds
/**
 * Flying birds from proportions: a teardrop body (deep chest, tapering to the tail), a round head
 * with a beak (hooked for raptors), a brow over the eye, a fanned tail of feathers, talons tucked
 * under the belly, and broad layered wings (coverts over the flight feathers, fingered primaries).
 */
export interface BirdBuild {
  /** Body length, wing span (one wing), wing chord at the root, tail length. */
  L: number; span: number; chord: number; tail: number;
  head: number; beak: number; hooked?: boolean;
  /** Tail feathers fanned (spread, degrees) and how many each side of the middle. */
  fan: number;
}

export const BIRDS: Record<string, BirdBuild> = {
  raptor: { L: 1.0, span: 1.5, chord: 0.62, tail: 0.5, head: 0.34, beak: 0.16, hooked: true, fan: 40 },
  songbird: { L: 0.9, span: 1.0, chord: 0.45, tail: 0.45, head: 0.36, beak: 0.12, fan: 25 },
  longtail: { L: 0.9, span: 1.1, chord: 0.45, tail: 1.1, head: 0.36, beak: 0.16, hooked: true, fan: 12 },
};

export function bird(b: BirdBuild): ShapeSpec {
  const { L } = b;
  const y = 1.0;
  const hc: V = [0, y + L * 0.16, L * 0.5];
  const body: ShapePrimitive[] = [
    { type: "ellipsoid", at: [0, y, L * 0.05], size: [L * 0.5, L * 0.48, L * 0.95], color: "main" },
    { type: "ellipsoid", at: [0, y - L * 0.04, L * 0.22], size: [L * 0.48, L * 0.5, L * 0.55], color: "main" },
    { type: "cone", axis: "z", at: [0, y + L * 0.02, -L * 0.38], size: [L * 0.32, L * 0.24, L * 0.5], rotate: [0, 180, 0], color: "main" },
    { type: "ellipsoid", at: [0, y - L * 0.14, L * 0.12], size: [L * 0.42, L * 0.3, L * 0.8], color: "belly", paint: true, blend: L * 0.06 },
    { type: "ellipsoid", at: [0, y + L * 0.2, -L * 0.05], size: [L * 0.4, L * 0.2, L * 0.85], color: "main-1", paint: true, blend: L * 0.06 },
    // Talons tucked under the belly.
    { type: "ellipsoid", at: [L * 0.1, y - L * 0.25, -L * 0.08], size: [L * 0.09, L * 0.08, L * 0.18], color: "yellow4", mirror: true },
  ];
  const h = b.head;
  const beakAt: V = add(hc, [0, -h * 0.08, h * 0.5 + b.beak * 0.35]);
  const head: ShapePrimitive[] = [
    { type: "ellipsoid", at: hc, size: [h * 0.85, h * 0.85, h], color: "main" },
    { type: "cone", axis: "z", at: beakAt, size: [h * 0.32, h * 0.3, b.beak], color: "yellow4" },
    ...(b.hooked ? [{ type: "tube" as const, at: beakAt, size: [h, h, h] as V, points: [add(beakAt, [0, h * 0.08, -b.beak * 0.1]), add(beakAt, [0, h * 0.06, b.beak * 0.45]), add(beakAt, [0, -h * 0.12, b.beak * 0.6])] as V[], radius: [h * 0.09, h * 0.02] as [number, number], color: "yellow4" }] : []),
    { type: "ellipsoid", at: add(hc, [h * 0.3, h * 0.1, h * 0.2]), size: [h * 0.2, h * 0.08, h * 0.24], rotate: [0, 0, -15], color: "main-1", mirror: true },
    { type: "ellipsoid", at: add(hc, [h * 0.34, h * 0.04, h * 0.22]), size: [h * 0.11, h * 0.12, h * 0.1], color: "neutral1", finish: "gloss", mirror: true },
  ];
  const P: V = [L * 0.2, y + L * 0.1, L * 0.15];
  const S = b.span, C = b.chord;
  const wing: ShapePrimitive[] = [
    // Leading edge (the arm), the inner wing, coverts, then the flight feathers fanned at the tip.
    { type: "tube", at: add(P, [S / 2, S * 0.1, 0]), size: [S, S * 0.3, C], points: [P, add(P, [S * 0.42, S * 0.12, C * 0.12]), add(P, [S * 0.78, S * 0.16, -C * 0.05])], radius: [C * 0.14, C * 0.06], color: "main" },
    { type: "ellipsoid", at: add(P, [S * 0.38, S * 0.06, -C * 0.28]), size: [S * 0.8, C * 0.09, C], rotate: [0, -4, 8], color: "main" },
    { type: "ellipsoid", at: add(P, [S * 0.36, S * 0.08, -C * 0.12]), size: [S * 0.7, C * 0.1, C * 0.5], rotate: [0, -4, 8], color: "main-1", paint: true, blend: C * 0.05 },
    { type: "ellipsoid", at: add(P, [S * 0.12, S * 0.02, -C * 0.68]), size: [C * 0.2, C * 0.05, C * 0.62], rotate: [0, 4, 6], color: "main", repeat: { count: 4, offset: [S * 0.13, S * 0.016, 0], rotate: [0, -3, 0] } },
    { type: "ellipsoid", at: add(P, [S * 0.74, S * 0.13, -C * 0.4]), size: [C * 0.16, C * 0.05, C * 0.85], rotate: [0, -10, 8], color: "accent", repeat: { count: 5, offset: [S * 0.055, S * 0.01, C * 0.06], rotate: [0, -11, 0], scale: 0.96 } },
  ];
  const T: V = [0, y + L * 0.03, -L * 0.55];
  const n = b.fan > 20 ? 3 : 2;
  const tail: ShapePrimitive[] = Array.from({ length: n * 2 + 1 }, (_, i) => {
    const k = i - n, a = (k / n) * b.fan;
    const r = (a * Math.PI) / 180;
    return { type: "ellipsoid" as const, at: add(T, [Math.sin(r) * b.tail * 0.45, -Math.abs(k) * L * 0.01, -Math.cos(r) * b.tail * 0.45]) as V, size: [L * 0.13, L * 0.04, b.tail] as V, rotate: [-6, a, 0] as V, color: k === 0 ? "accent" : "main" };
  });
  return {
    blend: L * 0.04,
    parts: [
      { name: "body", anim: "body", shapes: body },
      { name: "head", anim: "head", pivot: add(hc, [0, -h * 0.2, -h * 0.4]), shapes: head },
      { name: "wing", anim: "wingL", mirror: true, pivot: P, shapes: wing },
      { name: "tail", anim: "tail", pivot: T, shapes: tail },
    ],
  };
}

export const BIRD_TEMPLATES: Record<string, ShapeSpec> = Object.fromEntries(Object.entries(BIRDS).map(([k, b]) => [k, bird(b)]));

// ================================================================== dragons
/** A dragon: a reptile on four legs with a long neck and tail (wings are added by the feature kit). */
export const DRAGON: QuadBuild = { L: 1.3, H: 0.5, D: 0.62, W: 0.62, neck: 0.75, pitch: 38, head: 0.5, headW: 0.34, headH: 0.3, muzzle: 0.42, muzzleW: 0.24, drop: 0.02, leg: 0.085, feet: "paw", ears: "none", tail: "none" };

/** A four-legged body with a long whip tail, thick at the root (chained, so it swings with follow-through). */
function withWhipTail(b: QuadBuild, length: number): ShapeSpec {
  const s = quadruped(b);
  const cy = b.H + b.D / 2;
  const T: V = [0, cy + b.D * 0.1, -b.L * 0.6];
  const k = length / 2.1;
  s.parts.push({ name: "tail", anim: "tail", pivot: T, shapes: [{ type: "tube", at: add(T, [0, -0.2 * k, -0.9 * k]), size: [0.5, 0.5, length], points: [T, add(T, [0, -0.12 * k, -0.6 * k]), add(T, [0.15 * k, -0.2 * k, -1.2 * k]), add(T, [-0.1 * k, -Math.min(0.1 * k, cy * 0.6), -1.7 * k]), add(T, [0, -Math.min(0.05, cy * 0.5), -2.1 * k])], radius: [b.D * 0.36, 0.03], color: "main" }] });
  return s;
}

export const DRAGON_TEMPLATE: ShapeSpec = withWhipTail(DRAGON, 2.1);

/** Lizards, crocodiles, dinosaurs: low, splayed legs, a long jaw and a long tail. */
export const SAURIAN: QuadBuild = { L: 1.35, H: 0.3, D: 0.42, W: 0.58, neck: 0.18, pitch: 6, head: 0.36, headW: 0.34, headH: 0.24, muzzle: 0.6, muzzleW: 0.24, drop: 0, leg: 0.07, feet: "paw", ears: "none", tail: "none", splay: 0.7 };
export const SAURIAN_TEMPLATE: ShapeSpec = withWhipTail(SAURIAN, 1.8);
