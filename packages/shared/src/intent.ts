import { ARCS, type ArcKind } from "./arcs";
import type { HappeningDef, HappeningEffect } from "./happenings";
import type { Standards } from "./standards";
import { normalizeDesign } from "./summons/design";
import { withJaw } from "./summons/features";
import { asMount } from "./summons/mounts";
import { designFromReading, type CreatureReading } from "./summons/skills";
import type { SummonSpec } from "./summons/spec";
import { vehicleSpec, type VehicleKind } from "./summons/vehicles";

/**
 * What a player asked for, as the model read it (server/src/interpreter.ts). One reading per
 * request: what kind of thing it is, and everything the game needs to make it. The game still
 * decides what's allowed: every reading goes through the same checks, costs and limits as before.
 * The keyword planners only read requests when no model is available (offline, and in tests).
 */
export const INTENT_KINDS = ["creature", "vehicle", "race", "hunt", "happening", "arc", "scenario", "build", "power", "unclear"] as const;
export type IntentKind = (typeof INTENT_KINDS)[number];

export interface VehicleReading { kind: VehicleKind; name: string; colors: { main: string; belly: string; accent: string } | null; size: number }
export interface RaceReading { title: string; laps: number; vehicle: VehicleKind }
export interface HuntReading { quarry: CreatureReading; minutes: number }
/** A rule event the model made up: which rules change and by how much, for how long. */
export interface HappeningReading { title: string; description: string; minutes: number; rules: { path: string; factor: number }[]; effect: HappeningEffect | null }
export interface ArcReading { arc: ArcKind; days: number }

export interface Intent {
  kind: IntentKind;
  /** A short name for banners ("Moon Gravity", "Frost Wyrm"). */
  title: string;
  /** What to tell the player: for "unclear", the question or the reason; otherwise a line about what's coming. */
  reply: string;
  /** For creature, and how many of it. */
  creature: CreatureReading | null;
  count: number;
  vehicle: VehicleReading | null;
  race: RaceReading | null;
  hunt: HuntReading | null;
  happening: HappeningReading | null;
  arc: ArcReading | null;
  /** For scenario, build and power: the request restated plainly for their planners. */
  request: string | null;
}

/**
 * The rules a happening may change, and how far (as a factor of their normal value). The model
 * picks from these; anything else is dropped. Players' size has its own limits (rules.ts).
 */
export const HAPPENING_RULES: { path: string; what: string; min: number; max: number }[] = [
  { path: "balance.player.gravity", what: "how strongly everyone falls", min: 0.2, max: 3 },
  { path: "balance.player.jumpBlocks", what: "how high everyone jumps", min: 0.5, max: 5 },
  { path: "balance.player.walkSpeed", what: "walking speed", min: 0.4, max: 2.5 },
  { path: "balance.player.sprintSpeed", what: "running speed", min: 0.4, max: 2.5 },
  { path: "balance.player.groundGrip", what: "grip on the ground (low = slippery, sliding)", min: 0.08, max: 3 },
  { path: "balance.player.fallDamageAfterBlocks", what: "how far you can fall unhurt", min: 0.5, max: 10 },
  { path: "balance.player.scale", what: "everyone's size", min: 0.35, max: 2.5 },
  { path: "balance.player.regenPerSecond", what: "how fast health comes back", min: 0.2, max: 4 },
  { path: "balance.mobs.nightSpawnChance", what: "how often monsters rise at night", min: 0.1, max: 3 },
  { path: "balance.mobs.hostileCap", what: "how many monsters can be about", min: 0.1, max: 3 },
];
export const HAPPENING_EFFECTS: HappeningEffect[] = ["peace", "night", "day", "lava"];

/** A happening from the model's reading: only allowed rules, factors within bounds, 1–15 minutes. */
export function happeningFromReading(r: HappeningReading): { def: HappeningDef; minutes: number; notes: string[] } {
  const notes: string[] = [];
  const rules: HappeningDef["rules"] = [];
  for (const { path, factor } of r.rules) {
    const allowed = HAPPENING_RULES.find((a) => a.path === path);
    if (!allowed || !Number.isFinite(factor)) { notes.push(`can't change ${path}`); continue; }
    const k = Math.min(allowed.max, Math.max(allowed.min, factor));
    if (k !== factor) notes.push(`${allowed.what}: ×${factor} is too far; made it ×${k}`);
    if (Math.abs(k - 1) > 1e-3 && !rules.some(([p]) => p === path)) rules.push([path, `×${Math.round(k * 1000) / 1000}`]);
  }
  const effect = r.effect && HAPPENING_EFFECTS.includes(r.effect) ? r.effect : undefined;
  const minutes = Math.max(1, Math.min(15, Math.round(r.minutes) || 5));
  const title = (r.title || "A Strange Day").slice(0, 40);
  return {
    def: { id: `custom_${title.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`, title, words: [], description: (r.description || title).slice(0, 200), rules, ...(effect ? { effect } : {}), minutes },
    minutes, notes,
  };
}

/** An arc from the model's reading (one of the arcs the game runs, 1–7 days). */
export function arcFromReading(r: ArcReading): { def: (typeof ARCS)[number]; days: number } | null {
  const def = ARCS.find((a) => a.id === r.arc);
  return def ? { def, days: Math.max(1, Math.min(7, Math.round(r.days) || def.days)) } : null;
}

/**
 * The creature a reading describes, as a summon spec: its design built from the reading, its
 * attacks (and a jaw to bite or breathe with), and a saddle if it's to be ridden.
 */
export function specFromReading(prompt: string, r: CreatureReading, std: Standards, count = 1): { spec?: SummonSpec; notes: string[] } {
  const d = designFromReading(prompt, r, std);
  if ("error" in d) return { notes: [d.error] };
  const n = normalizeDesign(d.start, std);
  if (!n.spec) return { notes: n.issues.filter((i) => i.level === "error").map((i) => i.message) };
  let spec: SummonSpec = { ...n.spec, prompt, count: Math.max(1, Math.min(8, Math.round(count) || 1)), abilities: d.start.abilities ?? [], ...(r.element ? { element: r.element } : {}), ...(r.role ? { role: r.role } : {}) };
  const fights = spec.temperament !== "passive" && spec.abilities.some((a) => a === "bite" || a === "breath" || a === "shot");
  if (fights && spec.shape) spec = { ...spec, shape: withJaw(spec.shape) };
  if (r.ride) spec = asMount(spec);
  return { spec, notes: d.brief.notes };
}

/** The vehicle a reading describes. */
export function vehicleFromReading(prompt: string, v: VehicleReading, std: Standards): SummonSpec {
  const palette = std.art.palette as Record<string, string>;
  const ok = v.colors && [v.colors.main, v.colors.belly, v.colors.accent].every((c) => c in palette);
  return vehicleSpec(v.kind, prompt, { name: v.name, size: v.size, ...(ok ? { colors: v.colors! } : {}) });
}
