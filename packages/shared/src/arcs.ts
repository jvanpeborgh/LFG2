/**
 * Arcs: world events over several in-game days, kept across restarts. "A blood moon week", "a
 * meteor shower", "a harvest festival". Each has a length in days and does something each day or
 * night; the server's arcs module runs it (modules/vanilla/arcs.ts), and puts every rule it
 * changed back when it ends.
 */
export type ArcKind = "blood_moon" | "meteors" | "festival";

export interface ArcDef {
  id: ArcKind;
  title: string;
  words: string[];
  description: string;
  /** How many in-game days it lasts (players can ask for 1–7). */
  days: number;
  /** Rule changes made at night (and put back at dawn): [path, "×k" or a value]. */
  nightRules: [string, number | `×${number}`][];
  /** What each dawn brings everyone online (shards, XP), as words for the banner. */
  dawn: string;
}

export const ARCS: ArcDef[] = [
  { id: "blood_moon", title: "Blood Moon", words: ["blood moon", "blood moon week", "red moon", "blood moons", "night of the dead"],
    description: "The moon rises red: more monsters each night, and on the last night something worse comes. Each dawn, everyone who held on gets an aether shard",
    days: 3, nightRules: [["balance.mobs.nightSpawnChance", "×2.5"], ["balance.mobs.hostileCap", "×2"]], dawn: "an aether shard for holding on" },
  { id: "meteors", title: "Meteor Shower", words: ["meteor shower", "meteor showers", "meteors", "shooting stars", "falling stars", "starfall"],
    description: "Meteors streak down at night and leave craters with crystal and iron to mine",
    days: 2, nightRules: [], dawn: "XP for watching the sky" },
  { id: "festival", title: "Harvest Festival", words: ["festival", "harvest festival", "carnival", "feast", "celebration"],
    description: "Lanterns ring the spawn, fireworks every evening, and a gift of food each morning",
    days: 2, nightRules: [], dawn: "a basket of food" },
];

const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, week: 7 };

/** Which arc this asks for, and for how many days. */
export function planArc(text: string): { def: ArcDef; days: number; notes: string[] } | null {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ")} `;
  let best: { def: ArcDef; len: number } | null = null;
  for (const def of ARCS) for (const w of def.words) if (t.includes(` ${w} `) && (!best || w.length > best.len)) best = { def, len: w.length };
  if (!best) return null;
  const notes: string[] = [];
  let days = best.def.days;
  const m = /(\d+|one|two|three|four|five|six|seven) (day|days|night|nights)\b/.exec(t);
  if (m) days = NUM[m[1]] ?? Number(m[1]);
  else if (/\bweek\b/.test(t) && best.def.id !== "blood_moon") days = 7;
  if (days > 7) { notes.push(`${days} days is long; made it 7`); days = 7; }
  return { def: best.def, days: Math.max(1, days), notes };
}

/** Where we are in a day: 0 = sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight (the game's clock). */
export function isNightAt(time: number, dayLength: number): boolean {
  const f = ((time % dayLength) + dayLength) % dayLength / dayLength;
  return f > 0.54 && f < 0.96;
}

/** A meteor's path: from high in the sky, slanting down to where it lands. */
export function meteorPath(x: number, y: number, z: number, angle: number): { from: [number, number, number]; to: [number, number, number] } {
  return { from: [x + Math.cos(angle) * 60, y + 90, z + Math.sin(angle) * 60], to: [x, y, z] };
}

/**
 * A meteor's crater: the blocks to set around where it lands ([dx, dy, dz, block]): a bowl
 * cleared out, its floor scorched, and crystal and iron in the middle to mine.
 */
export function craterBlocks(radius: number, rand: () => number): [number, number, number, string][] {
  const out: [number, number, number, string][] = [];
  const r = Math.max(2, radius);
  for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (let dy = -r; dy <= 1; dy++) {
    const d = Math.hypot(dx, dy * 1.4, dz);
    if (d <= r - 0.3 && dy > -r + 1) out.push([dx, dy, dz, "air"]);
    else if (d <= r + 0.6 && dy <= 0 && dy > -r) out.push([dx, dy, dz, rand() < 0.35 ? "gravel" : "cobblestone"]);
  }
  // The meteorite itself at the bottom.
  const floor = -r + 2;
  out.push([0, floor, 0, "iron_ore"], [1, floor, 0, "crystal"], [0, floor, 1, "crystal"], [-1, floor, 0, rand() < 0.5 ? "crystal" : "iron_ore"], [0, floor + 1, 0, "crystal"]);
  return out;
}
