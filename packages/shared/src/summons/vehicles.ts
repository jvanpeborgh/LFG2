import type { ShapePrimitive, ShapeSpec } from "./shape";
import { COLOR_WORDS, type SummonSpec } from "./spec";

/**
 * Vehicles you can imagine and drive: karts, cars, trucks, buggies, motorbikes. They're summons
 * with a `vehicle` kind: a model built from a template (body, cabin, wheels that spin as you go,
 * lights that glow), parked until someone climbs in, then driven like a car (W to go, S to brake
 * and reverse, A/D to steer, Shift to drift) by whoever summoned it (or the race that handed it
 * out). Colour words paint it ("a red sports car", "a neon green kart").
 */
export type VehicleKind = "kart" | "car" | "truck" | "buggy" | "bike";

export interface VehicleHandling {
  /** Top speed (blocks/s), with Shift a little more but sliding. */
  top: number;
  /** How fast it gets there, and how sharply it turns (radians/s at speed). */
  accel: number;
  turn: number;
  /** How much it grips (1 = on rails, lower slides more; drifting lowers it). */
  grip: number;
  /** Seat height above its wheels' base (blocks, at its own size). */
  seat: number;
}

interface VehicleDef {
  kind: VehicleKind;
  words: string[];
  name: string;
  length: number;
  colors: SummonSpec["colors"];
  handling: VehicleHandling;
  shape: () => ShapeSpec;
}

type V3 = [number, number, number];
const wheel = (x: number, y: number, z: number, r: number, w: number): ShapePrimitive[] => [
  { type: "cylinder", axis: "x", at: [x, y, z], size: [w, r * 2, r * 2], color: "neutral1" },
  { type: "cylinder", axis: "x", at: [x + Math.sign(x) * w * 0.05, y, z], size: [w * 1.02, r * 0.9, r * 0.9], color: "neutral6", finish: "metal" },
];
/** Four wheels, each its own spinning part (the "wheel" role), front pair and back pair. */
const wheels = (xw: number, zf: number, zb: number, r: number, w: number) => [
  { name: "wheel_front", anim: "wheel" as const, pivot: [0, r, zf] as V3, shapes: [...wheel(xw, r, zf, r, w), ...wheel(-xw, r, zf, r, w)] },
  { name: "wheel_back", anim: "wheel" as const, pivot: [0, r, zb] as V3, shapes: [...wheel(xw, r, zb, r, w), ...wheel(-xw, r, zb, r, w)] },
];
const lights = (x: number, y: number, z: number, s: number): ShapePrimitive[] => [
  { type: "box", at: [x, y, z], size: [s, s * 0.6, s * 0.3], color: "yellow5", finish: "glow", mirror: true },
];
const tail = (x: number, y: number, z: number, s: number): ShapePrimitive[] => [
  { type: "box", at: [x, y, z], size: [s, s * 0.5, s * 0.3], color: "red4", finish: "glow", mirror: true },
];

export const VEHICLES: VehicleDef[] = [
  {
    kind: "kart", words: ["kart", "karts", "go-kart", "gokart", "racer"], name: "Kart", length: 1.9,
    colors: { main: "red3", belly: "neutral2", accent: "yellow4" },
    handling: { top: 13, accel: 9, turn: 2.6, grip: 0.9, seat: 0.25 },
    shape: () => ({
      parts: [
        { name: "body", anim: "body", shapes: [
          { type: "box", at: [0, 0.32, 0], size: [1.1, 0.16, 1.8], color: "main", round: 0.06 },
          { type: "box", at: [0.48, 0.42, -0.1], size: [0.18, 0.2, 0.9], color: "main", round: 0.06, mirror: true },
          { type: "box", at: [0, 0.4, -0.1], size: [0.7, 0.04, 1.0], color: "belly" },
          { type: "wedge", at: [0, 0.45, 0.7], size: [0.9, 0.22, 0.45], rotate: [0, 180, 0], color: "main", round: 0.04 },
          { type: "box", at: [0, 0.48, -0.15], size: [0.55, 0.32, 0.5], color: "main", round: 0.08 },
          { type: "box", at: [0, 0.72, -0.35], size: [0.5, 0.4, 0.12], color: "neutral2", round: 0.05 },
          { type: "torus", axis: "z", at: [0, 0.7, 0.32], size: [0.32, 0.32, 0.06], rotate: [-25, 0, 0], color: "neutral1" },
          { type: "box", at: [0, 0.75, -0.95], size: [1.0, 0.06, 0.25], color: "accent" },
          { type: "box", at: [0.35, 0.58, -0.88], size: [0.06, 0.32, 0.06], color: "neutral2", mirror: true },
          { type: "cylinder", axis: "z", at: [0.2, 0.42, -0.95], size: [0.1, 0.1, 0.2], color: "neutral5", finish: "metal", mirror: true },
          { type: "box", at: [0, 0.38, 0.95], size: [1.1, 0.1, 0.12], color: "accent" },
        ] },
        ...wheels(0.5, 0.62, -0.62, 0.2, 0.22),
      ],
    }),
  },
  {
    kind: "car", words: ["car", "cars", "racecar", "sportscar", "supercar", "coupe", "taxi"], name: "Car", length: 4,
    colors: { main: "blue3", belly: "neutral2", accent: "neutral7" },
    handling: { top: 16, accel: 7, turn: 2.0, grip: 0.85, seat: 0.45 },
    shape: () => ({
      parts: [
        { name: "body", anim: "body", shapes: [
          { type: "box", at: [0, 0.6, 0], size: [1.8, 0.55, 4], color: "main", round: 0.18 },
          { type: "box", at: [0, 1.05, -0.25], size: [1.55, 0.5, 2.0], color: "main", round: 0.2 },
          { type: "box", at: [0, 1.06, -0.25], size: [1.58, 0.36, 1.7], color: "blue5", finish: "gloss" },
          { type: "box", at: [0, 0.38, 0], size: [1.85, 0.12, 4.02], color: "belly" },
          ...lights(0.6, 0.7, 2.0, 0.32), ...tail(0.65, 0.72, -2.0, 0.3),
          { type: "box", at: [0, 0.55, 2.02], size: [0.7, 0.18, 0.05], color: "neutral1" },
        ] },
        ...wheels(0.82, 1.3, -1.3, 0.36, 0.3),
      ],
    }),
  },
  {
    kind: "truck", words: ["truck", "trucks", "jeep", "pickup", "lorry", "van"], name: "Truck", length: 4.6,
    colors: { main: "green2", belly: "neutral3", accent: "neutral6" },
    handling: { top: 12, accel: 5, turn: 1.6, grip: 0.95, seat: 1.0 },
    shape: () => ({
      parts: [
        { name: "body", anim: "body", shapes: [
          { type: "box", at: [0, 1.0, 0.9], size: [2.0, 1.1, 1.9], color: "main", round: 0.15 },
          { type: "box", at: [0, 1.3, 0.85], size: [2.02, 0.5, 1.4], color: "blue5", finish: "gloss" },
          { type: "box", at: [0, 0.75, -1.2], size: [2.0, 0.6, 2.3], color: "main", round: 0.08 },
          { type: "box", at: [0, 1.05, -1.2], size: [1.8, 0.1, 2.1], color: "neutral2" },
          { type: "box", at: [0, 0.5, 0], size: [1.9, 0.2, 4.4], color: "belly" },
          ...lights(0.7, 0.9, 1.86, 0.36), ...tail(0.8, 0.85, -2.36, 0.3),
          { type: "box", at: [0, 0.5, 2.2], size: [2.1, 0.22, 0.15], color: "accent", finish: "metal" },
        ] },
        ...wheels(0.95, 1.4, -1.4, 0.5, 0.42),
      ],
    }),
  },
  {
    kind: "buggy", words: ["buggy", "buggies", "dune", "atv", "quad"], name: "Buggy", length: 2.8,
    colors: { main: "orange3", belly: "neutral2", accent: "neutral1" },
    handling: { top: 14, accel: 8, turn: 2.3, grip: 0.75, seat: 0.5 },
    shape: () => ({
      parts: [
        { name: "body", anim: "body", shapes: [
          { type: "box", at: [0, 0.55, 0], size: [1.3, 0.25, 2.6], color: "main", round: 0.1 },
          { type: "box", at: [0, 0.75, -0.3], size: [0.6, 0.35, 0.6], color: "belly", round: 0.1 },
          { type: "tube", points: [[0.55, 0.6, 0.5], [0.5, 1.45, 0.1], [0.5, 1.45, -0.7], [0.55, 0.6, -0.9]], radius: 0.05, color: "accent", mirror: true, at: [0.5, 1, -0.2], size: [0.1, 0.9, 1.4] },
          { type: "box", at: [0, 1.45, -0.3], size: [1.05, 0.06, 0.06], color: "accent" },
          ...lights(0.4, 0.7, 1.32, 0.2),
        ] },
        ...wheels(0.72, 0.95, -0.95, 0.38, 0.34),
      ],
    }),
  },
  {
    kind: "bike", words: ["motorbike", "motorcycle", "bike", "scooter", "moped"], name: "Motorbike", length: 2,
    colors: { main: "red3", belly: "neutral2", accent: "neutral6" },
    handling: { top: 15, accel: 9, turn: 2.8, grip: 0.8, seat: 0.55 },
    shape: () => ({
      parts: [
        { name: "body", anim: "body", shapes: [
          { type: "box", at: [0, 0.65, 0.05], size: [0.32, 0.3, 1.1], color: "main", round: 0.1 },
          { type: "box", at: [0, 0.82, -0.25], size: [0.28, 0.1, 0.55], color: "belly", round: 0.04 },
          { type: "cylinder", axis: "x", at: [0, 1.0, 0.62], size: [0.6, 0.05, 0.05], color: "accent", finish: "metal" },
          { type: "box", at: [0, 0.6, 0.72], size: [0.06, 0.6, 0.06], rotate: [20, 0, 0], color: "accent", finish: "metal" },
          { type: "box", at: [0, 0.85, 0.74], size: [0.16, 0.12, 0.08], color: "yellow5", finish: "glow" },
        ] },
        { name: "wheel_front", anim: "wheel", pivot: [0, 0.32, 0.72], shapes: wheel(0, 0.32, 0.72, 0.32, 0.14) },
        { name: "wheel_back", anim: "wheel", pivot: [0, 0.32, -0.7], shapes: wheel(0, 0.32, -0.7, 0.32, 0.16) },
      ],
    }),
  },
];

/** Is this a vehicle (and which)? The first vehicle word wins ("a monster truck"). */
export function vehicleFor(text: string): VehicleDef | undefined {
  const words: string[] = text.toLowerCase().match(/[a-z-]+/g) ?? [];
  // "a car" but not "a cart" or "a carp"; "bike" alone (not "a bike-sized spider").
  for (const w of words) {
    const v = VEHICLES.find((d) => d.words.includes(w));
    if (v) return v;
  }
  return undefined;
}

export function vehicleHandling(kind: VehicleKind): VehicleHandling {
  return VEHICLES.find((v) => v.kind === kind)!.handling;
}

const SIZE: Record<string, number> = { tiny: 0.6, small: 0.75, mini: 0.7, big: 1.3, large: 1.3, huge: 1.6, giant: 1.8, monster: 1.4 };

/** Plan a vehicle from words: its kind, name, colours (from colour words), size and model. */
export function planVehicle(text: string): SummonSpec | undefined {
  const v = vehicleFor(text);
  if (!v) return undefined;
  const words: string[] = text.toLowerCase().match(/[a-z-]+/g) ?? [];
  const colour = words.find((w) => COLOR_WORDS[w]);
  const colors = colour ? { main: COLOR_WORDS[colour][0], belly: v.colors.belly, accent: v.kind === "kart" ? COLOR_WORDS[colour][2] : v.colors.accent } : { ...v.colors };
  const size = words.reduce((k, w) => k * (SIZE[w] ?? 1), 1);
  const adj = words.filter((w) => COLOR_WORDS[w] || (SIZE[w] && w !== "monster"));
  const name = [...adj, words.includes("monster") && v.kind === "truck" ? "Monster" : "", words.includes("racing") || words.includes("racecar") ? "Race" : "", v.name]
    .filter(Boolean).join(" ").replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
    name, prompt: text, body: "blob",
    length: Math.round(v.length * Math.min(1.8, Math.max(0.6, size)) * 100) / 100,
    colors, features: [], movement: "walk", temperament: "passive", abilities: [], count: 1,
    seed: [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7) >>> 0,
    shape: v.shape(), vehicle: v.kind,
  };
}
