import { parseHex } from "./texture";
import { checkRuleChange, type RuleValue } from "./rules";
import type { Standards } from "./standards";
import { planTheme, themeRules, type ThemeSpec } from "./themes";

/**
 * Setting up a new world before anyone else joins: a look (palette preset),
 * starting time, day length, PvP, and any other world rule. Everything goes
 * through the same rule checks as live changes, so locked values stay locked.
 */

export interface PalettePreset {
  name: string;
  description: string;
  /** Hue shift (degrees), saturation and lightness multipliers, optionally only for some ramps. */
  hue: number;
  sat: number;
  light: number;
  ramps?: string[];
  /** Lightness multiplier for the neutral ramp (snow, stone, clouds); omitted = neutrals stay as they are. */
  neutralLight?: number;
}

export const PALETTE_PRESETS: PalettePreset[] = [
  { name: "classic", description: "The default Chunky Daylight look", hue: 0, sat: 1, light: 1 },
  { name: "autumn", description: "Leaves and grass turn orange and red", hue: -70, sat: 1.1, light: 1, ramps: ["green", "teal"] },
  { name: "pastel", description: "Soft, light, gentle colours everywhere", hue: 0, sat: 0.55, light: 1.22, neutralLight: 1.08 },
  { name: "neon", description: "Saturated colours on a dark base", hue: 0, sat: 2.2, light: 0.95, neutralLight: 0.55 },
  { name: "desert", description: "Dry, sun-bleached greens and warm earth", hue: -35, sat: 0.7, light: 1.08, ramps: ["green", "teal", "orange"] },
  { name: "frost", description: "Cold, blue-tinted, wintry", hue: 25, sat: 0.6, light: 1.12, ramps: ["green", "teal", "orange", "yellow"] },
];

/** Fractions of the day cycle (0 = sunrise, 0.25 = noon, 0.5 = sunset). */
export const START_TIMES: Record<string, number> = { morning: 0.04, noon: 0.25, dusk: 0.5, night: 0.7 };

export interface WorldSetup {
  title?: string;
  description?: string;
  seed?: number;
  preset?: string;
  startTime?: keyof typeof START_TIMES;
  dayLengthMinutes?: number;
  pvp?: boolean;
  /** Any other world rules, by path (e.g. "balance.player.jumpBlocks": 2). */
  rules?: Record<string, RuleValue>;
  /** A description of the world's style ("cyberpunk sci-fi samurai") and colours from reference images. */
  theme?: string;
  referenceColors?: string[];
}

/** The theme a setup asks for (null if none). */
export function setupTheme(setup: WorldSetup): ThemeSpec | null {
  if (!setup.theme && !setup.referenceColors?.length) return null;
  return planTheme(setup.theme ?? "", setup.referenceColors ?? []);
}

function toHsl(hex: string): [number, number, number] {
  const [r, g, b] = parseHex(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function toHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(1, v + m)) * 255).toString(16).padStart(2, "0")).join("");
}

/** The palette rule changes a preset makes (reserved colours like "danger" never change). */
export function presetRules(preset: string, std: Standards): Record<string, string> {
  const p = PALETTE_PRESETS.find((x) => x.name === preset);
  if (!p) throw new Error(`no palette preset "${preset}" (try ${PALETTE_PRESETS.map((x) => x.name).join(", ")})`);
  const out: Record<string, string> = {};
  for (const [key, hex] of Object.entries(std.art.palette as Record<string, string>)) {
    const ramp = key.replace(/\d+$/, "");
    if (p.ramps && !p.ramps.includes(ramp)) continue;
    const neutral = ramp === "neutral";
    if (neutral && p.neutralLight === undefined) continue;
    const [h, s, l] = toHsl(hex);
    const next = neutral
      ? toHex(h, s, Math.min(0.95, l * p.neutralLight!))
      : toHex((h + p.hue + 360) % 360, Math.min(1, s * p.sat), Math.min(0.95, l * p.light));
    if (next !== hex.toLowerCase()) out[`art.palette.${key}`] = next;
  }
  return out;
}

/**
 * All the rule changes a setup asks for, checked. Returns the changes, or the
 * reasons some can't be made (locked, wrong type, too big a jump).
 */
export function setupRules(setup: WorldSetup, std: Standards): { changes: [string, RuleValue][]; errors: string[] } {
  const changes: [string, RuleValue][] = [];
  const errors: string[] = [];
  if (setup.preset && setup.preset !== "classic") {
    try { for (const [k, v] of Object.entries(presetRules(setup.preset, std))) changes.push([k, v]); } catch (e) { errors.push((e as Error).message); }
  }
  const theme = setupTheme(setup);
  if (theme) {
    const t = themeRules(theme, std);
    errors.push(...t.errors);
    changes.push(...t.changes);
  }
  if (setup.dayLengthMinutes !== undefined) changes.push(["art.lighting.dayLengthMinutes", setup.dayLengthMinutes]);
  for (const [k, v] of Object.entries(setup.rules ?? {})) changes.push([k, v]);
  const ok: [string, RuleValue][] = [];
  for (const [k, v] of changes) {
    const why = checkRuleChange(std, k, v);
    if (why) errors.push(`${k}: ${why}`);
    else ok.push([k, v]);
  }
  return { changes: ok, errors };
}
