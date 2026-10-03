import { meleeDamage } from "@lfg/shared";
import type { ServerModule } from "../../kernel";

/**
 * Melee combat: damage from the held item, knockback, tool wear and an attack
 * cooldown. Player-vs-player is off by default (standards: PvP is opt-in);
 * an admin can toggle it with /pvp.
 */
export const combat: ServerModule = {
  id: "vanilla:combat",
  name: "Combat",
  version: "0.1.0",
  author: "lfg",
  description: "Melee damage, knockback, attack cooldown, opt-in PvP.",
  setup(api) {
    const { reg } = api;
    const lastAttack = new Map<number, number>();
    // Kept in the world's meta, so it's saved and a world's setup can set it.
    const pvpOn = () => !!api.world.store.meta.pvp;
    api.provide("combat", { pvp: pvpOn });

    api.on("intent:attack", ({ player: p, target }) => {
      const now = performance.now();
      if (now - (lastAttack.get(p.entity.id) ?? 0) < 350) return;
      lastAttack.set(p.entity.id, now);
      if (target.type.kind === "item" || target.type.kind === "object") return;
      const victim = api.playerOf(target);
      if (victim && !pvpOn()) return;
      const held = p.heldStack ? reg.itemById(p.heldStack.item) : undefined;
      let dmg = meleeDamage(held);
      // Falling hit (jump attack) deals 50% more, like Minecraft's critical hit.
      if (!p.entity.body.onGround && !p.flying && p.entity.body.vy <= 0) dmg = Math.round(dmg * 1.5);
      api.sendNear(p.entity.x, p.entity.y, p.entity.z, 48, { t: "entityEvent", id: p.entity.id, event: "swing" });
      if (api.damage(target, dmg, { kind: "melee", attacker: p.entity })) {
        api.knockback(target, p.entity.x, p.entity.z, p.sprinting ? 7 : 4.5);
        if (held?.tool) {
          p.damageHeldTool();
          if (held.tool.type !== "sword") p.damageHeldTool();
        }
        p.exhaustion += 0.1;
      }
    });

    api.on("player:leave", ({ player }) => lastAttack.delete(player.entity.id));

    api.command({
      name: "pvp",
      usage: "/pvp on|off",
      help: "Allow or forbid players hurting each other",
      admin: true,
      run(_p, [arg]) {
        if (arg !== "on" && arg !== "off") return `PvP is ${pvpOn() ? "on" : "off"}`;
        const pvp = arg === "on";
        api.world.store.meta.pvp = pvp;
        api.worldEvent({ phase: "arrival", title: pvp ? "PvP enabled" : "PvP disabled", by: "host" });
      },
    });
  },
};
