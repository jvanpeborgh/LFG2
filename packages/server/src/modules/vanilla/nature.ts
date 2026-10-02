import { WORLD_HEIGHT } from "@lfg/shared";
import type { ServerModule } from "../../kernel";

/**
 * Day/night cycle and slow natural changes: saplings grow into trees, grass
 * spreads onto lit dirt and dies under solid blocks.
 */
export const nature: ServerModule = {
  id: "vanilla:nature",
  name: "Nature",
  version: "0.1.0",
  author: "lfg",
  description: "Day/night cycle, sapling growth, grass spreading.",
  setup(api) {
    const { reg, table, world } = api;
    const id = (n: string) => reg.blockId(n);
    const [grass, dirt, sapling, log, leaves] = ["grass", "dirt", "sapling", "log", "leaves"].map(id);

    // Time of day. Clients interpolate between updates.
    api.on("tick", ({ dt }) => {
      const { time, dayLength } = api.time();
      api.setTime((time + dt) % dayLength);
    });
    api.every(5, () => {
      const { time, dayLength } = api.time();
      for (const p of api.players()) p.send({ t: "time", time, dayLength });
    });
    api.on("player:join", ({ player }) => {
      const { time, dayLength } = api.time();
      player.send({ t: "time", time, dayLength });
    });

    const growTree = (x: number, y: number, z: number): boolean => {
      const h = 4 + Math.floor(api.rand() * 3);
      if (y + h + 2 >= WORLD_HEIGHT) return false;
      for (let yy = y + 1; yy <= y + h; yy++) if (world.getBlock(x, yy, z) !== 0) return false;
      world.setBlock(x, y, z, log);
      for (let yy = y + 1; yy < y + h; yy++) world.setBlock(x, yy, z, log);
      const top = y + h;
      for (let yy = top - 2; yy <= top + 1; yy++) {
        const r = yy >= top ? 1 : 2;
        for (let dz = -r; dz <= r; dz++)
          for (let dx = -r; dx <= r; dx++) {
            if (yy === top + 1 && Math.abs(dx) + Math.abs(dz) > 1) continue;
            if (r === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2 && api.rand() < 0.5) continue;
            if (world.getBlock(x + dx, yy, z + dz) === 0) world.setBlock(x + dx, yy, z + dz, leaves);
          }
      }
      return true;
    };

    api.on("block:randomTick", ({ x, y, z, id: b }) => {
      if (b === sapling) {
        if (api.rand() < 0.15) growTree(x, y, z);
      } else if (b === grass) {
        if (table.opaque[world.getBlock(x, y + 1, z)]) { world.setBlock(x, y, z, dirt); return; }
        // Spread to a nearby dirt block with open air above.
        const tx = x + Math.floor(api.rand() * 3) - 1, ty = y + Math.floor(api.rand() * 5) - 3, tz = z + Math.floor(api.rand() * 3) - 1;
        if (world.getBlock(tx, ty, tz) === dirt && !table.opaque[world.getBlock(tx, ty + 1, tz)] && !table.liquid[world.getBlock(tx, ty + 1, tz)]) world.setBlock(tx, ty, tz, grass);
      }
    });

    api.provide("growTree", growTree);
  },
};
