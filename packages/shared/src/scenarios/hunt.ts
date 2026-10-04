/**
 * Hunts: "/hunt a frost wyrm", "/event hunt down the great boar". A boss is let loose far from
 * the players and roams; it leaves tracks as it goes, and the HUD gives a rough bearing and how far
 * (sharper when you're on its trail). Bring it down before it gets away for its gear and XP.
 * Pure helpers: the server's hunt module runs it.
 */
export interface HuntPlan {
  /** What to hunt: a creature prompt ("a frost wyrm"). */
  quarry: string;
  minutes: number;
  notes: string[];
}

const HUNT_WORDS = ["hunt", "hunting", "hunts", "track", "tracking", "stalk", "quarry", "bounty", "chase"];
const FILLER = new Set(["down", "for", "the", "a", "an", "go", "lets", "let", "us", "s", "on", "after", "minute", "minutes", "min", "mins", "of", "in"]);
const NUM: Record<string, number> = { five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30 };

/** Does this ask for a hunt? */
export function looksLikeHunt(text: string): boolean {
  const w: string[] = text.toLowerCase().match(/[a-z]+/g) ?? [];
  return w.some((x) => x === "hunt" || x === "hunting" || x === "bounty" || x === "stalk") || (w.includes("track") && w.includes("down"));
}

export function planHunt(text: string): HuntPlan {
  const notes: string[] = [];
  const w: string[] = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  let minutes = 15;
  w.forEach((x, i) => { if (/^min/.test(w[i + 1] ?? "")) minutes = NUM[x] ?? (Number(x) || minutes); });
  if (minutes > 30) { notes.push(`${minutes} minutes is long; made it 30`); minutes = 30; }
  minutes = Math.max(3, minutes);
  const rest = w.filter((x, i) => !HUNT_WORDS.includes(x) && !(FILLER.has(x) && x !== "a" && x !== "an") && !(/^\d+$/.test(x) || (NUM[x] && /^min/.test(w[i + 1] ?? ""))) && !/^min/.test(x));
  // Keep the creature's own words ("a frost wyrm"), dropping a leading article we'll add back.
  const words = rest.filter((x, i) => !(i === 0 && (x === "a" || x === "an")));
  const quarry = words.length ? `${/^[aeiou]/.test(words[0]) ? "an" : "a"} ${words.join(" ")}` : "a fearsome beast";
  if (!words.length) notes.push("no quarry named: a fearsome beast");
  return { quarry, minutes, notes };
}

/** The eight compass points, for clues. */
const POINTS = ["north", "north-west", "west", "south-west", "south", "south-east", "east", "north-east"];
/** Which way (x, z) lies from (fx, fz), as a compass point (north is -z, as the game's yaw 0). */
export function bearing(fx: number, fz: number, x: number, z: number): string {
  const a = Math.atan2(-(x - fx), -(z - fz)); // the game's yaw towards it
  return POINTS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}

/** How far, roughly. */
export function distanceBand(d: number): string {
  return d < 24 ? "close" : d < 60 ? "near" : d < 120 ? "a way off" : "far";
}

export interface HuntTrack { x: number; y: number; z: number; yaw: number; t: number }

/**
 * What a hunter learns: on the trail (near fresh tracks) the bearing is true; off it, it wobbles
 * by up to 45° (`wobble` -1..1) and only says roughly how far.
 */
export function huntClue(px: number, pz: number, qx: number, qz: number, tracks: HuntTrack[], wobble: number): { text: string; onTrail: boolean } {
  const d = Math.hypot(qx - px, qz - pz);
  const onTrail = tracks.some((t) => Math.hypot(t.x - px, t.z - pz) < 8);
  if (onTrail || d < 24) return { text: `Fresh tracks: it's ${bearing(px, pz, qx, qz)}, ${distanceBand(d)} (${Math.round(d)} m)`, onTrail: true };
  const a = Math.atan2(qx - px, qz - pz) + wobble * (Math.PI / 4);
  return { text: `Sightings say ${bearing(px, pz, px + Math.sin(a) * 100, pz + Math.cos(a) * 100)}, ${distanceBand(d)}`, onTrail: false };
}

/** Where the quarry is let loose: `distance` blocks from (x, z), at an angle. */
export function huntSite(x: number, z: number, distance: number, angle: number): [number, number] {
  return [Math.round(x + Math.cos(angle) * distance), Math.round(z + Math.sin(angle) * distance)];
}
