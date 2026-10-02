import type { Standards } from "../standards";
import { parseHex } from "../texture";
import type { SummonSpec } from "./spec";

/**
 * Bring a spec within the rules before building it, and say what changed
 * ("a giant whale" becomes the biggest whale the world allows). Agents get the
 * same notes back, so they learn the limits instead of hitting a wall.
 */
export function fitSpecToRules(spec: SummonSpec, std: Standards): { spec: SummonSpec; notes: string[] } {
  const sm = std.summons;
  const out = { ...spec, colors: { ...spec.colors }, features: [...spec.features], abilities: [...spec.abilities] };
  const notes: string[] = [];
  const maxLen = out.temperament === "hostile" ? sm.hostileMaxLengthBlocks : sm.maxLengthBlocks;
  if (out.length > maxLen) {
    notes.push(`made it ${maxLen} blocks long instead of ${out.length.toFixed(1)} (the limit for ${out.temperament === "hostile" ? "hostile summons" : "summons"})`);
    out.length = maxLen;
  }
  if (out.length < 0.3) { notes.push("made it a bit bigger so it can be seen"); out.length = 0.3; }
  if (out.count > sm.maxCountPerSummon) { notes.push(`summoning ${sm.maxCountPerSummon} instead of ${out.count}`); out.count = sm.maxCountPerSummon; }
  if (out.count < 1) out.count = 1;
  return { spec: out, notes };
}
import { modelStats, type ModelStats, type VoxelModel } from "./voxel";

/**
 * Default behaviour numbers for a summon, derived from the world standards
 * (balance, fun and comfort rules) rather than invented per creature.
 */
export interface SummonStats {
  kind: "passive" | "hostile" | "object";
  health: number;
  /** Damage per bite (0 = harmless). */
  damage: number;
  /** Warning before a bite lands (seconds). */
  telegraph: number;
  cooldown: number;
  speed: number;
  /** Collision box (blocks). */
  width: number;
  height: number;
  /** Height above the ground it keeps (flyers, clouds). */
  altitude: [number, number];
  lifetime: number;
}

export function summonStats(spec: SummonSpec, model: VoxelModel, std: Standards): SummonStats {
  const s = modelStats(model);
  const bal = std.balance, sm = std.summons;
  const bites = spec.abilities.includes("bite") && spec.temperament !== "passive";
  const kind = spec.body === "cloud" ? "object" : spec.temperament === "hostile" ? "hostile" : "passive";
  const big = spec.length >= 3;
  // Health: 3–6 hits with a decent sword for anything that fights (standards: normal enemies 3–6 hits).
  const sword = 16;
  const health = kind === "object" ? 1000
    : bites || spec.temperament === "neutral" ? Math.round(sword * Math.min(bal.enemyHitsToDefeat[1], Math.max(bal.enemyHitsToDefeat[0], 2 + spec.length)))
    : Math.round(Math.max(10, Math.min(120, 12 * spec.length)));
  let damage = bites ? (big ? bal.damage.heavyHit : bal.damage.lightHit) : 0;
  const maxHit = bal.player.health * bal.damage.maxHitShareOfHealth;
  damage = Math.min(damage, maxHit);
  const telegraph = Math.max(std.audio.telegraphLeadSeconds, damage >= bal.damage.heavyHit ? 1 : 0.75);
  const walk = bal.player.walkSpeed;
  const speed =
    spec.movement === "drift" ? 0.9
    : spec.movement === "hover" ? 0.9
    : spec.movement === "walk" ? (bites ? walk * 0.6 : 1.4)
    // Flyers and swimmers that hunt stay slower than a walking player, so running away works.
    : bites || kind === "hostile" ? walk * sm.hostileSpeedShareOfWalk
    : 3;
  const [sx, sy, sz] = s.size;
  return {
    kind,
    health,
    damage,
    telegraph,
    cooldown: sm.biteCooldownSeconds,
    speed,
    width: Math.max(0.4, Math.min(2.5, Math.min(sx, sz) * 0.9)),
    height: Math.max(0.4, Math.min(3, sy * 0.9)),
    altitude: spec.movement === "drift" ? [sm.cloudAltitudeAboveGround, sm.cloudAltitudeAboveGround + 6]
      : spec.movement === "fly" ? (sm.flyAltitudeAboveGround as [number, number])
      : [0, 0],
    lifetime: sm.lifetimeMinutes * 60,
  };
}

export interface SummonReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  stats: ModelStats & { budget: string; maxTriangles: number };
}

const luminance = (hex: string) => {
  const [r, g, b] = parseHex(hex).map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Check a generated summon against the standards. Errors fizzle it; warnings go back to whoever asked. */
export function checkSummon(spec: SummonSpec, model: VoxelModel, std: Standards): SummonReport {
  const errors: string[] = [], warnings: string[] = [];
  const sm = std.summons;
  const s = modelStats(model);
  // Asset budget: the smallest category it fits in decides the triangle limit.
  const sorted = [...s.size].sort((a, b) => a - b);
  const budgets = Object.entries(std.locked.assetBudgets)
    .map(([name, b]) => ({ name, dims: [...b.maxBlocks].sort((a, c) => a - c), tris: b.maxTris }))
    .sort((a, b) => a.dims[2] - b.dims[2]);
  const fit = budgets.find((b) => sorted.every((v, i) => v <= b.dims[i] + 1e-6));
  if (!fit) errors.push(`too big: ${s.size.map((v) => v.toFixed(1)).join(" × ")} blocks`);
  if (fit && s.triangles > fit.tris) errors.push(`too detailed: ${s.triangles} triangles (limit ${fit.tris} for a ${fit.name})`);
  if (spec.length > sm.maxLengthBlocks) errors.push(`longer than ${sm.maxLengthBlocks} blocks`);
  if (spec.temperament === "hostile" && spec.length > sm.hostileMaxLengthBlocks)
    errors.push(`hostile summons can be at most ${sm.hostileMaxLengthBlocks} blocks long (bigger needs a boss fight design)`);
  if (spec.count > sm.maxCountPerSummon) errors.push(`at most ${sm.maxCountPerSummon} at once`);
  // Colours: only from the world palette; the danger colour only on things that are dangerous.
  const allowed = new Set([...Object.values(std.art.palette), ...Object.values(std.art.reserved)].map((c) => c.toLowerCase()));
  const off = s.colors.filter((c) => !allowed.has(c.toLowerCase()));
  if (off.length) errors.push(`colours outside the world palette: ${off.join(", ")}`);
  if (spec.temperament !== "hostile" && s.colors.includes(std.art.reserved.danger)) warnings.push("uses the danger colour but isn't dangerous");
  // Readability: back and belly should differ enough in brightness to show its shape.
  const P = std.art.palette as Record<string, string>;
  const contrast = Math.abs(luminance(P[spec.colors.main] ?? "#888888") - luminance(P[spec.colors.belly] ?? "#888888"));
  if (spec.body !== "cloud" && contrast < 0.06) warnings.push(`low contrast between back and belly (${contrast.toFixed(2)}): it may read as a flat blob`);
  if (s.voxels < 20) warnings.push("very few voxels: it may be hard to recognise");
  if (spec.body === "cloud") {
    const bumps = topBumps(model);
    if (bumps < 3) warnings.push(`silhouette has ${bumps} bump${bumps === 1 ? "" : "s"} on top; clouds read best with 3 or more`);
  }
  return { ok: errors.length === 0, errors, warnings, stats: { ...s, budget: fit?.name ?? "none", maxTriangles: fit?.tris ?? 0 } };
}

/**
 * Count distinct bumps along the top outline seen from the side (longest axis):
 * local maxima that rise at least 2 voxels above the dips on both sides.
 */
export function topBumps(model: VoxelModel): number {
  const g = model.parts[0].grid;
  const long = g.w >= g.d ? "x" : "z";
  const n = long === "x" ? g.w : g.d;
  const prof: number[] = [];
  for (let i = 0; i < n; i++) {
    let top = -1;
    const m = long === "x" ? g.d : g.w;
    for (let j = 0; j < m; j++)
      for (let y = g.h - 1; y > top; y--) if (long === "x" ? g.get(i, y, j) : g.get(j, y, i)) { top = y; break; }
    prof.push(top);
  }
  let bumps = 0;
  let lastDip = -1, rising = true, peak = -1;
  for (let i = 0; i < prof.length; i++) {
    const h = prof[i];
    if (h < 0) continue;
    if (rising) {
      if (h > peak) peak = h;
      else if (peak - h >= 2) { if (peak - Math.max(lastDip, 0) >= 2 || lastDip < 0) bumps++; rising = false; lastDip = h; }
    } else {
      if (h < lastDip) lastDip = h;
      else if (h - lastDip >= 2) { rising = true; peak = h; }
    }
  }
  if (rising && peak >= 0 && peak - Math.max(lastDip, 0) >= 2 && bumps === 0) bumps = 1;
  else if (rising && peak - lastDip >= 2 && lastDip >= 0) bumps++;
  return bumps;
}
