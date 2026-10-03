/**
 * Designs: summons written directly by an agent (or a person) as JSON, instead of planned from a
 * sentence by the keyword planner. A design is a SummonSpec plus, usually, a shape (see shape.ts).
 *
 * The loop an agent runs: read the guide → write a design → check it (errors and warnings come back
 * with JSON paths and hints) → look at renders → fix → save it to the world → players cast it like
 * any summon. Nothing here trusts the input: every field is checked, defaults fill what's missing,
 * and the same rules (size, colours, triangle budgets, the playtest) apply as for planned summons.
 */
import { hashString } from "../random";
import type { Standards } from "../standards";
import { generateModel } from "./generate";
import { MODEL_STYLES } from "./mesh";
import { checkSummon, fitSpecToRules, summonStats, type SummonReport, type SummonStats } from "./rules";
import { ANIM_ROLES, EXAMPLE_SHAPE, colorHint, PRIMITIVES, SHAPE_LIMITS, validateShape, type ShapeIssue, type ShapeSpec } from "./shape";
import { summonTier } from "../progression";
import type { BodyPlan, Movement, SummonSpec, Temperament } from "./spec";
import type { VoxelModel } from "./voxel";

const BODIES: BodyPlan[] = ["cloud", "fish", "bird", "quadruped", "blob", "biped", "ship"];
const MOVEMENTS: Movement[] = ["drift", "fly", "swim", "walk", "hover", "sail"];
const TEMPERAMENTS: Temperament[] = ["passive", "neutral", "hostile"];
const ABILITIES = ["bite", "slam", "rain"];
const DESIGN_ID = /^[a-z0-9][a-z0-9_-]{1,31}$/;

/** What an agent writes. Only name and either body or shape are needed; the rest has defaults. */
export interface DesignInput {
  id?: string;
  name: string;
  /** What it was meant to be, in words (kept for players and moderation). */
  description?: string;
  /** Generator to use when there's no shape, and the fallback if the shape has errors. */
  body?: BodyPlan;
  length?: number;
  colors?: Partial<SummonSpec["colors"]>;
  features?: string[];
  movement?: Movement;
  temperament?: Temperament;
  abilities?: string[];
  count?: number;
  role?: "boss";
  shape?: ShapeSpec;
  /** How it's drawn: voxel, smooth, lowpoly or sculpted. Leave it out to use the world's style. */
  style?: string;
}

/** The design's own id (what players cast it by), from its input. */
export function designId(input: DesignInput): string {
  return input.id ?? input.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 32);
}

export interface DesignCheck {
  ok: boolean;
  spec?: SummonSpec;
  issues: ShapeIssue[];
  /** The summon checks (size, budget, colours, readability), if it got that far. */
  report?: SummonReport;
  stats?: SummonStats;
  tier?: number;
  /** Changes the rules made (e.g. shortened to the limit), as notes. */
  fitted: string[];
  model?: VoxelModel;
}

/** Turn an agent's JSON into a spec, checking every field. */
export function normalizeDesign(input: unknown, std: Standards): { spec?: SummonSpec; issues: ShapeIssue[] } {
  const issues: ShapeIssue[] = [];
  const err = (path: string, message: string, hint: string) => issues.push({ path, level: "error", message, hint });
  const warn = (path: string, message: string, hint: string) => issues.push({ path, level: "warning", message, hint });
  const d = input as DesignInput;
  if (!d || typeof d !== "object") { err("", "a design is a JSON object", 'start from get_design_guide\'s example: { "name": "...", "movement": "walk", "shape": { ... } }'); return { issues }; }
  if (JSON.stringify(d).length > 32_000) { err("", "the design is too large (over 32 KB of JSON)", "use fewer primitives and leave out anything that isn't part of the format"); return { issues }; }
  if (typeof d.name !== "string" || !d.name.trim() || d.name.length > 32) err("name", "needs a name (1–32 characters)", 'e.g. "Lantern Moth"');
  const id = typeof d.name === "string" || d.id ? designId(d) : "";
  if (!DESIGN_ID.test(id)) err("id", `id "${id}" isn't usable`, "2–32 lowercase letters, numbers, _ or -");
  const oneOf = <T extends string>(key: keyof DesignInput, v: unknown, list: readonly T[], fallback: T): T => {
    if (v === undefined) return fallback;
    if (typeof v === "string" && (list as readonly string[]).includes(v)) return v as T;
    err(String(key), `"${String(v)}" isn't one of ${list.join(", ")}`, `pick one of ${list.join(", ")}`);
    return fallback;
  };
  const movement = oneOf("movement", d.movement, MOVEMENTS, "walk");
  const body = oneOf("body", d.body, BODIES, movement === "swim" ? "fish" : movement === "fly" ? "bird" : movement === "drift" ? "cloud" : movement === "sail" ? "ship" : "quadruped");
  const temperament = oneOf("temperament", d.temperament, TEMPERAMENTS, "passive");
  const num = (key: keyof DesignInput, v: unknown, lo: number, hi: number, fallback: number) => {
    if (v === undefined) return fallback;
    if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) { err(String(key), `${String(key)} must be a number from ${lo} to ${hi}`, `e.g. ${fallback}`); return fallback; }
    return v;
  };
  const length = num("length", d.length, 0.3, 60, 2);
  const count = Math.round(num("count", d.count, 1, std.summons.maxCountPerSummon, 1));
  const palette = std.art.palette as Record<string, string>;
  const colors = { main: "neutral5", belly: "neutral7", accent: "neutral2", ...(d.colors ?? {}) };
  for (const k of ["main", "belly", "accent"] as const) {
    if (!(colors[k] in palette)) err(`colors.${k}`, `"${colors[k]}" is not a palette key`, colorHint(String(colors[k]), palette));
  }
  const abilities = Array.isArray(d.abilities) ? d.abilities : temperament === "hostile" ? ["bite"] : [];
  abilities.forEach((a, i) => { if (!ABILITIES.includes(a)) err(`abilities[${i}]`, `unknown ability "${a}"`, `use ${ABILITIES.join(", ")}`); });
  if (abilities.includes("slam") && d.role !== "boss") warn("abilities", "slam is a boss move", 'add "role": "boss" (bosses follow the boss rules) or drop slam');
  if (d.role !== undefined && d.role !== "boss") err("role", `role "${d.role}"`, 'the only role is "boss"');
  if (temperament === "hostile" && !abilities.length) warn("abilities", "hostile but it can't hurt anyone", 'add "bite"');
  const features = Array.isArray(d.features) ? d.features.filter((f) => typeof f === "string").slice(0, 12) : [];
  if (d.shape !== undefined) issues.push(...validateShape(d.shape, std));
  else warn("shape", "no shape: the body plan's generator draws it", "add a shape to control exactly how it looks (get_design_guide has the primitives)");
  if (d.style !== undefined && !MODEL_STYLES.includes(d.style as never)) err("style", `unknown style "${d.style}"`, `use ${MODEL_STYLES.join(", ")}, or leave it out for the world's style`);
  if (d.style !== undefined && (std.art as { promptStyles?: boolean }).promptStyles === false) warn("style", "this world draws everything in its own style", `it will be drawn ${(std.art as { modelStyle?: string }).modelStyle ?? "voxel"}`);
  if (d.description !== undefined && (typeof d.description !== "string" || d.description.length > 300)) err("description", "too long", "at most 300 characters");
  if (issues.some((i) => i.level === "error")) return { issues };
  // The id carries a hash of the design, so a revised design is a new entity type (clients rebuild it).
  const seed = hashString(JSON.stringify(d)) >>> 0;
  const spec: SummonSpec = {
    id: `design_${id}_${seed.toString(36)}`, name: d.name.trim(), prompt: (d.description ?? d.name).trim(), body, length, colors, features, movement, temperament,
    abilities, count, seed, ...(d.role ? { role: d.role } : {}), ...(d.shape ? { shape: d.shape } : {}), ...(d.style ? { style: d.style as SummonSpec["style"] } : {}),
  };
  return { spec, issues };
}

/** Everything short of the playtest (which needs a world): normalize, fit the rules, build, check. */
export function checkDesign(input: unknown, std: Standards): DesignCheck {
  const n = normalizeDesign(input, std);
  if (!n.spec) return { ok: false, issues: n.issues, fitted: [] };
  const tier = summonTier(n.spec).tier;
  const fitted = fitSpecToRules(n.spec, std, tier);
  const spec = fitted.spec;
  const model = generateModel(spec, std);
  const report = checkSummon(spec, model, std, tier);
  const stats = summonStats(spec, model, std);
  return { ok: report.ok && !n.issues.some((i) => i.level === "error"), spec, issues: n.issues, report, stats, tier, fitted: fitted.notes, model };
}

/** What an agent needs to write designs for a world: the format, the limits and this world's colours. */
export function designGuide(std: Standards) {
  const P = std.art.palette as Record<string, string>;
  return {
    bestPractices: "Read get_design_skill(\"design-best-practices\") first: the loop, prompt words, proportions by mood, a primitive cookbook, colour, style, and the mistakes to avoid.",
    howTo: [
      "Write a design as JSON: name, movement, temperament, length (blocks; a player is 1.8 tall), colors, and a shape made of primitives.",
      "Axes: +y up, +z forward (where it faces and moves), +x is its left. Units are your own: the whole shape is scaled so its longest side is `length` blocks.",
      "Later primitives paint over earlier ones; `cut: true` carves. Mirror a part (`mirror: true`) to get the other side; write the +x side with a left role (wingL, finL, legL, armL).",
      "Give moving pieces their own part with an anim role and a pivot where they join (a wing at the shoulder). Parts must touch the body.",
      "Use 3–8 parts and 8–40 primitives. Big simple forms first, then a few details that read from 20 m away (eyes, a contrasting belly, a crest).",
      "check_design returns issues with JSON paths and hints; fix them and check again (2–3 rounds is normal). render_design shows six views in the world's style.",
      "Start from interpret_prompt: it reads the player's words as a brief (skill, mood, proportions) and gives a starting design. Pass the same prompt to check_design and render_design for a critique against the brief.",
      "Reach for tubes for anything that curves (tails, necks, horns, tentacles), repeat for rows (spines, teeth, ribs), round for soft boxes, taper for claws and tusks.",
      "Finishes: gloss for wet or polished, metal for armour, glow for eyes, lanterns and magic (it shows at night). In the sculpted style, blend sets soft joins (necks, shoulders) and 0 keeps hard edges (belts, armour).",
    ],
    fields: {
      name: "1–32 characters", id: "optional; 2–32 of a-z 0-9 _ -", description: "what it is, in words (optional)",
      movement: MOVEMENTS, temperament: TEMPERAMENTS, abilities: ABILITIES, role: '"boss" for big hostile things (longer warnings, area attacks)',
      body: `${BODIES.join(", ")}: the generator used when there's no shape (or the shape has errors)`,
      length: `0.3–${std.summons.maxLengthBlocks} blocks (hostile: ${std.summons.hostileMaxLengthBlocks} unless a boss)`, count: `1–${std.summons.maxCountPerSummon}`,
      colors: "{ main, belly, accent }: palette keys; primitives use these roles or palette keys directly",
      style: `optional: ${MODEL_STYLES.join(", ")}. Everyone sees it drawn this way (if the world lets prompts choose, art.promptStyles); leave it out for the world's style`,
    },
    shape: {
      primitives: PRIMITIVES, animRoles: ANIM_ROLES, limits: SHAPE_LIMITS,
      primitive: "{ type, at: [x,y,z] centre, size: [w,h,d] full size, rotate?: [deg x, y, z], axis?: x|y|z (cylinder, cone, capsule, torus; a cone points to +axis), color?: role or palette key, cut?: true, mirror?: true, finish?: matte|gloss|metal|glow, blend?: soft-join size in the sculpted style }",
      tube: '{ type: "tube", points: [[x,y,z], …2–16], radius: r or [start, end], color, finish? }: tails, tentacles, necks, horns, vines, antlers. The path can curve; the radius tapers along it.',
      modifiers: "round: corner radius (soft boxes); taper: scale at the +axis end (0.3 = narrows to a tusk; or [x, z]); twist: degrees along the axis (horns, drills); repeat: { count, offset, rotate?, scale? } for rows of spines, teeth, ribs, scales",
      shapeBlend: "optional shape-level `blend`: the default soft join for the sculpted style (3% of the longest side if left out)",
      part: "{ name, anim?, pivot?: [x,y,z], mirror?: true, shapes: [primitives] }",
    },
    palette: P,
    reserved: { ...std.art.reserved, note: "reserved colours keep their meaning; danger (red) only on things that hurt" },
    modelStyle: (std.art as { modelStyle?: string }).modelStyle ?? "voxel",
    modelStyles: MODEL_STYLES,
    budgets: std.locked.assetBudgets,
    voxelsAlongLongestSide: std.summons.maxVoxelsAlongLongestSide,
    example: { name: "Pond Gulper", description: "a round friendly fish with orange fins", movement: "swim", temperament: "passive", length: 1.6, colors: { main: "teal3", belly: "yellow5", accent: "orange3" }, shape: EXAMPLE_SHAPE },
  };
}
