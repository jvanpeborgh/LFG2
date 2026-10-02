import { stepBody } from "@lfg/shared";
import type { Entity } from "../../entities";
import type { ServerModule } from "../../kernel";

export type ExplodeFn = (x: number, y: number, z: number, power: number, cause?: Entity) => void;

/**
 * Explosions (used by TNT and creepers) and TNT itself. TNT is lit with flint
 * and steel, fizzes for 4 s (a clear telegraph), then explodes; nearby TNT
 * chains with a shorter fuse.
 */
export const explosives: ServerModule = {
  id: "vanilla:explosives",
  name: "Explosives",
  version: "0.1.0",
  author: "lfg",
  description: "Explosion service, TNT priming and chain reactions.",
  setup(api) {
    const { reg, table, world } = api;
    const tntId = reg.blockId("tnt");
    const breakBlock = () => api.use<(x: number, y: number, z: number, drops: boolean) => boolean>("breakBlock");

    const prime = (x: number, y: number, z: number, fuse: number) => {
      world.setBlock(x, y, z, 0);
      const e = api.spawnEntity("tnt", x + 0.5, y, z + 0.5);
      e.data.fuse = fuse;
      e.data.block = tntId;
      e.flags |= 4;
      e.body.vy = 2;
    };

    const explode: ExplodeFn = (x, y, z, power, cause) => {
      const r = power;
      api.sendNear(x, y, z, 128, { t: "explosion", x, y, z, radius: r });
      const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
      const ri = Math.ceil(r);
      for (let dy = -ri; dy <= ri; dy++)
        for (let dz = -ri; dz <= ri; dz++)
          for (let dx = -ri; dx <= ri; dx++) {
            const d = Math.hypot(dx, dy, dz);
            // Slightly ragged edge so craters look natural.
            if (d > r - api.rand() * 1.2) continue;
            const px = bx + dx, py = by + dy, pz = bz + dz;
            const id = world.getBlock(px, py, pz);
            if (id === 0) continue;
            const def = reg.blockById(id);
            if (def.hardness < 0 || def.liquid || def.hardness > 10) continue;
            if (id === tntId) { prime(px, py, pz, 0.5 + api.rand()); continue; }
            const drop = api.rand() < 0.3;
            const b = breakBlock();
            if (b) b(px, py, pz, drop);
            else world.setBlock(px, py, pz, 0);
          }
      // Damage falls off with distance. Explosions are telegraphed (fuse ≥ 1.5 s), so they may exceed the
      // per-hit cap, but never more than 60% of max health from one blast.
      const maxDamage = 60;
      for (const e of api.entities.near(x, y, z, r * 2)) {
        if (e.type.kind === "item" || e.type.name === "tnt") continue;
        const d = Math.sqrt(e.distanceSq(x, y, z));
        const f = 1 - d / (r * 2);
        if (f <= 0) continue;
        api.damage(e, Math.round(maxDamage * f), { kind: "explosion", attacker: cause });
        api.knockback(e, x, z, 10 * f);
      }
    };
    api.provide("explode", explode);

    api.on("intent:useBlock", (e) => {
      if (e.block !== tntId) return;
      const held = e.player.heldStack ? reg.itemById(e.player.heldStack.item) : undefined;
      if (!held?.tags.includes("igniter")) return;
      prime(e.x, e.y, e.z, 4);
      e.player.damageHeldTool();
      e.handled = true;
      api.log(`${e.player.name} lit TNT at ${e.x} ${e.y} ${e.z}`);
    });

    api.on("tick", ({ dt }) => {
      for (const e of api.entities.all.values()) {
        if (e.type.name !== "tnt") continue;
        stepBody(world.store, table, e.body, dt, { gravity: api.std.balance.player.gravity });
        e.body.vx *= 0.9; e.body.vz *= 0.9;
        e.data.fuse = (e.data.fuse as number) - dt;
        if ((e.data.fuse as number) <= 0) {
          api.entities.remove(e);
          explode(e.x, e.y + 0.5, e.z, 4, e);
        }
      }
    });
  },
};
