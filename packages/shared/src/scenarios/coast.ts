import type { BlockQuery } from "../chunk";
import type { BlockTable } from "../physics";
import { waterSurface } from "../summons/brain";
import type { ScenarioSite } from "./playtest";

export interface Coast extends ScenarioSite {
  /** The beach point the invaders head for. */
  beach: [number, number, number];
  /** Unit vector from the beach out to sea. */
  seaward: [number, number];
  /** Where each ship drops anchor (in water deep enough for its keel). */
  anchors: [number, number, number][];
  /** Where each ship appears, out at sea. */
  starts: [number, number, number][];
}

const depthAt = (world: BlockQuery, table: BlockTable, x: number, z: number): number => {
  const top = waterSurface({ world, table }, x, z);
  if (top === null) return 0;
  let d = 0;
  while (d < 8 && table.liquid[world.getBlock(Math.floor(x), top - 1 - d, Math.floor(z))]) d++;
  return d;
};

/**
 * The nearest stretch of coast with open sea in front of it: a low beach next
 * to water that keeps going for a good distance (so ships can sail in), away
 * from the spawn safe zone (hostile events can't reach it).
 */
export function findCoast(
  world: BlockQuery,
  table: BlockTable,
  isLoaded: (x: number, z: number) => boolean,
  from: [number, number],
  opts: { ships: number; avoid: { x: number; z: number; radius: number }; maxDistance?: number; seaRun?: number },
): Coast | null {
  const seaRun = opts.seaRun ?? 28;
  const maxR = opts.maxDistance ?? 110;
  const column = (x: number, z: number) => {
    for (let y = 126; y > 0; y--) {
      const id = world.getBlock(Math.floor(x), y, Math.floor(z));
      if (id === 0) continue;
      return { y, liquid: !!table.liquid[id], solid: !!table.solid[id] };
    }
    return null;
  };
  const seaWater = (x: number, z: number) => isLoaded(x, z) && waterSurface({ world, table }, x, z) !== null;
  const DIRS = 16;
  for (let r = 8; r <= maxR; r += 4) {
    const steps = Math.max(12, Math.round((r * Math.PI * 2) / 6));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const bx = Math.floor(from[0] + Math.cos(a) * r) + 0.5, bz = Math.floor(from[1] + Math.sin(a) * r) + 0.5;
      if (!isLoaded(bx, bz)) continue;
      if (Math.hypot(bx - opts.avoid.x, bz - opts.avoid.z) < opts.avoid.radius + 8) continue;
      const col = column(bx, bz);
      if (!col || col.liquid || !col.solid) continue;
      const sea = waterSurface({ world, table }, bx + 1, bz) ?? waterSurface({ world, table }, bx - 1, bz) ?? waterSurface({ world, table }, bx, bz + 1) ?? waterSurface({ world, table }, bx, bz - 1);
      if (sea === null || col.y + 1 > sea + 3) continue; // must be a low beach right at the water
      for (let k = 0; k < DIRS; k++) {
        const da = (k / DIRS) * Math.PI * 2, dx = Math.cos(da), dz = Math.sin(da);
        // Water from right off the beach out to the open sea.
        // The ships anchor where it first gets deep enough for a keel (2 blocks), and start a good
        // way further out, so they're seen sailing in.
        let ok = true, anchorAt = -1;
        for (let s = 2; anchorAt < 0 ? s <= 30 : s <= anchorAt + seaRun; s++) {
          if (!seaWater(bx + dx * s, bz + dz * s)) { ok = false; break; }
          if (anchorAt < 0 && s >= 5 && depthAt(world, table, bx + dx * s, bz + dz * s) >= 2) anchorAt = s;
        }
        if (!ok || anchorAt < 0) continue;
        const out = anchorAt + seaRun;
        // Spread the ships along the shore; each needs its own lane of water.
        const px = -dz, pz = dx;
        const anchors: [number, number, number][] = [], starts: [number, number, number][] = [], landings: [number, number, number][] = [];
        const offsets = [0, 8, -8, 16, -16, 24, -24];
        for (const o of offsets) {
          if (anchors.length >= opts.ships) break;
          const ax = bx + dx * (anchorAt + 2) + px * o, az = bz + dz * (anchorAt + 2) + pz * o;
          const sx = bx + dx * out + px * o, sz = bz + dz * out + pz * o;
          let lane = true;
          for (let s = anchorAt; s <= out; s += 2) if (!seaWater(bx + dx * s + px * o, bz + dz * s + pz * o)) { lane = false; break; }
          if (!lane || depthAt(world, table, ax, az) < 2) continue;
          const sy = waterSurface({ world, table }, ax, az)!;
          anchors.push([ax, sy - 1, az]);
          starts.push([sx, sy - 1, sz]);
          // Raiders jump off the side facing the shore, into the shallows.
          landings.push([bx + dx * Math.max(2, anchorAt - 1) + px * o, sy, bz + dz * Math.max(2, anchorAt - 1) + pz * o]);
        }
        if (!anchors.length) continue;
        const camp: [number, number, number] = [bx - dx * 4, 0, bz - dz * 4];
        const cc = column(camp[0], camp[2]);
        camp[1] = cc && !cc.liquid ? cc.y + 1 : col.y + 1;
        if (cc?.liquid) { camp[0] = bx; camp[2] = bz; }
        return { beach: [bx, col.y + 1, bz], seaward: [dx, dz], anchors, starts, landings, camp };
      }
    }
  }
  return null;
}
