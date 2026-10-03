import { EYE_HEIGHT } from "@lfg/shared";
import type { ServerModule } from "../../kernel";

/**
 * Survival rules: hunger and exhaustion, natural regeneration, starvation,
 * fall damage, drowning, cactus, eating, and dropping your items on death.
 * Numbers come from the world standards (docs/standards/defaults.json).
 */
export const survival: ServerModule = {
  id: "vanilla:survival",
  name: "Survival",
  version: "0.1.0",
  author: "lfg",
  description: "Health, hunger, fall damage, drowning, eating, death drops.",
  setup(api) {
    const { reg, world, table } = api;
    const bal = api.std.balance.player;
    const cactusId = reg.blockId("cactus");

    api.on("player:moved", ({ player: p, onGround, inWater, fromY }) => {
      if (p.gameMode === "creative" || p.dead) { p.fallStartY = null; return; }
      const b = p.entity.body;
      // Exhaustion from moving (sprinting costs much more).
      const moved = Math.abs(b.y - fromY);
      p.exhaustion += p.sprinting ? 0.02 : 0.004;
      if (!onGround && b.y > fromY && moved > 0.3) p.exhaustion += p.sprinting ? 0.2 : 0.05; // jump
      if (inWater || p.flying || Date.now() < p.noFallUntil) {
        p.fallStartY = null;
        return;
      }
      if (!onGround) {
        p.fallStartY = Math.max(p.fallStartY ?? b.y, b.y);
      } else if (p.fallStartY !== null) {
        const dist = p.fallStartY - b.y;
        p.fallStartY = null;
        const over = Math.floor(dist - bal.fallDamageAfterBlocks + 0.2);
        if (over > 0) api.damage(p.entity, over * 5, { kind: "fall" });
      }
    });

    api.every(0.5, () => {
      for (const p of api.players()) {
        if (p.dead || p.gameMode === "creative") continue;
        const e = p.entity;
        // Hunger from exhaustion.
        while (p.exhaustion >= 4) {
          p.exhaustion -= 4;
          if (p.hunger > 0) { p.hunger--; p.selfDirty = true; }
        }
        // Regeneration after a few seconds without damage, if fed.
        if (p.sinceDamage >= bal.regenDelaySeconds && e.health < p.maxHealth && p.hunger >= 6) {
          api.heal(e, bal.regenPerSecond * 0.5);
          p.exhaustion += 0.4;
        }
        // Cactus hurts.
        const b = e.body, hw = b.width / 2 + 0.05;
        let touchingCactus = false;
        for (const [ox, oz] of [[-hw, 0], [hw, 0], [0, -hw], [0, hw], [0, 0]])
          for (const oy of [0.1, 1]) if (world.getBlock(Math.floor(b.x + ox), Math.floor(b.y + oy), Math.floor(b.z + oz)) === cactusId) touchingCactus = true;
        if (touchingCactus) api.damage(e, 5, { kind: "cactus" });
      }
    });

    api.every(1, () => {
      for (const p of api.players()) {
        if (p.dead || p.gameMode === "creative") continue;
        const b = p.entity.body;
        // Drowning: 10 s of air, then damage every second.
        const head = world.getBlock(Math.floor(b.x), Math.floor(b.y + EYE_HEIGHT), Math.floor(b.z));
        if (table.liquid[head] && !p.waterBreathing) {
          p.airSupply -= 1;
          if (p.airSupply < 0) { p.airSupply = 0; api.damage(p.entity, 10, { kind: "drown" }); }
        } else p.airSupply = 10;
      }
    });

    api.every(4, () => {
      for (const p of api.players()) if (!p.dead && p.gameMode !== "creative" && p.hunger <= 0) api.damage(p.entity, 5, { kind: "starve" });
    });

    api.on("intent:useItem", (e) => {
      const p = e.player;
      const held = p.heldStack;
      const def = held ? reg.itemById(held.item) : undefined;
      if (!def?.food || p.hunger >= 20) return;
      p.hunger = Math.min(20, p.hunger + def.food);
      p.consumeHeld();
      p.selfDirty = true;
      api.sendNear(p.entity.x, p.entity.y, p.entity.z, 32, { t: "entityEvent", id: p.entity.id, event: "eat" });
      e.handled = true;
    });

    api.on("entity:death", ({ entity }) => {
      const p = api.playerOf(entity);
      if (!p || p.gameMode === "creative") return;
      const all = [...p.hotbar, ...p.main];
      p.hotbar.fill(null);
      p.main.fill(null);
      for (const s of all) if (s) api.spawnItem(entity.x, entity.y + 1, entity.z, s, [(api.rand() - 0.5) * 6, 4, (api.rand() - 0.5) * 6]);
      p.selfDirty = true;
    });
  },
};
