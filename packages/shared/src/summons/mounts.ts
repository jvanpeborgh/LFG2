import type { SummonSpec } from "./spec";
import type { SummonStats } from "./rules";

/**
 * Mounts: what you imagine, you can ride. Anything big enough to carry a player can be ridden by
 * the one who summoned it: horses gallop and jump, dragons and big birds fly, sharks and dolphins
 * swim, ships sail, giants carry you on their shoulders. How it rides comes from what it is.
 *
 * The rider's client moves the pair (like it moves a player on foot) using this profile; the
 * server checks moves against it and keeps the mount under its rider.
 */
export type MountMode = "ground" | "fly" | "swim" | "sail";

export interface MountProfile {
  mode: MountMode;
  /** Blocks per second: cruising, and with sprint held. */
  speed: number;
  sprint: number;
  /** Jump height in blocks (ground mounts). */
  jump: number;
  /** How high the rider sits above the mount's feet (blocks). */
  seat: number;
}

/** Smallest a creature can be and still carry someone (blocks long). */
export const MIN_MOUNT_LENGTH = 1.3;

/** How this summon rides, or why it can't be ridden. */
export function mountProfile(spec: SummonSpec, stats: SummonStats): MountProfile | { why: string } {
  if (spec.body === "cloud" || spec.movement === "drift") return { why: `${spec.name} drifts where the wind takes it; you can't steer it` };
  if (spec.role === "boss") return { why: "bosses don't let anyone ride them" };
  if (spec.temperament === "hostile") return { why: `${spec.name} is hostile and won't let you on (summon one "to ride" and it comes tame)` };
  const biped = spec.body === "biped";
  const min = biped ? 2.6 : MIN_MOUNT_LENGTH;
  if (spec.length < min) return { why: `${spec.name} is too small to ride (${biped ? "people" : "creatures"} need to be at least ${min} blocks${biped ? " tall: a giant" : " long"})` };
  const size = Math.min(4, spec.length);
  // Sit on its back (on a giant's shoulders; on a ship's deck).
  const seat = spec.body === "ship" ? Math.min(1.2, stats.height * 0.3) : Math.max(0.5, Math.min(3, stats.height * (biped ? 0.82 : 0.78)));
  if (spec.movement === "sail") return { mode: "sail", speed: 5.5, sprint: 7.5, jump: 0, seat };
  if (spec.movement === "swim") return { mode: "swim", speed: 6 + size * 0.5, sprint: 8 + size * 0.8, jump: 0, seat: Math.max(0.4, seat * 0.7) };
  if (spec.movement === "fly") return { mode: "fly", speed: 9 + size * 0.5, sprint: 13 + size, jump: 0, seat };
  // Walkers (and hoverers, which skim the ground): bigger strides go faster, slitherers and
  // crawlers less so; hoppers and long legs jump higher.
  const gait = spec.gait ?? "walk";
  const k = gait === "slither" || gait === "crawl" || gait === "waddle" ? 0.75 : gait === "stride" ? 1.1 : 1;
  const jump = gait === "hop" ? 3.2 : 1.3 + Math.min(1.2, size * 0.35);
  return { mode: "ground", speed: (6 + size * 0.9) * k, sprint: (8.5 + size * 1.3) * k, jump, seat };
}

export function isMountProfile(p: MountProfile | { why: string }): p is MountProfile {
  return "mode" in p;
}

/** Words that ask for something to ride. */
export const RIDE_WORDS = ["ride", "rideable", "riding", "mount", "steed", "saddled", "saddle", "rider"];

export function asksToRide(text: string): boolean {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  return words.some((w) => RIDE_WORDS.includes(w));
}

/**
 * Asked for as a mount ("a dragon I can ride", "a saddled horse"): tame (it still defends itself if
 * it has teeth), big enough to carry you, and wearing a saddle.
 */
export function asMount(spec: SummonSpec): SummonSpec {
  if (spec.body === "cloud") return spec;
  const min = spec.body === "biped" ? 2.8 : 1.8;
  return {
    ...spec,
    temperament: spec.temperament === "hostile" ? "neutral" : spec.temperament,
    role: undefined,
    length: Math.max(spec.length, min),
    features: spec.body === "ship" || spec.features.includes("saddle") ? spec.features : [...spec.features, "saddle"],
  };
}
