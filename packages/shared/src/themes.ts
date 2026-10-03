import { checkRuleChange, type RuleValue } from "./rules";
import type { Standards } from "./standards";
import { parseHex } from "./texture";
import type { ModelStyle } from "./summons/mesh";

/**
 * World themes: "a cyberpunk sci-fi samurai world", plus reference images,
 * turned into a world's look and defaults, all as ordinary world rules:
 *
 *   palette     each hue ramp regenerated from an anchor colour; neutrals tinted
 *   materials   which palette colour grass, leaves, wood, stone, sky… use
 *   light       start time and day length
 *   music       key, mode and tempo for the audio standards
 *   defaults    build style, raid theme and creature ideas the planners use
 *
 * Reserved colours (danger, water, magic, team colours) never change, and the
 * palette is nudged so nothing in it can be mistaken for the danger colour.
 */

export type Ramp = "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "violet" | "pink";
export const RAMPS: Ramp[] = ["red", "orange", "yellow", "green", "teal", "blue", "violet", "pink"];
export type Material = "grass" | "leaves" | "dirt" | "wood" | "bark" | "stone" | "sand" | "snow" | "glass" | "wool" | "sky";

export interface BuildTraits {
  /** Roof shape: stepped pyramid, or tiered eaves with overhangs (pagodas). */
  roof?: "pyramid" | "eaves";
  /** Glowing strips and signs on the walls. */
  neon?: boolean;
  /** Wall material by default. */
  walls?: "wood" | "stone" | "brick" | "sandstone";
}

export interface ThemeSpec {
  title: string;
  keywords: string[];
  ramps: Partial<Record<Ramp, string>>;
  /** Neutral ramp tint (hue in degrees, saturation 0–1) and lightness multiplier. */
  neutral?: { hue: number; sat: number; light: number };
  materials: Partial<Record<Material, string>>;
  startTime?: "morning" | "noon" | "dusk" | "night";
  dayLengthMinutes?: number;
  music?: { key: string; mode: "major" | "dorian" | "minor"; bpm: number };
  /** How creatures and summons are drawn: voxel (blocky), smooth (rounded), lowpoly (faceted) or sculpted (fine, blended forms). */
  modelStyle?: ModelStyle;
  build: BuildTraits;
  /** Raid theme for "pirates attack"-style events without a theme of their own. */
  raidTheme?: string;
  /** Things that fit the world, for players and their chats to try. */
  creatures: string[];
  /** Colours taken from reference images, and anything worth telling the creator. */
  referenceColors: string[];
  notes: string[];
}

interface Motif {
  words: RegExp;
  title: string;
  ramps: Partial<Record<Ramp, string>>;
  neutral?: ThemeSpec["neutral"];
  materials?: Partial<Record<Material, string>>;
  startTime?: ThemeSpec["startTime"];
  dayLengthMinutes?: number;
  music?: ThemeSpec["music"];
  build?: BuildTraits;
  raidTheme?: string;
  creatures?: string[];
}

/** Words that choose how creatures are drawn. The terrain stays blocks whatever the style. */
const MODEL_STYLE_WORDS: { words: RegExp; style: ModelStyle }[] = [
  { words: /\b(sculpted|high[- ]?(poly|detail|fidelity)|hyper[- ]?detailed|figurine|statuette|porcelain|glossy toy)\b/, style: "sculpted" },
  { words: /\b(low[- ]?poly|faceted|polygonal|ps1|geometric|origami|papercraft)\b/, style: "lowpoly" },
  { words: /\b(smooth|organic|claymation|clay|soft|rounded|detailed models?)\b/, style: "smooth" },
  { words: /\b(voxel|blocky|pixel(ated)?|cubic)\b/, style: "voxel" },
];

/** What the theme planner knows. An agent can write a ThemeSpec directly instead. */
const MOTIFS: Motif[] = [
  {
    words: /\b(cyber ?punk|neon|synth ?wave|retro ?wave|night ?city|dystopi\w*|blade ?runner)\b/, title: "Cyberpunk",
    ramps: { pink: "#ff2fb3", violet: "#8a3cff", teal: "#14e0cf", blue: "#2a62ff" },
    neutral: { hue: 235, sat: 0.18, light: 0.68 },
    materials: { grass: "teal2", stone: "neutral4", glass: "teal4", sky: "violet1", wool: "pink3" },
    startTime: "night", music: { key: "A", mode: "minor", bpm: 112 }, build: { neon: true, walls: "stone" },
    creatures: ["a cyborg", "a robot", "a neon jellyfish", "a flying shark"],
  },
  {
    words: /\b(sci-?fi|science fiction|space|futur\w*|starship|alien|galac\w*)\b/, title: "Sci-fi",
    ramps: { blue: "#3f8cff", teal: "#2fd6e8", violet: "#7d6bff" },
    neutral: { hue: 210, sat: 0.08, light: 0.95 },
    materials: { stone: "neutral6", glass: "teal4", wool: "blue4" },
    music: { key: "E", mode: "dorian", bpm: 100 }, build: { neon: true, walls: "stone" },
    creatures: ["a robot", "a cyborg", "an alien jellyfish"],
  },
  {
    words: /\b(samurai|feudal|japan\w*|edo|shogun\w*|ninja\w*|shinobi|ronin|sakura|cherry blossom\w*|torii|pagoda\w*|kyoto)\b/, title: "Samurai",
    ramps: { red: "#b3262e", pink: "#f2a3bf", green: "#3f7a3a", yellow: "#d6a83a", orange: "#5a3322" },
    materials: { leaves: "pink4", wood: "red2", bark: "orange1" },
    music: { key: "D", mode: "dorian", bpm: 88 }, build: { roof: "eaves", walls: "wood" }, raidTheme: "ninjas",
    creatures: ["a samurai", "a ninja", "an oni", "a koi", "a red dragon"],
  },
  {
    words: /\b(steam ?punk|clockwork|victorian|brass)\b/, title: "Steampunk",
    ramps: { orange: "#a8642a", yellow: "#c9a24a", red: "#7a2f22" },
    neutral: { hue: 30, sat: 0.1, light: 0.9 },
    materials: { stone: "neutral4", wool: "yellow3" }, music: { key: "G", mode: "major", bpm: 96 }, build: { walls: "brick" },
    creatures: ["a robot", "a big cloud"],
  },
  {
    words: /\b(horror|gothic|haunted|spooky|undead|vampire\w*|cursed)\b/, title: "Gothic",
    ramps: { red: "#7a1020", violet: "#4b2a6b", green: "#3c5a3a" },
    neutral: { hue: 270, sat: 0.08, light: 0.7 },
    materials: { leaves: "violet2", sky: "violet1" }, startTime: "dusk", music: { key: "C", mode: "minor", bpm: 70 }, build: { walls: "stone" }, raidTheme: "skeletons",
    creatures: ["a skeleton", "a ghost", "a bat"],
  },
  {
    words: /\b(desert|dune\w*|egypt\w*|arabian|sahara|oasis)\b/, title: "Desert",
    ramps: { yellow: "#e2bf6e", orange: "#c07a3a", green: "#7f8f3a" },
    materials: { grass: "yellow4", leaves: "green3" }, music: { key: "D", mode: "dorian", bpm: 92 }, build: { walls: "sandstone" },
    creatures: ["a camel", "a scorpion", "a sand dragon"],
  },
  {
    words: /\b(frost|frozen|winter|arctic|ice ?age|nordic|viking\w*)\b/, title: "Frost",
    ramps: { blue: "#7fb4e6", teal: "#7fd6d6", green: "#4f7a6a" },
    neutral: { hue: 205, sat: 0.12, light: 1.05 }, music: { key: "E", mode: "minor", bpm: 84 }, raidTheme: "vikings",
    creatures: ["a viking", "a white wolf", "an ice dragon"],
  },
  {
    words: /\b(fantasy|magic\w*|enchanted|fairy|elven|elves|mystic\w*)\b/, title: "Fantasy",
    ramps: { violet: "#9b5cff", teal: "#3fd6b0", pink: "#ff8fd0" },
    materials: { leaves: "teal3" }, music: { key: "F", mode: "major", bpm: 90 }, build: { roof: "eaves" },
    creatures: ["a cute pink dragon", "a unicorn", "a fairy"],
  },
];

// ------------------------------------------------------------------ colour helpers

export function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = parseHex(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return "#" + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("");
}

const mix = (a: string, b: string) => {
  const [x, y] = [parseHex(a), parseHex(b)];
  return "#" + x.map((v, i) => Math.round((v + y[i]) / 2).toString(16).padStart(2, "0")).join("");
};

/** Which ramp a colour belongs to, by hue (pink sits between violet and red). */
export function rampOf(hex: string): Ramp {
  const [h] = hexToHsl(hex);
  return h < 15 || h >= 345 ? "red" : h < 40 ? "orange" : h < 68 ? "yellow" : h < 150 ? "green" : h < 195 ? "teal" : h < 250 ? "blue" : h < 290 ? "violet" : "pink";
}

/** Five shades of a ramp from one anchor colour (the anchor is shade 3, unless it's very dark or light). */
export function rampFrom(anchor: string): string[] {
  const [h, s, l] = hexToHsl(anchor);
  const mid = Math.max(0.36, Math.min(0.6, l));
  const ls = [mid * 0.42, mid * 0.68, mid, mid + (0.88 - mid) * 0.45, mid + (0.88 - mid) * 0.8];
  return ls.map((li, i) => hslToHex(h, Math.min(1, s * [0.85, 0.95, 1, 0.9, 0.7][i]), li));
}

/**
 * The dominant colours of an image (RGBA pixels), most common first: a small
 * k-means over a sample of the pixels. Only colours are kept, never the image.
 */
export function dominantColors(rgba: ArrayLike<number>, width: number, height: number, k = 6): { hex: string; share: number }[] {
  const pts: [number, number, number][] = [];
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 4000)));
  for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) {
    const i = (y * width + x) * 4;
    if (rgba[i + 3] < 128) continue;
    pts.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
  }
  if (!pts.length) return [];
  let centers = Array.from({ length: Math.min(k, pts.length) }, (_, i) => [...pts[Math.floor((i + 0.5) * pts.length / Math.min(k, pts.length))]] as [number, number, number]);
  let assign = new Int32Array(pts.length);
  for (let iter = 0; iter < 12; iter++) {
    assign = new Int32Array(pts.length);
    pts.forEach((p, i) => {
      let best = 0, bd = Infinity;
      centers.forEach((c, j) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; best = j; } });
      assign[i] = best;
    });
    centers = centers.map((c, j) => {
      let n = 0; const sum = [0, 0, 0];
      pts.forEach((p, i) => { if (assign[i] === j) { n++; sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2]; } });
      return n ? [sum[0] / n, sum[1] / n, sum[2] / n] : c;
    });
  }
  const counts = centers.map((_, j) => assign.reduce((n, a) => n + (a === j ? 1 : 0), 0));
  return centers
    .map((c, j) => ({ hex: "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join(""), share: counts[j] / pts.length }))
    .filter((c) => c.share > 0.02)
    .sort((a, b) => b.share - a.share);
}

// ------------------------------------------------------------------ planning

/** Plan a theme from a description and, optionally, colours taken from reference images. */
export function planTheme(text: string, referenceColors: string[] = []): ThemeSpec {
  const t = text.toLowerCase();
  const hits = MOTIFS.filter((m) => m.words.test(t)).sort((a, b) => t.search(a.words) - t.search(b.words));
  const theme: ThemeSpec = { title: hits.map((m) => m.title).join(" ") || "Custom", keywords: hits.map((m) => m.title.toLowerCase()), ramps: {}, materials: {}, build: {}, creatures: [], referenceColors: [], notes: [] };
  // Earlier words lead; later ones blend into the colours they share and fill in the rest.
  for (const m of hits) {
    for (const [r, c] of Object.entries(m.ramps) as [Ramp, string][]) theme.ramps[r] = theme.ramps[r] ? mix(theme.ramps[r]!, c) : c;
    if (m.neutral && !theme.neutral) theme.neutral = m.neutral;
    for (const [k, v] of Object.entries(m.materials ?? {}) as [Material, string][]) theme.materials[k] ??= v;
    theme.startTime ??= m.startTime;
    theme.dayLengthMinutes ??= m.dayLengthMinutes;
    theme.music ??= m.music;
    theme.build = { ...m.build, ...theme.build, neon: theme.build.neon || m.build?.neon, roof: theme.build.roof ?? m.build?.roof };
    theme.raidTheme ??= m.raidTheme;
    for (const c of m.creatures ?? []) if (!theme.creatures.includes(c)) theme.creatures.push(c);
  }
  const style = MODEL_STYLE_WORDS.filter((w) => w.words.test(t)).sort((a, b) => t.search(a.words) - t.search(b.words))[0];
  if (style) {
    theme.modelStyle = style.style;
    theme.keywords.push(style.style);
  }
  if (!hits.length && !style) theme.notes.push(`no known style words in "${text}"; the look comes from the reference colours (if any), and the rest stays as it is`);
  // Reference colours win: saturated ones set their ramp, a dark one tints the neutrals.
  for (const hex of referenceColors.slice(0, 8)) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) continue;
    const [h, s, l] = hexToHsl(hex);
    if (s > 0.35 && l > 0.15 && l < 0.85) {
      const r = rampOf(hex);
      theme.ramps[r] = hex.toLowerCase();
      theme.referenceColors.push(hex.toLowerCase());
    } else if (l < 0.25 && !theme.referenceColors.some((c) => hexToHsl(c)[2] < 0.25)) {
      theme.neutral = { hue: h, sat: Math.min(0.25, s), light: Math.max(0.6, Math.min(1, theme.neutral?.light ?? 0.8)) };
      theme.referenceColors.push(hex.toLowerCase());
    }
  }
  return theme;
}

/** The world-rule changes a theme makes, checked like any rule change. */
export function themeRules(theme: ThemeSpec, std: Standards): { changes: [string, RuleValue][]; errors: string[]; notes: string[] } {
  const changes: [string, RuleValue][] = [];
  const notes: string[] = [];
  const palette: Record<string, string> = { ...(std.art.palette as Record<string, string>) };
  for (const [r, anchor] of Object.entries(theme.ramps) as [Ramp, string][]) rampFrom(anchor).forEach((c, i) => (palette[`${r}${i + 1}`] = c));
  if (theme.neutral) {
    const { hue, sat, light } = theme.neutral;
    for (let i = 1; i <= 8; i++) {
      const [, , l] = hexToHsl((std.art.palette as Record<string, string>)[`neutral${i}`]);
      palette[`neutral${i}`] = hslToHex(hue, sat * (1 - Math.abs(l - 0.5)), Math.min(0.97, l * light));
    }
  }
  // Nothing may look like the danger colour (it means "this hurts"): nudge any close colour away.
  const [dh, ds, dl] = hexToHsl(std.art.reserved.danger);
  for (const [k, c] of Object.entries(palette)) {
    const [h, s, l] = hexToHsl(c);
    const dHue = Math.min(Math.abs(h - dh), 360 - Math.abs(h - dh));
    if (dHue < 14 && s > 0.6 && Math.abs(l - dl) < 0.15 && ds > 0.6) {
      palette[k] = hslToHex(h + (h >= dh ? 18 : -18), s * 0.85, l);
      notes.push(`${k} moved away from the danger colour`);
    }
  }
  for (const [k, v] of Object.entries(palette)) if (v !== (std.art.palette as Record<string, string>)[k]) changes.push([`art.palette.${k}`, v]);
  // Big surfaces (the ground, stone) can't glare: a very bright, saturated choice steps down to a darker shade.
  for (const [k, v] of Object.entries(theme.materials) as [Material, string][]) {
    let key = v;
    if (["grass", "dirt", "stone", "sand"].includes(k)) {
      const ramp = key.replace(/\d+$/, "");
      for (let n = Number(key.slice(ramp.length)); n > 1; n--) {
        const [, s, l] = hexToHsl(palette[`${ramp}${n}`] ?? "#808080");
        if (!(s > 0.6 && l > 0.32)) break;
        key = `${ramp}${n - 1}`;
      }
      if (key !== v) notes.push(`${k} uses ${key} instead of ${v}, so the ground doesn't glare`);
    }
    changes.push([`art.materials.${k}`, key]);
  }
  if (theme.modelStyle) changes.push(["art.modelStyle", theme.modelStyle]);
  if (theme.dayLengthMinutes) changes.push(["art.lighting.dayLengthMinutes", theme.dayLengthMinutes]);
  if (theme.music) {
    changes.push(["audio.key", theme.music.key]);
    changes.push(["audio.modes.default", theme.music.mode]);
    changes.push(["audio.bpm.explore", theme.music.bpm]);
  }
  // Night shouldn't be pitch black: dark ground materials get a lighter shade.
  const errors: string[] = [];
  const ok: [string, RuleValue][] = [];
  for (const [k, v] of changes) {
    const why = checkRuleChange(std, k, v);
    if (why) errors.push(`${k}: ${why}`); else ok.push([k, v]);
  }
  return { changes: ok, errors, notes };
}
