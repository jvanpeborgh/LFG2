import {
  SPELLS, SPEED_BONUS, castCost, levelForTier, looksLikePower, planPower, rayBox, raycast, scalePowerToTier, tierForLevel,
  type BuffHud, type PowerSpec, type SpellId,
} from "@lfg/shared";
import type { Entity } from "../../entities";
import type { ServerModule } from "../../kernel";
import type { Player } from "../../player";
import type { CastContext, Caster, ProgressionService } from "./progression";

interface Active {
  power: PowerSpec;
  until: number;
  cooldowns: Map<SpellId, number>;
}

const EYE = 1.62;
const DAY = 24 * 3600 * 1000;

/**
 * Powers on yourself, as timed buffs (docs/standards/progression-and-power.md §6):
 * swiftness, night vision, water breathing (tier 2), wings and single spells
 * (tier 3), a wizard's spell book (tier 4: fire bolt R, blink F, frost nova G),
 * an avatar form (tier 5, once a day). Buffed players glow in the magic colour
 * for everyone; spells respect PvP settings and the crowd-control limits.
 */
export const powers: ServerModule = {
  id: "vanilla:powers",
  name: "Powers",
  version: "0.1.0",
  author: "lfg",
  description: "Timed powers: wizard spells, wings, swiftness, night vision, water breathing, avatar forms.",
  setup(api) {
    const { std, table, world } = api;
    const active = new Map<Player, Active>();

    const apply = (p: Player) => {
      const a = active.get(p);
      const has = (e: string) => !!a?.power.effects.includes(e as never);
      const couldFly = p.canFly;
      p.canFly = has("flight");
      p.speedMul = has("speed") ? 1 + SPEED_BONUS : 1;
      p.waterBreathing = has("water_breathing");
      // Flight ending mid-air never kills: a grace period with no fall damage.
      if (couldFly && !p.canFly) p.noFallUntil = Date.now() + 10_000;
      p.entity.flags = a ? p.entity.flags | 16 : p.entity.flags & ~16; // the aura everyone sees
      p.entity.data.giant = has("giant");
    };

    const hud = (p: Player): BuffHud[] => {
      const a = active.get(p);
      if (!a) return [];
      const now = Date.now();
      return [{
        id: a.power.id, name: a.power.name, secondsLeft: Math.max(0, Math.ceil((a.until - now) / 1000)), effects: a.power.effects,
        spells: a.power.spells.map((id) => ({ id, name: SPELLS[id].name, key: SPELLS[id].key, cooldown: SPELLS[id].cooldown, cooldownLeft: Math.max(0, ((a.cooldowns.get(id) ?? 0) - now) / 1000) })),
      }];
    };
    const send = (p: Player) => p.send({ t: "buffs", buffs: hud(p) });

    const end = (p: Player, why: string) => {
      const a = active.get(p);
      if (!a) return;
      active.delete(p);
      apply(p);
      send(p);
      api.tell(p, `✦ ${a.power.name} ${why}`);
    };

    api.every(1, () => {
      const now = Date.now();
      for (const [p, a] of active) {
        if (!api.players().includes(p)) { active.delete(p); continue; }
        if (now >= a.until) end(p, "wears off");
        else send(p);
      }
    });
    api.on("player:leave", ({ player }) => active.delete(player));
    api.on("player:respawn", ({ player }) => end(player, "fades as you respawn"));

    /** Cast a power on `p` (rituals don't apply: powers are personal). */
    const cast = (p: Player, text: string, ctx: CastContext): string => {
      const planned = planPower(text, std);
      if (!planned) return `I don't know the power "${text}" yet`;
      const prog = api.use<ProgressionService>("progression");
      const allowed = prog ? tierForLevel(ctx.level ?? prog.level(p), std) : 5;
      let power = planned;
      const notes: string[] = [];
      if (planned.tier > allowed) {
        const scaled = scalePowerToTier(planned, allowed, std);
        const need = `the power of ${planned.name.toLowerCase()} is tier ${planned.tier}: it needs level ${levelForTier(planned.tier, std)}`;
        if (!scaled) return `Can't: ${need}`;
        notes.push(need);
        power = scaled;
      }
      if (power.oncePerDay) {
        const last = Number(p.data.avatarAt ?? 0);
        if (Date.now() - last < DAY) return `You can take an avatar form once a day (again in ${Math.ceil((DAY - (Date.now() - last)) / 3600000)} h)`;
      }
      const refund = prog ? prog.pay(ctx.payers ?? [p], power.tier) : () => {};
      if (typeof refund === "string") return `Can't: ${refund}`;
      if (power.oncePerDay) p.data.avatarAt = Date.now();
      // One power at a time: a new one replaces the old.
      active.set(p, { power, until: Date.now() + power.minutes * 60_000, cooldowns: new Map() });
      apply(p);
      send(p);
      api.broadcast(`✦ ${p.name} takes on the power of ${power.name === "Avatar" ? "an avatar" : power.name.toLowerCase()} (${power.minutes} min)`, "event");
      const cost = castCost(power.tier, std);
      const how = [
        ...power.spells.map((s) => `${SPELLS[s].key}: ${SPELLS[s].name.toLowerCase()}`),
        ...(power.effects.includes("flight") ? ["double-tap Space to fly"] : []),
      ];
      return [`${power.name} for ${power.minutes} min (tier ${power.tier}: ${cost.aether} aether${cost.shards ? ` + ${cost.shards} shards` : ""})${how.length ? ` · ${how.join(" · ")}` : ""}`, ...notes].join("\n");
    };
    api.provide("caster:powers", {
      plan: (_p, text) => {
        if (!looksLikePower(text)) return null;
        const pw = planPower(text, std);
        return pw ? { tier: pw.tier, title: `the power of ${pw.name.toLowerCase()}` } : null;
      },
      cast,
      preview: (_p, text, level) => {
        const pw = planPower(text, std);
        const s = pw && scalePowerToTier(pw, tierForLevel(level, std), std);
        return s ? { tier: s.tier, title: `the power of ${s.name.toLowerCase()}` } : null;
      },
    } satisfies Caster);

    // ---------------------------------------------------------------- spells
    const look = (p: Player) => {
      const { yaw, pitch } = p.entity;
      return [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)] as const;
    };
    const fx = (spell: SpellId, from: [number, number, number], to: [number, number, number]) =>
      api.sendNear(from[0], from[1], from[2], 64, { t: "spellFx", spell, from, to });
    const canHurt = (p: Player, target: Entity) => {
      if (target === p.entity || target.type.kind === "item" || target.type.kind === "object" || target.removed) return false;
      const victim = api.playerOf(target);
      return !victim || !!api.use<{ pvp(): boolean }>("combat")?.pvp();
    };

    api.on("intent:cast", ({ player: p, spell }) => {
      const a = active.get(p);
      const id = spell as SpellId;
      if (!a || !a.power.spells.includes(id)) return;
      const now = Date.now();
      if ((a.cooldowns.get(id) ?? 0) > now) return;
      const def = SPELLS[id];
      a.cooldowns.set(id, now + def.cooldown * 1000);
      const b = p.entity.body;
      const eye: [number, number, number] = [b.x, b.y + EYE, b.z];
      const [dx, dy, dz] = look(p);

      if (id === "fire_bolt") {
        // Straight line, first thing in the way (blocks stop it).
        const wall = raycast(world.store, eye[0], eye[1], eye[2], dx, dy, dz, def.range, (bid) => table.solid[bid] === 1);
        let reach = wall ? wall.distance : def.range;
        let hit: Entity | null = null;
        for (const e of api.entities.all.values()) {
          if (!canHurt(p, e) || e.distanceSq(eye[0], eye[1], eye[2]) > (def.range + 3) ** 2) continue;
          const hw = e.type.width / 2;
          const t = rayBox(eye[0], eye[1], eye[2], dx, dy, dz, e.x - hw, e.y, e.z - hw, e.x + hw, e.y + e.type.height, e.z + hw);
          if (t !== null && t >= 0 && t < reach) { reach = t; hit = e; }
        }
        const to: [number, number, number] = [eye[0] + dx * reach, eye[1] + dy * reach, eye[2] + dz * reach];
        fx(id, eye, to);
        if (hit && api.damage(hit, def.damage, { kind: "fire", attacker: p.entity })) api.knockback(hit, b.x, b.z, 3);
      } else if (id === "blink") {
        // Up to 8 blocks along your look, stopping before walls, to a spot you fit in.
        const wall = raycast(world.store, eye[0], eye[1], eye[2], dx, dy, dz, def.range, (bid) => table.solid[bid] === 1);
        let d = Math.max(0, (wall ? wall.distance : def.range) - 0.8);
        const fits = (x: number, y: number, z: number) =>
          !table.solid[world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))] && !table.solid[world.getBlock(Math.floor(x), Math.floor(y + 1), Math.floor(z))];
        while (d > 0.5 && !fits(b.x + dx * d, b.y + dy * d, b.z + dz * d)) d -= 0.5;
        if (d <= 0.5) { a.cooldowns.set(id, now + 500); return; }
        const to: [number, number, number] = [b.x + dx * d, b.y + dy * d, b.z + dz * d];
        fx(id, [b.x, b.y + 1, b.z], [to[0], to[1] + 1, to[2]]);
        p.noFallUntil = Math.max(p.noFallUntil, now + 3000);
        api.teleport(p, to[0], to[1], to[2]);
      } else if (id === "frost_nova") {
        // A ring of frost: light damage and a short freeze (≤ 1.5 s, then 3 s immunity: the crowd-control rules).
        fx(id, [b.x, b.y, b.z], [b.x + def.range, b.y, b.z]);
        for (const e of api.entities.all.values()) {
          if (!canHurt(p, e) || Math.hypot(e.x - b.x, e.z - b.z) > def.range || Math.abs(e.y - b.y) > 3) continue;
          api.damage(e, def.damage, { kind: "fire", attacker: p.entity });
          api.knockback(e, b.x, b.z, 2);
          const immune = Number(e.data.ccImmuneUntil ?? 0);
          if (now >= immune) {
            e.data.frozenUntil = now + Math.min(std.balance.crowdControl.maxSeconds, def.stun ?? 0) * 1000;
            e.data.ccImmuneUntil = Number(e.data.frozenUntil) + std.balance.crowdControl.immunitySeconds * 1000;
          }
        }
      }
      send(p);
    });

    api.command({
      name: "powers",
      usage: "/powers [end]",
      help: "Your active power, or end it early",
      admin: false,
      run(p, [arg]) {
        if (!p) return "Players only";
        const a = active.get(p);
        if (!a) return "No active power. Try /summon the power of a wizard (tier 4), wings (tier 3) or swiftness (tier 2)";
        if (arg === "end") { end(p, "ends"); return "Ended"; }
        return `${a.power.name}: ${Math.ceil((a.until - Date.now()) / 1000)} s left`;
      },
    });
  },
};
