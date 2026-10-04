import { raycast, type BlockQuery } from "@lfg/shared";
import type { Surroundings } from "./audio";

/** Rays cast around the listener: the four sides, the four diagonals, up, and up at an angle. */
const DIRS: [number, number, number][] = [
  [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
  [1, 0, 1], [1, 0, -1], [-1, 0, 1], [-1, 0, -1],
  [0, 1, 0], [0.6, 1, 0], [-0.6, 1, 0], [0, 1, 0.6], [0, 1, -0.6],
  [1, -0.4, 0], [-1, -0.4, 0], [0, -0.4, 1], [0, -0.4, -1],
];
const REACH = 20;

/**
 * What the space around a point sounds like: how enclosed it is and how big, whether there's a
 * roof or rock overhead, and how much tree, grass and water is about. A handful of rays and
 * samples, cheap enough to run a few times a second.
 */
export function probeSurroundings(
  world: BlockQuery,
  solid: (id: number) => boolean,
  kindOf: (id: number) => "stone" | "tree" | "grass" | "water" | "other",
  x: number, y: number, z: number,
): Surroundings {
  let hits = 0, dist = 0, stone = 0, trees = 0, roof = false;
  for (const [dx, dy, dz] of DIRS) {
    const h = raycast(world, x, y, z, dx, dy, dz, REACH, solid);
    if (!h) continue;
    hits++;
    dist += h.distance;
    const k = kindOf(world.getBlock(h.x, h.y, h.z));
    if (k === "stone") stone++;
    if (k === "tree") trees++;
    if (dx === 0 && dz === 0 && dy > 0 && h.distance < REACH) roof = true;
  }
  // Water and grass about: a ring of samples a little way out, at and below the feet.
  let water = 0, grass = 0, samples = 0;
  for (let r = 3; r <= 12; r += 3)
    for (let a = 0; a < 8; a++) {
      const sx = Math.floor(x + Math.cos(a * 0.785 + r) * r), sz = Math.floor(z + Math.sin(a * 0.785 + r) * r);
      for (let dy = 1; dy >= -4; dy--) {
        const id = world.getBlock(sx, Math.floor(y) + dy - 1, sz);
        if (!id) continue;
        const k = kindOf(id);
        if (k === "water") water++;
        else if (k === "grass") grass++;
        break;
      }
      samples++;
    }
  // Horizontal-ish walls count most; a roof alone (under a tree) is not a room.
  const enclosed = hits / DIRS.length;
  return {
    enclosed: enclosed * enclosed * (roof ? 1 : 0.6),
    room: hits ? dist / hits : REACH,
    cave: roof && hits ? Math.min(1, (stone / hits) * 1.4) : 0,
    roof,
    trees: Math.min(1, trees / 4),
    water: Math.min(1, (water / samples) * 3),
    grass: grass / samples,
  };
}
