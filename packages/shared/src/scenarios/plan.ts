import type { Standards } from "../standards";
import { planSummon, type SummonSpec } from "../summons/spec";

/**
 * Scenarios: events with a story arc, built from summons plus a script.
 *
 * "A swarm of ships arrives at the nearest coast, enemies come out in waves
 * with increasing difficulty, and some bosses" becomes an invasion spec:
 * which ships, which enemies per wave, where the bosses come, how long the
 * breaks are and what the reward is. Like summon specs it is plain data, so an
 * agent can write or edit one directly; the keyword planner below is the
 * stand-in until agents do. The server's director runs it, and the shadow
 * playtest simulates every wave before it is allowed to arrive.
 */

export interface WaveSpec {
  /** Enemy summon specs and how many of each come ashore. */
  groups: { spec: SummonSpec; count: number }[];
  /** A boss comes with this wave (the HUD shows its health bar). */
  boss?: SummonSpec;
}

export interface ScenarioSpec {
  id: string;
  kind: "invasion";
  title: string;
  prompt: string;
  /** "pirates", "vikings", "skeletons"… */
  theme: string;
  ship: SummonSpec;
  ships: number;
  waves: WaveSpec[];
  /** Breather between waves (standards: leave room to breathe). */
  restSeconds: number;
  /** The whole scenario ends (and the invaders leave) after this long. */
  timeLimitSeconds: number;
  /** If nobody is near the landing site for this long, the invaders leave. */
  abandonSeconds: number;
  /** Item names and counts in the reward chest. */
  reward: [string, number][];
  notes: string[];
}

interface Theme {
  words: string[];
  name: string;
  title: string;
  ship: string;
  grunt: string;
  brute: string;
  boss: string;
  finalBoss: string;
  finalName: string;
  /** Bosses wear the theme's look (a viking chief has a horned helmet, not a tricorn). */
  bossFeatures: string[];
}

const THEMES: Theme[] = [
  { words: ["pirate", "pirates", "buccaneer", "buccaneers"], name: "pirates", title: "Pirate Raid", ship: "a pirate ship", grunt: "a pirate", brute: "a big pirate", boss: "a pirate captain", finalBoss: "a pirate king", finalName: "Pirate King", bossFeatures: ["hat", "beard", "coat", "sword"] },
  { words: ["viking", "vikings", "norse", "longship", "longships"], name: "vikings", title: "Viking Raid", ship: "a viking longship", grunt: "a viking", brute: "a big viking", boss: "a viking chief", finalBoss: "a viking king", finalName: "Viking Jarl", bossFeatures: ["helmet", "beard", "coat", "sword"] },
  { words: ["skeleton", "skeletons", "undead", "ghost", "ghostly", "cursed"], name: "skeletons", title: "Ghost Fleet", ship: "a black ship", grunt: "a skeleton", brute: "a big skeleton", boss: "a skeleton captain", finalBoss: "a skeleton king", finalName: "Bone King", bossFeatures: ["skeleton", "hat", "coat", "sword"] },
];

const NUMBERS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

const INVASION_WORDS = ["ship", "ships", "fleet", "armada", "boat", "boats", "invasion", "invade", "invaders", "raid", "raiders", "landing", "wave", "waves", "coast", "shore", "beach"];

/** The scenario themes the planner knows. */
export function scenarioCatalog(): { theme: string; title: string; ship: string; grunt: string; boss: string; finalBoss: string }[] {
  return THEMES.map((t) => ({ theme: t.name, title: t.title, ship: t.ship, grunt: t.grunt, boss: t.boss, finalBoss: t.finalBoss }));
}

/** Does this read like a scenario rather than a single summon? */
export function looksLikeScenario(text: string): boolean {
  const words: string[] = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const has = (w: string[]) => words.some((x) => w.includes(x));
  return has(["wave", "waves", "invasion", "invade", "raid", "attack", "attacks"]) || (has(["ship", "ships", "fleet", "armada", "boats"]) && has(["enemies", "arrive", "arrives", "land", "lands", "coast", "shore", "beach", "come"]));
}

function must(prompt: string): SummonSpec {
  const p = planSummon(prompt);
  if (!p.spec) throw new Error(`scenario planner: can't plan "${prompt}"`);
  // Name it after the whole prompt ("Pirate Captain", not just "Captain").
  const name = prompt.replace(/^(a|an|the)\s+/i, "").replace(/\b\w/g, (c) => c.toUpperCase());
  return { ...p.spec, name, id: name.toLowerCase().replace(/[^a-z0-9]+/g, "_") };
}

/**
 * Plan an invasion. `players` is how many people are around to defend: the
 * numbers scale with it, so a lone player gets a fair fight and a crowd a big one.
 */
export function planScenario(text: string, std: Standards, players = 1): { spec?: ScenarioSpec; notes: string[] } {
  const words: string[] = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  if (!words.some((w) => INVASION_WORDS.includes(w)) && !looksLikeScenario(text)) {
    return { notes: [`I can run invasions so far ("ships arrive at the coast and enemies come in waves"); "${text}" isn't one I know how to stage yet`] };
  }
  const notes: string[] = [];
  const theme = THEMES.find((t) => words.some((w) => t.words.includes(w))) ?? THEMES[0];
  if (!words.some((w) => theme.words.includes(w))) notes.push(`made them ${theme.name}`);

  // How many waves: "five waves", "in 3 waves"; otherwise 5 (with bosses) or 4.
  let waves = 0;
  words.forEach((w, i) => {
    if ((words[i + 1] === "waves" || words[i + 1] === "wave") && (NUMBERS[w] || /^\d+$/.test(w))) waves = NUMBERS[w] ?? Number(w);
  });
  const wantsBosses = words.some((w) => w === "boss" || w === "bosses");
  if (!waves) waves = wantsBosses ? 5 : 4;
  if (waves > 8) { notes.push(`${waves} waves is a long fight; made it 8`); waves = 8; }
  if (waves < 2) waves = 2;
  // A final boss in longer raids or when asked for; a mid-way one too when there's room.
  const bossWaves = new Set<number>(wantsBosses || waves >= 4 ? [waves - 1] : []);
  if (words.includes("bosses") || (wantsBosses && waves >= 4)) bossWaves.add(Math.floor((waves - 1) / 2));

  // Ships: "three ships", "a swarm of ships" (3), "a fleet" (4); capped so the bay isn't solid wood.
  let ships = 0;
  words.forEach((w, i) => { if (["ships", "boats", "longships", "galleons"].includes(words[i + 1]) && (NUMBERS[w] || /^\d+$/.test(w))) ships = NUMBERS[w] ?? Number(w); });
  if (!ships) ships = words.some((w) => ["fleet", "armada"].includes(w)) ? 4 : words.some((w) => ["swarm", "lots", "many", "several"].includes(w)) ? 3 : 2;
  ships = Math.max(1, Math.min(4, ships));

  const ship = must(theme.ship);
  ship.count = 1;
  const grunt = must(theme.grunt), brute = must(theme.brute), boss = must(theme.boss);
  grunt.count = brute.count = boss.count = 1;
  boss.role = "boss";
  boss.features = [...theme.bossFeatures];
  // Bosses wear their crew's colours, with gold trim.
  boss.colors = { main: grunt.colors.main, belly: "neutral2", accent: "yellow4" };
  // The final boss: bigger, crowned, still within the hostile size limit.
  const final = { ...must(theme.finalBoss), role: "boss" as const, count: 1 };
  final.length = Math.min(std.summons.hostileMaxLengthBlocks, 4.2);
  final.features = [...theme.bossFeatures.filter((f) => f !== "hat" && f !== "helmet"), "crown"];
  final.colors = { ...boss.colors };
  final.name = theme.finalName;
  final.id = final.name.toLowerCase().replace(/\s+/g, "_");
  brute.length = Math.max(brute.length, 3); // heavy hits (and a longer warning)
  brute.name = `Big ${grunt.name}`;
  brute.id = `big_${grunt.id}`;

  // Difficulty rises wave by wave: more enemies, then brutes, then bosses. It scales with the players
  // there, gently (√), and the concurrent cap in the director keeps any one moment readable.
  const scale = Math.sqrt(Math.max(1, players));
  const plan: WaveSpec[] = [];
  for (let i = 0; i < waves; i++) {
    const grunts = Math.round((2 + i * 1.2) * scale);
    const brutes = i >= 2 ? Math.round((i - 1) * 0.6 * scale) : 0;
    const groups = [{ spec: grunt, count: Math.min(14, grunts) }];
    if (brutes > 0) groups.push({ spec: brute, count: Math.min(6, brutes) });
    const w: WaveSpec = { groups };
    if (bossWaves.has(i)) w.boss = i === waves - 1 ? final : boss;
    plan.push(w);
  }
  const reward: [string, number][] = [["diamond", Math.min(6, 1 + waves)], ["gold_ingot", 3 + waves], ["iron_ingot", 6 + waves * 2], ["steak", 8]];
  if (bossWaves.size > 1) reward.push(["diamond_sword", 1]);
  return {
    spec: {
      id: `${theme.name}_${Math.abs((words.join(" ").length * 2654435761) | 0) % 100000}`,
      kind: "invasion",
      title: theme.title,
      prompt: text,
      theme: theme.name,
      ship,
      ships,
      waves: plan,
      restSeconds: 15,
      timeLimitSeconds: 15 * 60,
      abandonSeconds: 45,
      reward,
      notes,
    },
    notes,
  };
}

/** A one-line description for the event banner and the agent. */
export function describeScenario(s: ScenarioSpec): string {
  const bosses = s.waves.flatMap((w, i) => (w.boss ? [`${w.boss.name} in wave ${i + 1}`] : []));
  const total = s.waves.reduce((n, w) => n + w.groups.reduce((m, g) => m + g.count, 0) + (w.boss ? 1 : 0), 0);
  return `${s.ships} ships, ${s.waves.length} waves (${total} enemies)${bosses.length ? `, bosses: ${bosses.join(", ")}` : ""}`;
}
