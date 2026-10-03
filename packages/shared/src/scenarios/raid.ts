/**
 * Raids written by an agent (or a person) instead of planned from a sentence: who comes, in which
 * waves, on which ships, with which bosses. Members are prompts ("a skeleton archer") or saved
 * designs ("design:moss_golem"), so a raid can use creatures made in the design loop.
 *
 * Like designs, every mistake comes back with a JSON path and a hint, the pacing is checked
 * against the fun standards (difficulty rises, there's a finale, room to breathe), and the server
 * playtests every wave before anything is spent.
 */
import type { ShapeIssue } from "../summons/shape";
import type { SummonSpec } from "../summons/spec";
import type { Standards } from "../standards";
import { fitSpecToRules } from "../summons/rules";
import type { ScenarioSpec, WaveSpec } from "./plan";

export interface RaidInput {
  id?: string;
  title: string;
  /** What it is, in words (shown in the banner). */
  description?: string;
  /** The ship they sail in on: a prompt or "design:<id>". Default: a pirate ship. */
  ship?: string;
  ships?: number;
  waves: { enemies: { who: string; count: number }[]; boss?: string }[];
  restSeconds?: number;
  /** Item names and counts for the reward chest (defaults scale with the waves). */
  reward?: [string, number][];
}

export const RAID_LIMITS = { waves: 8, perWave: 24, ships: 4, restSeconds: [5, 60] as [number, number] };
const RAID_ID = /^[a-z0-9][a-z0-9_-]{1,31}$/;

export function raidId(input: RaidInput): string {
  return input.id ?? String(input.title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 32);
}

/**
 * Turn a raid into a scenario spec. `resolve` plans each member (a prompt or a saved design) the
 * way /summon would; `items` says whether a reward item exists.
 */
export function buildRaid(
  input: unknown,
  std: Standards,
  resolve: (who: string) => { spec?: SummonSpec | null; notes: string[] },
  items: (name: string) => boolean,
): { spec?: ScenarioSpec; issues: ShapeIssue[] } {
  const issues: ShapeIssue[] = [];
  const err = (path: string, message: string, hint: string) => issues.push({ path, level: "error", message, hint });
  const warn = (path: string, message: string, hint: string) => issues.push({ path, level: "warning", message, hint });
  const r = input as RaidInput;
  if (!r || typeof r !== "object") { err("", "a raid is a JSON object", '{ "title": "...", "waves": [ { "enemies": [ { "who": "a skeleton", "count": 3 } ] } ] }'); return { issues }; }
  if (JSON.stringify(r).length > 16_000) { err("", "the raid is too large", "keep it to the format"); return { issues }; }
  if (typeof r.title !== "string" || !r.title.trim() || r.title.length > 40) err("title", "needs a title (1–40 characters)", 'e.g. "The Bone Tide"');
  const id = typeof r.title === "string" || r.id ? raidId(r) : "";
  if (!RAID_ID.test(id)) err("id", `id "${id}" isn't usable`, "2–32 lowercase letters, numbers, _ or -");
  const ships = r.ships ?? 2;
  if (!Number.isInteger(ships) || ships < 1 || ships > RAID_LIMITS.ships) err("ships", `ships must be 1–${RAID_LIMITS.ships}`, "2 is a good start");
  const rest = r.restSeconds ?? 15;
  if (typeof rest !== "number" || rest < RAID_LIMITS.restSeconds[0] || rest > RAID_LIMITS.restSeconds[1]) err("restSeconds", `rest must be ${RAID_LIMITS.restSeconds.join("–")} s`, "leave room to breathe: 10–20 s");
  if (!Array.isArray(r.waves) || !r.waves.length) { err("waves", "no waves", "add 2–6 waves, each with enemies"); return { issues }; }
  if (r.waves.length > RAID_LIMITS.waves) err("waves", `${r.waves.length} waves (most is ${RAID_LIMITS.waves})`, "fewer, fuller waves");

  const cache = new Map<string, SummonSpec | null>();
  const member = (who: unknown, path: string, as: "enemy" | "boss" | "ship"): SummonSpec | null => {
    if (typeof who !== "string" || !who.trim()) { err(path, "who comes? (a prompt or design:<id>)", '"a skeleton", "design:moss_golem"'); return null; }
    const key = `${as}|${who}`;
    if (cache.has(key)) return cache.get(key)!;
    const plan = resolve(who);
    let spec = plan.spec ?? null;
    if (!spec) err(path, `"${who}" isn't something the world can make`, plan.notes.join("; ") || "try a creature from get_world_guide's catalog, or a saved design");
    else {
      // Named after the whole prompt ("Skeleton King", not "King"); a saved design keeps its name.
      const name = /^design[: ]/i.test(who.trim()) ? spec.name : who.trim().replace(/^(a|an|the)\s+/i, "").replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 32);
      spec = { ...spec, count: 1, name, id: `${id}_${as}_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}` };
      if (as === "ship" && spec.movement !== "sail") { err(path, `${spec.name} can't sail`, 'use a ship: "a pirate ship", "a viking longship", "a black ship"'); spec = null; }
      else if (as !== "ship") {
        if (spec.temperament !== "hostile") { warn(path, `${spec.name} isn't hostile: raiders fight`, "made it hostile (with a bite)"); spec = { ...spec, temperament: "hostile", abilities: spec.abilities.length ? spec.abilities : ["bite"] }; }
        if (spec.movement === "swim" || spec.movement === "sail") { err(path, `${spec.name} can't come ashore`, "raiders walk, fly or hover"); spec = null; }
        if (spec && as === "boss") spec = { ...spec, role: "boss" };
        if (spec) spec = fitSpecToRules(spec, std, as === "boss" ? 4 : 3).spec;
      }
    }
    cache.set(key, spec);
    return spec;
  };

  const shipSpec = member(r.ship ?? "a pirate ship", "ship", "ship");
  const waves: WaveSpec[] = [];
  const sizes: number[] = [];
  r.waves.forEach((w, i) => {
    const at = `waves[${i}]`;
    if (!w || !Array.isArray(w.enemies) || !w.enemies.length) { err(`${at}.enemies`, "a wave needs enemies", '[{ "who": "a skeleton", "count": 3 }]'); return; }
    let total = 0;
    const groups: WaveSpec["groups"] = [];
    w.enemies.forEach((e, j) => {
      const p = `${at}.enemies[${j}]`;
      if (!Number.isInteger(e?.count) || e.count < 1) { err(`${p}.count`, "count must be a whole number ≥ 1", "e.g. 3"); return; }
      total += e.count;
      const s = member(e.who, `${p}.who`, "enemy");
      if (s) groups.push({ spec: s, count: e.count });
    });
    if (total > RAID_LIMITS.perWave) err(`${at}.enemies`, `${total} enemies in one wave (most is ${RAID_LIMITS.perWave})`, "spread them over more waves; at most 8 are on the beach at once anyway");
    const boss = w.boss !== undefined ? member(w.boss, `${at}.boss`, "boss") : undefined;
    waves.push({ groups, ...(boss ? { boss } : {}) });
    sizes.push(total + (boss ? 4 : 0));
  });
  // Pacing (the fun standard): it should build, end on a high, and not start too hard.
  if (sizes.length >= 2) {
    const dips = sizes.findIndex((n, i) => i > 0 && n < sizes[i - 1] * 0.7 && i < sizes.length - 1);
    if (dips > 0) warn(`waves[${dips}]`, `wave ${dips + 1} is much smaller than wave ${dips}`, "let difficulty rise wave by wave (a breather wave is fine, but not mid-climb)");
    if (!r.waves[r.waves.length - 1]?.boss) warn(`waves[${r.waves.length - 1}].boss`, "no boss in the last wave", "a final boss gives the raid an ending");
    if (sizes[0] > 8) warn("waves[0]", `the first wave has ${sizes[0]} enemies`, "start small (2–5) so people can gather");
  }
  if (r.reward !== undefined) {
    if (!Array.isArray(r.reward) || r.reward.length > 8) err("reward", "reward is a list of [item, count] (at most 8)", '[["diamond", 3], ["gold_ingot", 6]]');
    else r.reward.forEach(([name, n], i) => {
      if (!items(String(name))) err(`reward[${i}]`, `no item called "${name}"`, "use item names like diamond, gold_ingot, iron_ingot, steak, diamond_sword");
      else if (!Number.isInteger(n) || n < 1 || n > 64) err(`reward[${i}]`, "count must be 1–64", "e.g. 3");
    });
  }
  if (issues.some((i) => i.level === "error") || !shipSpec) return { issues };
  const n = waves.length;
  return {
    issues,
    spec: {
      id: `raid_${id}`, kind: "invasion", title: r.title.trim(), prompt: r.description?.slice(0, 200) ?? r.title, theme: "custom",
      ship: shipSpec, ships, waves, restSeconds: rest, timeLimitSeconds: 15 * 60, abandonSeconds: 45,
      reward: r.reward ?? [["diamond", Math.min(6, 1 + n)], ["gold_ingot", 3 + n], ["iron_ingot", 6 + n * 2], ["steak", 8]],
      notes: [],
    },
  };
}

/** A working raid to start from. */
export const EXAMPLE_RAID: RaidInput = {
  title: "The Bone Tide",
  description: "skeletons sail in under a black flag, led by a skeleton king",
  ship: "a pirate ship",
  ships: 2,
  waves: [
    { enemies: [{ who: "a skeleton", count: 3 }] },
    { enemies: [{ who: "a skeleton", count: 5 }] },
    { enemies: [{ who: "a skeleton", count: 5 }, { who: "a big skeleton", count: 2 }], boss: "a skeleton captain" },
    { enemies: [{ who: "a skeleton", count: 6 }, { who: "a big skeleton", count: 3 }], boss: "a skeleton king" },
  ],
  restSeconds: 15,
};
