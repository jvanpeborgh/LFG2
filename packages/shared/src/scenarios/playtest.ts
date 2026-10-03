import type { BlockQuery } from "../chunk";
import { makeBody, type BlockTable, type Body } from "../physics";
import type { Standards } from "../standards";
import { newSummonState, stepSummon, type BrainPlayer, type SummonState } from "../summons/brain";
import type { SummonStats } from "../summons/rules";
import type { SummonSpec } from "../summons/spec";
import type { ScenarioSpec } from "./plan";

/**
 * Shadow playtest for a scenario: before an invasion is allowed to arrive,
 * every wave is played out on the real terrain against virtual defenders who
 * fight back, using the same enemy brains the server will run.
 *
 * Defenders are deliberately ordinary players: they swing a decent sword,
 * dodge about half of the normal attacks (people miss warnings) and always
 * try to step out of a boss slam once they've had time to react. The checks:
 *
 *   errors (the scenario fizzles)  a hit over the damage cap; a boss slam that
 *                                  catches a defender who reacted in time;
 *                                  a wave the defenders can't finish
 *   warnings (reported back)       too many deaths per player per minute; very
 *                                  long or very short waves; difficulty that
 *                                  doesn't rise
 */

export interface ScenarioSite {
  /** Where the invaders wade ashore from (one per ship). */
  landings: [number, number, number][];
  /** Where the defenders stand (on the beach, a little inland). */
  camp: [number, number, number];
}

export interface WaveMetrics {
  seconds: number;
  enemies: number;
  deaths: number;
  damageTaken: number;
  maxAlive: number;
  hits: number;
  slams: number;
  slamHitsAfterReacting: number;
  cleared: boolean;
}

export interface ScenarioPlaytest {
  ok: boolean;
  errors: string[];
  warnings: string[];
  waves: WaveMetrics[];
}

/** The scenario director's own pacing numbers, shared with the playtest so both agree. */
export const SCENARIO_RULES = {
  /** Enemies on the field at once, whatever the wave size (readability, server load). */
  maxAlive: 8,
  /** One invader comes ashore every this many seconds. */
  disembarkSeconds: 0.8,
  /** A wave nobody can finish in this long counts as stuck. */
  waveLimitSeconds: 240,
  /** Bosses are scaled to the players there: this share of a boss's health per extra player. */
  bossHealthPerExtraPlayer: 0.5,
};

/** Boss health for this many defenders (the balance standard: boss fights scale with the players there). */
export function bossHealth(base: number, players: number): number {
  return Math.round(base * (1 + SCENARIO_RULES.bossHealthPerExtraPlayer * Math.max(0, players - 1)));
}

interface Bot extends BrainPlayer {
  hp: number;
  lastHurt: number;
  dead: number;
  swing: number;
  reactingTo: number;
  /** Missed the current warning (so it won't step back). */
  missed: boolean;
  /** Seconds it has been reacting to the current slam. */
  dodgeFor: number;
}

interface Foe {
  spec: SummonSpec;
  stats: SummonStats;
  body: Body;
  state: SummonState;
  hp: number;
  boss: boolean;
}

export async function playtestScenario(
  spec: ScenarioSpec,
  statsOf: (s: SummonSpec) => SummonStats,
  std: Standards,
  world: BlockQuery,
  table: BlockTable,
  site: ScenarioSite,
  players: number,
  seed = 1,
): Promise<ScenarioPlaytest> {
  let r = seed >>> 0 || 1;
  const rand = () => ((r = (r * 1664525 + 1013904223) >>> 0) / 4294967296);
  const errors: string[] = [], warnings: string[] = [];
  const bal = std.balance;
  const maxHit = bal.player.health * bal.damage.maxHitShareOfHealth;
  const dt = 1 / 20;
  const reaction = 0.4;
  const swordDamage = 16, swordCooldown = 0.6, reach = 2.6;
  const n = Math.max(2, Math.min(4, players));
  const groundY = (x: number, z: number) => {
    for (let y = 126; y >= 0; y--) if (table.solid[world.getBlock(Math.floor(x), y, Math.floor(z))]) return y;
    return -1;
  };
  const [cx, , cz] = site.camp;
  const bots: Bot[] = [];
  for (let i = 0; i < n; i++) {
    const x = cx + (i - (n - 1) / 2) * 2, z = cz;
    bots.push({ id: -(i + 1), x, y: groundY(x, z) + 1, z, huntable: true, hp: bal.player.health, lastHurt: -99, dead: 0, swing: 0, reactingTo: -1, missed: false, dodgeFor: 0 });
  }
  const results: WaveMetrics[] = [];
  let clock = 0;

  for (const [wi, wave] of spec.waves.entries()) {
    // Breathe between waves (and let the event loop run: this is called from a world event's check).
    await new Promise((res) => setTimeout(res, 0));
    const queue: { spec: SummonSpec; boss: boolean }[] = [];
    for (const g of wave.groups) for (let k = 0; k < g.count; k++) queue.push({ spec: g.spec, boss: false });
    // Shuffle the grunts and brutes together; the boss comes ashore last.
    for (let i = queue.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [queue[i], queue[j]] = [queue[j], queue[i]]; }
    if (wave.boss) queue.push({ spec: wave.boss, boss: true });
    const m: WaveMetrics = { seconds: 0, enemies: queue.length, deaths: 0, damageTaken: 0, maxAlive: 0, hits: 0, slams: 0, slamHitsAfterReacting: 0, cleared: false };
    const foes: Foe[] = [];
    let nextLanding = 0, disembark = 0, t = 0;
    for (const b of bots) { b.hp = Math.max(b.hp, bal.player.health * 0.8); } // the rest heals most of it
    while (t < SCENARIO_RULES.waveLimitSeconds) {
      t += dt; clock += dt;
      // Disembark.
      disembark -= dt;
      if (queue.length && disembark <= 0 && foes.length < SCENARIO_RULES.maxAlive) {
        const q = queue.shift()!;
        const [lx, ly, lz] = site.landings[nextLanding++ % site.landings.length];
        const stats = statsOf(q.spec);
        const body = makeBody(lx + (rand() - 0.5) * 2, ly, lz + (rand() - 0.5) * 2, stats.width, stats.height);
        const state = newSummonState(body.x, body.y, body.z, rand);
        state.goal = [cx, 0, cz];
        foes.push({ spec: q.spec, stats, body, state, hp: q.boss ? bossHealth(stats.health, n) : stats.health, boss: q.boss });
        disembark = SCENARIO_RULES.disembarkSeconds;
      }
      m.maxAlive = Math.max(m.maxAlive, foes.length);
      if (!queue.length && !foes.length) { m.cleared = true; break; }

      // Enemies act.
      for (const f of foes) {
        stepSummon(f.spec, f.stats, f.body, f.state, {
          world, table, gravity: bal.player.gravity, rand, players: bots, groundY: (x, z) => groundY(x, z),
          bite: (pid, dmg) => {
            const b = bots.find((q) => q.id === pid);
            if (!b || b.dead > 0) return;
            if (dmg > maxHit + 1e-9) errors.push(`wave ${wi + 1}: a ${f.spec.name} hit for ${dmg} (cap ${maxHit})`);
            if (f.stats.slamRadius && b.dodgeFor >= reaction + 1e-9) m.slamHitsAfterReacting++;
            b.hp -= dmg; b.lastHurt = clock; m.hits++; m.damageTaken += dmg;
            if (b.hp <= 0) { b.dead = bal.player.respawnSeconds; m.deaths++; b.huntable = false; }
          },
          warn: () => {},
          slam: () => { m.slams++; },
        }, dt);
        // Keep the follow target fresh: the nearest living defender.
        let best = Infinity;
        for (const b of bots) if (b.dead <= 0) { const d = Math.hypot(b.x - f.body.x, b.z - f.body.z); if (d < best) { best = d; f.state.goal = [b.x, b.y, b.z]; } }
      }

      // Defenders act.
      for (const b of bots) {
        if (b.dead > 0) {
          b.dead -= dt;
          if (b.dead <= 0) { b.hp = bal.player.health; b.huntable = true; b.x = cx; b.z = cz; b.y = groundY(cx, cz) + 1; }
          continue;
        }
        if (clock - b.lastHurt > bal.player.regenDelaySeconds) b.hp = Math.min(bal.player.health, b.hp + bal.player.regenPerSecond * dt);
        b.swing = Math.max(0, b.swing - dt);
        // Danger first: a boss winding up a slam nearby → get out of the ring (after reacting).
        const slammer = foes.find((f) => f.stats.slamRadius && f.state.mode === "windup" && Math.hypot(b.x - f.body.x, b.z - f.body.z) < f.stats.slamRadius + 1.5);
        let mx = 0, mz = 0;
        if (slammer) {
          b.dodgeFor += dt;
          if (b.dodgeFor >= reaction) { const d = Math.hypot(b.x - slammer.body.x, b.z - slammer.body.z) || 1; mx = (b.x - slammer.body.x) / d; mz = (b.z - slammer.body.z) / d; }
        } else {
          b.dodgeFor = 0;
          const near = foes.filter((f) => f.hp > 0).sort((a, c) => Math.hypot(a.body.x - b.x, a.body.z - b.z) - Math.hypot(c.body.x - b.x, c.body.z - b.z))[0];
          if (near) {
            const dx = near.body.x - b.x, dz = near.body.z - b.z, d = Math.hypot(dx, dz) || 1;
            const winding = near.state.mode === "windup" && !near.stats.slamRadius && near.state.target === b.id;
            if (winding) {
              // Half the time they notice the warning and step back.
              if (b.reactingTo !== near.state.warnedAt) { b.reactingTo = near.state.warnedAt; b.missed = rand() < 0.5; }
              if (!b.missed && near.state.age - near.state.warnedAt > reaction) { mx = -dx / d; mz = -dz / d; }
            } else if (d > reach * 0.8 && Math.hypot(near.body.x - cx, near.body.z - cz) < 16) { mx = dx / d; mz = dz / d; }
            if (d < reach && Math.abs(near.body.y - b.y) < 2 && b.swing <= 0) { near.hp -= swordDamage; b.swing = swordCooldown; }
          }
        }
        if (mx || mz) {
          const nx = b.x + mx * bal.player.walkSpeed * dt, nz = b.z + mz * bal.player.walkSpeed * dt;
          const g = groundY(nx, nz);
          if (g >= 0 && g + 1 - b.y <= 1.3) { b.x = nx; b.z = nz; b.y = g + 1; }
        }
      }
      for (let i = foes.length - 1; i >= 0; i--) if (foes[i].hp <= 0) foes.splice(i, 1);
    }
    m.seconds = Math.round(t);
    results.push(m);
    if (!m.cleared) errors.push(`wave ${wi + 1} couldn't be finished in ${SCENARIO_RULES.waveLimitSeconds} s by ${n} defenders`);
    if (m.slamHitsAfterReacting > 0) errors.push(`wave ${wi + 1}: a boss slam hit a defender who was already stepping away (the warning is too short or the ring too big)`);
    const perMin = m.deaths / n / Math.max(1, m.seconds / 60);
    if (perMin > 1) warnings.push(`wave ${wi + 1}: ${perMin.toFixed(1)} deaths per player per minute (the fun standard is ≤ 1)`);
    if (m.cleared && m.seconds > 180) warnings.push(`wave ${wi + 1} took ${m.seconds} s; rounds of 3–10 min overall read better with shorter waves`);
    if (errors.length) break;
  }
  // Difficulty should rise: later waves should cost the defenders more (damage taken), not less.
  if (results.length >= 3 && results[results.length - 1].damageTaken < results[0].damageTaken)
    warnings.push("the last wave was easier than the first; difficulty should build up");
  return { ok: errors.length === 0, errors, warnings, waves: results };
}
