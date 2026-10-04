/**
 * Happenings: the world's rules changed for a while, for everyone. "Low gravity for 10 minutes",
 * "an ice world", "peace day", "the floor is lava", "eternal night". Each is a set of rule changes
 * (gravity, jump, speed, grip, fall damage) and/or an effect the server runs (no damage, the sky
 * held at night, hot ground). Everything has a timer and is put back exactly as it was when the
 * time is up, or when it's called off, or after a restart.
 */
export type HappeningEffect = "peace" | "night" | "day" | "lava";

export interface HappeningDef {
  id: string;
  title: string;
  words: string[];
  /** What it does, in a sentence (the banner and /happen list). */
  description: string;
  /** Rule changes: [path, value or multiplier of the current value ("×1.6")]. */
  rules: [string, number | `×${number}`][];
  effect?: HappeningEffect;
  /** Default minutes (players can ask for 1–15). */
  minutes: number;
}

export const HAPPENINGS: HappeningDef[] = [
  { id: "low_gravity", title: "Low Gravity", words: ["low gravity", "moon", "moon gravity", "floaty", "zero gravity", "space"],
    description: "Gravity is a third of normal: jump three times as high, fall slowly, land softly",
    rules: [["balance.player.gravity", "×0.35"], ["balance.player.jumpBlocks", "×2.8"], ["balance.player.fallDamageAfterBlocks", "×3.5"]], minutes: 5 },
  { id: "speed", title: "Speed World", words: ["speed", "fast", "super speed", "sonic", "zoom", "speed world"],
    description: "Everyone runs at double speed",
    rules: [["balance.player.walkSpeed", "×1.7"], ["balance.player.sprintSpeed", "×1.8"]], minutes: 5 },
  { id: "trampoline", title: "Trampoline Day", words: ["trampoline", "bouncy", "bounce", "super jump", "high jump", "jumpy"],
    description: "Jump four blocks high, and falls hurt much less",
    rules: [["balance.player.jumpBlocks", "×3.2"], ["balance.player.fallDamageAfterBlocks", "×3"]], minutes: 5 },
  { id: "ice", title: "Ice World", words: ["ice", "icy", "slippery", "skating", "ice world", "frozen"],
    description: "Every surface is slippery: you slide when you stop and turn slowly",
    rules: [["balance.player.groundGrip", "×0.12"]], minutes: 5 },
  { id: "giant", title: "Giants", words: ["giant day", "giant mode", "giant world", "everyone is a giant", "everyone giant", "land of giants", "titans"],
    description: "Everyone is two and a half times as tall: big strides, big jumps, long reach (doorways get tricky)",
    rules: [["balance.player.scale", 2.5], ["balance.player.walkSpeed", "×1.5"], ["balance.player.sprintSpeed", "×1.5"], ["balance.player.jumpBlocks", "×2"], ["balance.player.fallDamageAfterBlocks", "×2.5"]], minutes: 5 },
  { id: "tiny", title: "Tiny Day", words: ["tiny day", "tiny mode", "tiny world", "everyone is tiny", "everyone tiny", "shrink everyone", "honey i shrunk", "ant sized", "miniature world"],
    description: "Everyone is a third of their size: squeeze through one-block gaps, the world looms large",
    rules: [["balance.player.scale", 0.35], ["balance.player.walkSpeed", "×0.75"], ["balance.player.sprintSpeed", "×0.75"]], minutes: 5 },
  { id: "peace", title: "Peace Day", words: ["peace", "peaceful", "no damage", "safe", "truce", "ceasefire"],
    description: "Nobody can be hurt: no damage from anything",
    rules: [], effect: "peace", minutes: 10 },
  { id: "night", title: "Eternal Night", words: ["eternal night", "endless night", "night forever", "darkness", "always night"],
    description: "The sun doesn't rise: night holds until it's over",
    rules: [], effect: "night", minutes: 5 },
  { id: "day", title: "Endless Day", words: ["endless day", "eternal day", "always day", "midnight sun", "no night"],
    description: "The sun stays up: no night until it's over",
    rules: [], effect: "day", minutes: 10 },
  { id: "lava", title: "The Floor Is Lava", words: ["floor is lava", "lava floor", "hot ground", "the floor is lava"],
    description: "The natural ground burns: stand on something you built (planks, wool, bricks…) or keep jumping",
    rules: [], effect: "lava", minutes: 3 },
];

const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15 };

/** Which happening this asks for, and for how long. */
export function planHappening(text: string): { def: HappeningDef; minutes: number; notes: string[] } | null {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ")} `;
  // The longest matching phrase wins ("the floor is lava" over "lava").
  let best: { def: HappeningDef; len: number } | null = null;
  for (const def of HAPPENINGS) for (const w of def.words) if (t.includes(` ${w} `) && (!best || w.length > best.len)) best = { def, len: w.length };
  if (!best) return null;
  const notes: string[] = [];
  let minutes = best.def.minutes;
  const m = /(\d+|one|two|three|four|five|six|seven|eight|nine|ten|fifteen) (minute|minutes|min|mins)\b/.exec(t);
  if (m) minutes = NUM[m[1]] ?? Number(m[1]);
  if (minutes > 15) { notes.push(`${minutes} minutes is long; made it 15`); minutes = 15; }
  minutes = Math.max(1, minutes);
  return { def: best.def, minutes, notes };
}

/** The value a rule takes: a number as is, or "×k" times what it is now. */
export function happeningValue(current: number, v: number | `×${number}`): number {
  return typeof v === "number" ? v : Math.round(current * Number(v.slice(1)) * 1000) / 1000;
}

/** Does this block count as "built" (safe ground when the floor is lava)? */
export function isBuiltBlock(name: string, tags: string[]): boolean {
  if (tags.includes("soil") || tags.includes("ore") || tags.includes("leaves") || tags.includes("plant")) return false;
  return !["stone", "sand", "gravel", "snow", "snowy_grass", "ice", "bedrock", "water", "cactus", "sandstone", "log"].includes(name);
}
