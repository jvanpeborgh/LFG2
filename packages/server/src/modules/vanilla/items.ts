import { stepBody, type ItemStack } from "@lfg/shared";
import type { ServerModule } from "../../kernel";

/** Dropped items: physics, merging, pickup, despawn, and the drop (Q) action. */
export const items: ServerModule = {
  id: "vanilla:items",
  name: "Dropped items",
  version: "0.1.0",
  author: "lfg",
  description: "Items fall, merge, get picked up, and despawn after 5 minutes.",
  setup(api) {
    const { reg, table, world } = api;

    api.on("tick", ({ dt }) => {
      for (const e of api.entities.all.values()) {
        if (e.type.kind !== "item") continue;
        const b = e.body;
        stepBody(world.store, table, b, dt, { gravity: 20 });
        const drag = b.onGround ? Math.pow(0.02, dt) : Math.pow(0.6, dt);
        b.vx *= drag; b.vz *= drag;
        if (b.inWater) b.vy = Math.min(b.vy + 30 * dt, 1.5);
        e.data.pickupDelay = Math.max(0, ((e.data.pickupDelay as number) ?? 0) - dt);
        if (e.age > 300 || e.y < -64) { api.entities.remove(e); continue; }
        if ((e.data.pickupDelay as number) > 0) continue;
        const stack = e.data.item as ItemStack;
        for (const p of api.players()) {
          if (p.dead) continue;
          const dx = p.entity.x - e.x, dy = p.entity.y + 0.9 - e.y, dz = p.entity.z - e.z;
          if (dx * dx + dz * dz > 2.25 || Math.abs(dy) > 1.6) continue;
          const left = p.give(stack);
          if (left === 0) { api.entities.remove(e); break; }
          stack.count = left;
        }
      }
    });

    // Merge nearby identical stacks so the world doesn't fill up with entities.
    api.every(1, () => {
      for (const e of api.entities.all.values()) {
        if (e.type.kind !== "item" || e.removed) continue;
        const s = e.data.item as ItemStack;
        const max = reg.itemById(s.item)?.maxStack ?? 64;
        for (const o of api.entities.near(e.x, e.y, e.z, 1.5, (o) => o !== e && o.type.kind === "item")) {
          const os = o.data.item as ItemStack;
          if (os.item !== s.item || os.durability !== s.durability || s.count + os.count > max) continue;
          s.count += os.count;
          api.entities.remove(o);
        }
      }
    });

    api.on("intent:drop", ({ player: p, all }) => {
      const s = p.heldStack;
      if (!s) return;
      const n = all ? s.count : 1;
      const yaw = p.entity.yaw, pitch = p.entity.pitch;
      const dir: [number, number, number] = [-Math.sin(yaw) * Math.cos(pitch) * 6, 2 + Math.sin(-pitch) * 4, -Math.cos(yaw) * Math.cos(pitch) * 6];
      const e = api.spawnItem(p.entity.x, p.entity.y + 1.3, p.entity.z, { ...s, count: n }, dir);
      e.data.pickupDelay = 1.5;
      s.count -= n;
      p.heldStack = s.count > 0 ? s : null;
    });
  },
};
