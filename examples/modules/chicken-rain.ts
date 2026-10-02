import type { ServerModule } from "../../packages/server/src/kernel";

/**
 * Example world module: every 20 seconds, a few chickens fall from the sky
 * around each player. Harmless, a bit silly, easy to see arrive and leave.
 *
 * Try it: /module install chicken-rain   ·   remove: /module remove example:chicken-rain
 */
const chickenRain: ServerModule = {
  id: "example:chicken-rain",
  name: "Chicken rain",
  version: "1.0.0",
  author: "example",
  description: "Chickens fall from the sky every 20 seconds.",
  setup(api) {
    api.every(20, () => {
      for (const p of api.players()) {
        if (p.dead) continue;
        for (let i = 0; i < 4; i++) {
          const a = api.rand() * Math.PI * 2;
          const r = 4 + api.rand() * 8;
          const c = api.spawnEntity("chicken", p.entity.x + Math.cos(a) * r, p.entity.y + 18 + api.rand() * 6, p.entity.z + Math.sin(a) * r);
          c.yaw = api.rand() * Math.PI * 2;
        }
      }
    });
    // Chickens flap: no fall damage for them while this module is around.
    api.on("entity:damage", (e) => {
      if (e.entity.type.name === "chicken" && e.source.kind === "fall") e.cancelled = true;
    });
  },
};

export default chickenRain;
