import { WORLD_HEIGHT, type BlockQuery } from "../chunk";
import { bodyCollides, makeBody, type BlockTable } from "../physics";
import { mulberry32 } from "../random";
import type { Standards } from "../standards";
import { newSummonState, stepSummon, type BrainPlayer } from "./brain";
import type { SummonStats } from "./rules";
import type { SummonSpec } from "./spec";

/**
 * Shadow playtest: run a summon's behaviour against the real terrain with
 * three virtual players for a while, then check what happened against the
 * fun and comfort rules. Runs during a world event's gathering phase, so a
 * summon that would be unfair never arrives.
 */
export interface PlaytestResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  metrics: {
    seconds: number;
    bites: number;
    /** Shortest warning before a bite (s). */
    minWarning: number | null;
    maxDamage: number;
    /** Shortest time between two bites (s). */
    minBiteGap: number | null;
    deathsPerPlayerMinute: number;
    lunges: number;
    /** Lunges aimed at the sidestepping player, and how many it dodged. */
    lungesAtDodger: number;
    dodged: number;
    /** Dodge attempts that didn't count because terrain stopped the test player moving. */
    blockedDodges: number;
    bitesByRole: Record<string, number>;
    runnerBites: number;
    insideBlocks: number;
    maxDistanceFromHome: number;
    movingShare: number;
    msPerTick: number;
  };
}

type Bot = BrainPlayer & { role: "still" | "dodger" | "runner"; health: number; deaths: number; vx: number; vz: number };

export function playtestSummon(
  spec: SummonSpec,
  stats: SummonStats,
  std: Standards,
  world: BlockQuery,
  table: BlockTable,
  spawn: [number, number, number],
  seconds = 40,
): PlaytestResult {
  const rand = mulberry32(spec.seed ^ 0x9e3779b9);
  const groundY = (x: number, z: number) => {
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) if (table.solid[world.getBlock(x, y, z)]) return y;
    return -1;
  };
  const [sx, sy, sz] = spawn;
  const place = (dx: number, dz: number) => {
    const x = Math.floor(sx + dx) + 0.5, z = Math.floor(sz + dz) + 0.5;
    return { x, z, y: groundY(Math.floor(x), Math.floor(z)) + 1 };
  };
  const bots: Bot[] = (["still", "dodger", "runner"] as const).map((role, i) => {
    const a = (i / 3) * Math.PI * 2;
    const p = place(Math.cos(a) * 6, Math.sin(a) * 6);
    return { id: -(i + 1), role, x: p.x, y: p.y, z: p.z, huntable: true, health: std.balance.player.health, deaths: 0, vx: 0, vz: 0 };
  });

  const body = makeBody(sx, sy, sz, stats.width, stats.height);
  const state = newSummonState(sx, sy, sz, rand);
  let bites = 0, maxDamage = 0, lunges = 0, lungesAtDodger = 0, dodged = 0, runnerBites = 0, inside = 0, maxAway = 0, moving = 0;
  const bitesByRole: Record<string, number> = { still: 0, dodger: 0, runner: 0 };
  let minWarning: number | null = null, minGap: number | null = null, lastBite = -Infinity;
  let lungeTarget: Bot | null = null, wasLunging = false, bitThisLunge = false;
  /** Where the dodger was when the warning started (to check it really got to sidestep). */
  let dodgeStart: [number, number] | null = null, wasWarning = false, blockedDodges = 0;
  const warnings: string[] = [], errors: string[] = [];
  const dt = 0.05;
  let t = 0;
  const start = performance.now();

  const ctx = {
    world, table, gravity: std.balance.player.gravity, rand, players: bots, groundY,
    bite: (id: number, dmg: number) => {
      const bot = bots.find((b) => b.id === id);
      if (!bot) return;
      bites++;
      bitThisLunge = true;
      maxDamage = Math.max(maxDamage, dmg);
      const warned = state.age - state.warnedAt;
      minWarning = minWarning === null ? warned : Math.min(minWarning, warned);
      if (t - lastBite < Infinity) minGap = minGap === null ? t - lastBite : Math.min(minGap, t - lastBite);
      lastBite = t;
      if (bot.role === "runner") runnerBites++;
      bitesByRole[bot.role]++;
      bot.health -= dmg;
      if (bot.health <= 0) { bot.deaths++; bot.health = std.balance.player.health; const p = place((rand() - 0.5) * 4, (rand() - 0.5) * 4); Object.assign(bot, p); }
    },
    warn: () => {},
  };

  for (; t < seconds; t += dt) {
    // Each test player takes a turn as the only one in reach, so standing still, dodging and running
    // away are all tested (otherwise a hunter just keeps picking the nearest one).
    const turn = Math.min(2, Math.floor((t / seconds) * 3));
    for (const [i, bot] of bots.entries()) bot.huntable = spec.movement === "drift" || i === turn;
    // Bots: one stands still, one sidesteps when it sees the warning flash, one runs away.
    for (const bot of bots) {
      let wx = 0, wz = 0, speed = std.balance.player.walkSpeed;
      const dx = body.x - bot.x, dz = body.z - bot.z, d = Math.hypot(dx, dz) || 1;
      if (bot.role === "dodger" && (state.flags & 4) && state.target === bot.id) { wx = -dz / d; wz = dx / d; }
      if (bot.role === "runner" && d < 10) { wx = -dx / d; wz = -dz / d; speed = std.balance.player.sprintSpeed; }
      bot.vx += (wx * speed - bot.vx) * 0.5;
      bot.vz += (wz * speed - bot.vz) * 0.5;
      const nx = bot.x + bot.vx * dt, nz = bot.z + bot.vz * dt;
      const g = groundY(Math.floor(nx), Math.floor(nz));
      if (Math.abs(g + 1 - bot.y) <= 1.01) { bot.x = nx; bot.z = nz; bot.y = g + 1; } // walk, step up one block
      // Runners keep within 60 blocks so the test stays in loaded terrain.
      if (Math.hypot(bot.x - sx, bot.z - sz) > 60) { const p = place(0, 0); Object.assign(bot, p); }
    }
    stepSummon(spec, stats, body, state, ctx, dt);
    const warning = state.mode === "windup";
    if (warning && !wasWarning) dodgeStart = [bots[1].x, bots[1].z];
    wasWarning = warning;
    // Count lunges and whether the dodger got away.
    const lunging = state.mode === "lunge";
    if (lunging && !wasLunging) {
      lunges++;
      lungeTarget = bots.find((b) => b.id === state.target) ?? null;
      bitThisLunge = false;
    }
    if (!lunging && wasLunging && lungeTarget?.role === "dodger") {
      // Only count it as a dodge attempt if the test player actually got to move (terrain can block a bot).
      const moved = dodgeStart ? Math.hypot(lungeTarget.x - dodgeStart[0], lungeTarget.z - dodgeStart[1]) : 0;
      if (moved >= 2.5) {
        lungesAtDodger++;
        if (!bitThisLunge) dodged++;
      } else blockedDodges++;
    }
    wasLunging = lunging;
    if (spec.movement !== "drift" && bodyCollides(world, table, { ...body, width: body.width * 0.8, height: body.height * 0.8, y: body.y + body.height * 0.1 })) inside += dt;
    maxAway = Math.max(maxAway, Math.hypot(body.x - sx, body.z - sz));
    if (state.flags & 2) moving += dt;
    if (body.y < 0 || body.y > WORLD_HEIGHT + 4) { errors.push("left the world"); break; }
  }
  const ms = (performance.now() - start) / (seconds / dt);
  const deaths = bots.reduce((n, b) => n + b.deaths, 0);
  const deathsPerPlayerMinute = deaths / bots.length / (seconds / 60);
  const bal = std.balance;
  const cap = bal.player.health * bal.damage.maxHitShareOfHealth;

  // Hard rules (fizzle).
  if (minWarning !== null && minWarning + 1e-6 < std.audio.telegraphLeadSeconds) errors.push(`bit after only ${(minWarning as number).toFixed(2)} s of warning (rule: ≥ ${std.audio.telegraphLeadSeconds} s)`);
  if (maxDamage > cap) errors.push(`a bite did ${maxDamage} damage (rule: ≤ ${cap})`);
  if (minGap !== null && minGap + 1e-6 < std.summons.biteCooldownSeconds) errors.push(`bit twice within ${(minGap as number).toFixed(1)} s (rule: ≥ ${std.summons.biteCooldownSeconds} s apart)`);
  if (inside > seconds * 0.1) errors.push(`spent ${Math.round((inside / seconds) * 100)}% of the time inside blocks`);
  if (spec.movement !== "drift" && maxAway > 80) errors.push(`wandered ${Math.round(maxAway)} blocks away`);
  if (lungesAtDodger >= 2 && dodged === 0) errors.push(`its attacks can't be dodged (the sidestepping player was hit by all ${lungesAtDodger} lunges)`);
  // Fun report (warnings).
  if (deathsPerPlayerMinute > 1) warnings.push(`too deadly: ${deathsPerPlayerMinute.toFixed(1)} deaths per player per minute (fun rule: ≤ 1)`);
  if (runnerBites > Math.max(1, seconds / 20)) warnings.push(`hard to escape: a running player was bitten ${runnerBites} times`);
  if (stats.damage > 0 && spec.temperament === "hostile" && lunges === 0 && bites === 0) warnings.push("never attacked anyone in the test");
  if (moving < seconds * 0.3) warnings.push("barely moved; it may look stuck");
  if (ms > 0.5) warnings.push(`expensive: ${ms.toFixed(2)} ms per tick`);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    metrics: {
      seconds: +t.toFixed(1), bites, minWarning: minWarning === null ? null : +(minWarning as number).toFixed(2), maxDamage,
      minBiteGap: minGap === null ? null : +(minGap as number).toFixed(2), deathsPerPlayerMinute: +deathsPerPlayerMinute.toFixed(2),
      lunges, lungesAtDodger, dodged, blockedDodges, bitesByRole, runnerBites, insideBlocks: +inside.toFixed(1), maxDistanceFromHome: Math.round(maxAway), movingShare: +(moving / seconds).toFixed(2), msPerTick: +ms.toFixed(3),
    },
  };
}
