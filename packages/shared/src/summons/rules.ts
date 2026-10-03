import type { Standards } from "../standards";
import { parseHex } from "../texture";
import type { SummonSpec } from "./spec";

/**
 * Bring a spec within the rules before building it, and say what changed
 * ("a giant whale" becomes the biggest whale the world allows). Agents get the
 * same notes back, so they learn the limits instead of hitting a wall.
 */
export function fitSpecToRules(spec: SummonSpec, std: Standards, tier = 2): { spec: SummonSpec; notes: string[] } {
  const sm = std.summons;
  const out = { ...spec, colors: { ...spec.colors }, features: [...spec.features], abilities: [...spec.abilities] };
  const notes: string[] = [];
  // Big hostiles (a kraken) are boss fights: allowed from tier 3, and they follow the boss rules.
  const maxLen = out.temperament === "hostile" ? hostileMaxLength(std, tier) : sm.maxLengthBlocks;
  if (out.temperament === "hostile" && Math.min(out.length, maxLen) > sm.hostileMaxLengthBlocks && out.role !== "boss") {
    out.role = "boss";
    notes.push("it's big enough to be a boss: it follows the boss rules (longer warnings, more health)");
  }
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
import { MODEL_STYLES, meshModel, type ModelStyle } from "./mesh";

/** The asset budget a model falls in (the smallest category it fits), by its size. */
export function assetBudget(model: VoxelModel, std: Standards): { name: string; maxTris: number } | null {
  const sorted = [...modelStats(model).size].sort((a, b) => a - b);
  const fit = Object.entries(std.locked.assetBudgets)
    .map(([name, b]) => ({ name, dims: [...b.maxBlocks].sort((a, c) => a - c), maxTris: b.maxTris }))
    .sort((a, b) => a.dims[2] - b.dims[2])
    .find((b) => sorted.every((v, i) => v <= b.dims[i] + 1e-6));
  return fit ? { name: fit.name, maxTris: fit.maxTris } : null;
}

/** The world's model style (art.modelStyle), falling back to voxel. */
export function modelStyleOf(std: Standards): ModelStyle {
  const s = (std.art as { modelStyle?: string }).modelStyle as ModelStyle;
  return MODEL_STYLES.includes(s) ? s : "voxel";
}

/** Longest hostile summon allowed: the normal limit, or boss-sized from tier 3 (progression standards). */
export function hostileMaxLength(std: Standards, tier: number): number {
  return tier >= 3 ? std.summons.maxLengthBlocks : std.summons.hostileMaxLengthBlocks;
}

/**
 * Default behaviour numbers for a summon, derived from the world standards
 * (balance, fun and comfort rules) rather than invented per creature.
 */
export interface SummonStats {
  kind: "passive" | "hostile" | "object";
  /** Bosses: a telegraphed ground slam around them instead of a bite (radius in blocks). */
  slamRadius?: number;
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
  const kind = spec.body === "cloud" || spec.body === "ship" ? "object" : spec.temperament === "hostile" ? "hostile" : "passive";
  const big = spec.length >= 3;
  const boss = spec.role === "boss" && kind === "hostile";
  // Health: 3–6 hits with a decent sword for anything that fights (standards: normal enemies 3–6 hits).
  const sword = 16;
  const health = kind === "object" ? 1000
    : bites || spec.temperament === "neutral" ? Math.round(sword * Math.min(bal.enemyHitsToDefeat[1], Math.max(bal.enemyHitsToDefeat[0], 2 + spec.length)))
    : Math.round(Math.max(10, Math.min(120, 12 * spec.length)));
  let damage = bites ? (big ? bal.damage.heavyHit : bal.damage.lightHit) : boss ? bal.damage.heavyHit : 0;
  const maxHit = bal.player.health * bal.damage.maxHitShareOfHealth;
  damage = Math.min(damage, maxHit);
  // Boss attacks are telegraphed longer (standards: boss attacks ≥ 1.5 s).
  const telegraph = boss ? bal.damage.bossTelegraphSeconds : Math.max(std.audio.telegraphLeadSeconds, damage >= bal.damage.heavyHit ? 1 : 0.75);
  const walk = bal.player.walkSpeed;
  const speed =
    spec.movement === "drift" ? 0.9
    : spec.movement === "hover" ? 0.9
    : spec.movement === "sail" ? 3
    : spec.movement === "walk" ? (boss ? walk * 0.5 : bites ? walk * 0.6 : 1.4)
    // Flyers and swimmers that hunt stay slower than a walking player, so running away works.
    : bites || kind === "hostile" ? walk * sm.hostileSpeedShareOfWalk
    : 3;
  const [sx, sy, sz] = s.size;
  return {
    kind,
    // Bosses: a fight sized for one player here; scenarios scale it by the players nearby.
    // (Bigger bosses take longer: a 3-block captain is the baseline.)
    health: boss ? Math.round(sword * sm.bossHitsPerPlayer * Math.max(1, spec.length / 3)) : health,
    damage,
    telegraph,
    cooldown: boss ? sm.bossSlamCooldownSeconds : sm.biteCooldownSeconds,
    ...(boss ? { slamRadius: sm.bossSlamRadius } : {}),
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
export function checkSummon(spec: SummonSpec, model: VoxelModel, std: Standards, tier = 2): SummonReport {
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
  // Triangles as this world draws it (voxel, smooth or low-poly; smooth/low-poly pick the detail that fits).
  const style = modelStyleOf(std);
  if (style !== "voxel" && fit) {
    const m = meshModel(model, style, fit.tris);
    s.triangles = m.triangles;
    if (m.scale !== (style === "smooth" ? 2 : 0.5)) warnings.push(`drawn at ${m.scale}× detail in the ${style} style to stay within ${fit.tris} triangles`);
  }
  if (fit && s.triangles > fit.tris) errors.push(`too detailed: ${s.triangles} triangles (limit ${fit.tris} for a ${fit.name})`);
  if (spec.length > sm.maxLengthBlocks) errors.push(`longer than ${sm.maxLengthBlocks} blocks`);
  if (spec.temperament === "hostile" && spec.length > hostileMaxLength(std, tier))
    errors.push(`hostile summons can be at most ${hostileMaxLength(std, tier)} blocks long (bigger needs a boss fight design, from tier 3)`);
  if (spec.temperament === "hostile" && spec.length > sm.hostileMaxLengthBlocks && spec.role !== "boss")
    errors.push(`hostile summons longer than ${sm.hostileMaxLengthBlocks} blocks must follow the boss rules`);
  if (spec.count > sm.maxCountPerSummon) errors.push(`at most ${sm.maxCountPerSummon} at once`);
  // Colours: only from the world palette; the danger colour only on things that are dangerous.
  const allowed = new Set([...Object.values(std.art.palette), ...Object.values(std.art.reserved)].map((c) => c.toLowerCase()));
  const off = s.colors.filter((c) => !allowed.has(c.toLowerCase()));
  if (off.length) errors.push(`colours outside the world palette: ${off.join(", ")}`);
  if (spec.temperament !== "hostile" && s.colors.includes(std.art.reserved.danger)) warnings.push("uses the danger colour but isn't dangerous");
  // Readability: back and belly should differ enough in brightness to show its shape.
  const P = std.art.palette as Record<string, string>;
  const contrast = Math.abs(luminance(P[spec.colors.main] ?? "#888888") - luminance(P[spec.colors.belly] ?? "#888888"));
  if (spec.body !== "cloud" && spec.body !== "biped" && spec.body !== "ship" && contrast < 0.06) warnings.push(`low contrast between back and belly (${contrast.toFixed(2)}): it may read as a flat blob`);
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
