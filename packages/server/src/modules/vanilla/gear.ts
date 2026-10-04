import { GEAR_ITEM, PERK_LABEL, armourTotals, makeGear, rollCreatureLoot, salvageValue, summonTier, weaponDamage, type GearKind, type GearMeta, type GearSlot, type ItemStack, type PerkId } from "@lfg/shared";
import type { Entity } from "../../entities";
import type { ServerModule } from "../../kernel";
import type { Player } from "../../player";
import type { ProgressionService } from "./progression";
import type { SummonService } from "./summons";

/**
 * Creature gear (docs/CREATURE-LOOT.md): what you defeat drops gear made from it, which you wear.
 *
 * - Drops: when a summoned creature falls to a player, it may leave a piece (loot.ts decides).
 * - Wearing: right-click with a piece in hand puts it on (what you wore goes to your hand);
 *   /gear lists what you wear; /gear off <slot> takes it off. Saved with the player.
 * - Armour blocks a share of most hits; perks resist elements, soften falls, let you breathe
 *   underwater, see at night, run faster. Weapons hit as hard as they say, and their element bites.
 * - Sets: pieces from the same creature worn together add up (2, 3 and 4-piece bonuses).
 * - Salvage: /salvage breaks the piece in your hand down into aether.
 * - Everyone sees what you wear (colours on your model).
 */
export interface GearService {
  onHit(p: Player, target: Entity): void;
  worn(p: Player): Partial<Record<WornSlot, ItemStack>>;
  /** How hard the held creature weapon hits, with set bonuses (undefined: not holding one). */
  weaponDamage(p: Player): number | undefined;
}
type WornSlot = Exclude<GearSlot, "weapon">;
const SLOTS: WornSlot[] = ["head", "chest", "legs", "feet", "charm"];

export const gear: ServerModule = {
  id: "vanilla:gear", name: "Gear", version: "0.1.0", author: "lfg",
  description: "Gear made from the creatures you defeat: wear it, fight with it, show it off.",
  setup(api) {
    const { reg } = api;
    const worn = (p: Player): Partial<Record<WornSlot, ItemStack>> => ((p.data.gear ??= {}) as Partial<Record<WornSlot, ItemStack>>);
    const metas = (p: Player) => SLOTS.map((s) => worn(p)[s]?.meta);
    const look = (p: Player) => Object.fromEntries(SLOTS.flatMap((s) => { const m = worn(p)[s]?.meta; return m ? [[s, { kind: m.kind, main: m.colors.main, accent: m.colors.accent, rarity: m.rarity }]] : []; }));
    const wearMsg = (p: Player) => ({ t: "wear" as const, id: p.entity.id, gear: look(p) });

    /** Perks that work as lasting effects (with the powers'), then tell everyone how they look. */
    const refresh = (p: Player) => {
      const { perks } = armourTotals(metas(p));
      p.gearEffects = [...(perks.has("speed") ? ["speed"] : []), ...(perks.has("water_breathing") ? ["water_breathing"] : []), ...(perks.has("night_vision") ? ["night_vision"] : [])];
      api.use<(p: Player) => void>("powers:refresh")?.(p);
      for (const q of api.players()) q.send(wearMsg(p));
    };

    api.on("player:join", ({ player }) => {
      refresh(player);
      for (const q of api.players()) if (q !== player && Object.keys(look(q)).length) player.send(wearMsg(q));
    });

    // Put it on: right-click with a piece of armour or a charm in hand.
    api.on("intent:useItem", (e) => {
      const p = e.player, held = p.heldStack;
      const m = held?.meta;
      if (e.handled || !held || !m || m.slot === "weapon") return;
      e.handled = true;
      const slot = m.slot as WornSlot;
      const before = worn(p)[slot] ?? null;
      worn(p)[slot] = held;
      p.heldStack = before;
      p.selfDirty = true;
      const setsBefore = armourTotals(metas(p).map((x, i) => (SLOTS[i] === slot ? before?.meta : x))).sets;
      api.tell(p, `You put on ${m.name} (${slot})${before?.meta ? `; ${before.meta.name} is in your hand` : ""}`);
      // A set bonus newly earned.
      for (const s of armourTotals(metas(p)).sets) {
        const had = setsBefore.find((x) => x.key === s.key)?.bonuses.length ?? 0;
        if (s.bonuses.length > had) api.tell(p, `✦ ${s.creature} set (${s.pieces} pieces): ${s.bonuses.slice(had).join("; ")}`);
      }
      refresh(p);
    }, -5);

    // Armour blocks a share of hits; perks resist their element and soften falls.
    api.on("entity:damage", (ev) => {
      const p = api.playerOf(ev.entity);
      if (!p || ev.cancelled) return;
      const { block, perks } = armourTotals(metas(p));
      const k = ev.source.kind;
      if (k === "void" || k === "command" || k === "starve" || k === "drown") return;
      let amount = ev.amount;
      if (k === "melee" || k === "explosion" || k === "cactus" || k === "fire") amount *= 1 - block;
      if (k === "fire" && perks.has("fire_resist")) amount *= 0.3;
      if (k === "fall" && perks.has("feather_fall")) amount *= 0.35;
      ev.amount = Math.max(k === "fall" && amount < 1 ? 0 : 1, Math.round(amount));
      if (ev.amount === 0) ev.cancelled = true;
    }, 50);

    // The weapon's element: burning, venom and shocks hurt a little more over the next moments;
    // a chill holds the target still for a beat.
    const onHit = (p: Player, target: Entity) => {
      const m = p.heldStack?.meta;
      if (!m || m.slot !== "weapon") return;
      const burst = (color: string) => api.sendNear(target.x, target.y, target.z, 32, { t: "particles", x: target.x - 0.5, y: target.y + target.type.height * 0.6, z: target.z - 0.5, color, count: 10 });
      if (m.perks.includes("burning") || m.perks.includes("venom")) {
        const fire = m.perks.includes("burning");
        burst(fire ? "#ff7a2a" : "#6bd84a");
        let n = 0;
        const tick = setInterval(() => {
          if (++n > 3 || target.removed) { clearInterval(tick); return; }
          api.damage(target, fire ? 3 : 2, { kind: "fire" });
        }, 600);
      }
      if (m.perks.includes("chilling")) { target.data.frozenUntil = Date.now() + 700; burst("#a8e0ff"); }
      if (m.perks.includes("shocking")) { api.damage(target, 4, { kind: "fire" }); burst("#fff27a"); }
    };
    const maxHit = () => Math.round(api.std.balance.player.health * api.std.balance.damage.maxHitShareOfHealth);
    const heldWeaponDamage = (p: Player) => {
      const m = p.heldStack?.meta;
      return m?.slot === "weapon" ? weaponDamage(m, metas(p), maxHit()) : undefined;
    };
    api.provide("gear", { onHit, worn, weaponDamage: heldWeaponDamage } satisfies GearService);

    // Loot: a summoned creature that falls to a player may leave gear made from it.
    api.on("entity:death", ({ entity, source }) => {
      const killer = source.attacker ? api.playerOf(source.attacker) : undefined;
      if (!killer) return;
      const info = api.use<SummonService>("summons")?.info(entity.id);
      if (!info) return;
      const level = api.use<ProgressionService>("progression")?.level(killer) ?? 1;
      const { time, dayLength } = api.time();
      const drops = rollCreatureLoot(info.spec, {
        tier: summonTier(info.spec).tier, playerLevel: level, rand: api.rand,
        summoner: info.owner ? undefined : info.by, slayer: killer.name, day: Math.floor(time / dayLength) + 1,
        palette: api.std.art.palette as Record<string, string>,
        maxHit: Math.round(api.std.balance.player.health * api.std.balance.damage.maxHitShareOfHealth),
      });
      for (const d of drops) {
        const stack: ItemStack = { ...reg.stack(d.item, 1), meta: d.meta };
        api.spawnItem(entity.x, entity.y + 0.5, entity.z, stack, [0, 4, 0]);
        api.broadcast(`✦ ${killer.name} found ${d.meta.name} (${d.meta.rarity}) from ${info.spec.name}`, "event");
      }
    }, -20);

    const describe = (m: GearMeta) => [
      `${m.name} · ${m.rarity} · level ${m.level}`,
      ...(m.defense ? [`defence ${m.defense}`] : []), ...(m.damage ? [`damage ${m.damage}`] : []),
      ...(m.perks.length ? [m.perks.map((k: PerkId) => PERK_LABEL[k]).join(", ")] : []),
      ...m.lore.map((l) => `"${l}"`),
    ].join(" — ");
    api.command({
      name: "gear",
      usage: "/gear | /gear off <head|chest|legs|feet|charm>",
      help: "What you wear (made from creatures you defeated), or take something off",
      admin: false,
      run(p, [sub, slot]) {
        if (!p) return "Players only";
        if (sub === "off") {
          if (!SLOTS.includes(slot as WornSlot)) return `/gear off ${SLOTS.join("|")}`;
          const s = worn(p)[slot as WornSlot];
          if (!s) return `Nothing on your ${slot}`;
          delete worn(p)[slot as WornSlot];
          const left = p.give(s);
          if (left) api.spawnItem(p.entity.x, p.entity.y + 1, p.entity.z, s);
          refresh(p);
          return `Took off ${s.meta?.name ?? "it"}`;
        }
        const lines = SLOTS.flatMap((s) => { const m = worn(p)[s]?.meta; return m ? [`${s}: ${describe(m)}`] : []; });
        const t = armourTotals(metas(p));
        const sets = t.sets.map((s) => `${s.creature} set (${s.pieces} pieces): ${s.bonuses.join("; ")}`);
        return lines.length ? [...lines, ...sets, `Blocks ${Math.round(t.block * 100)}% of hits`].join("\n") : "You're not wearing any creature gear. Defeat creatures to find some.";
      },
    });
    // Salvage: the creature gear in your hand, broken down into aether.
    api.command({
      name: "salvage",
      usage: "/salvage",
      help: "Break the creature gear in your hand down into aether (more for rarer, higher-level pieces)",
      admin: false,
      run(p) {
        if (!p) return "Players only";
        const held = p.heldStack, m = held?.meta;
        if (!held || !m) return "Hold a piece of creature gear to salvage it";
        const prog = api.use<ProgressionService>("progression");
        if (!prog) return "Nothing to salvage into here";
        const value = salvageValue(m);
        const got = prog.grant(p, value, `salvaged ${m.name}`);
        if (got <= 0) return "Your aether is full: spend some first";
        p.heldStack = null;
        p.selfDirty = true;
        api.sendNear(p.entity.x, p.entity.y, p.entity.z, 32, { t: "particles", x: p.entity.x - 0.5, y: p.entity.y + 1.2, z: p.entity.z - 0.5, color: "#b98cff", count: 14 });
        return `${m.name} breaks down into ${Math.round(got)} aether${got < value ? ` (your aether is full; ${value - Math.round(got)} lost)` : ""}`;
      },
    });
    // For tools and tests: /loot <creature> makes a piece from a creature without a fight (admins).
    api.command({
      name: "loot", usage: "/loot <creature words> [kind]", help: "Make a piece of gear from a creature (testing)", admin: true,
      run(p, args) {
        if (!p) return "Players only";
        const kinds = Object.keys(GEAR_ITEM);
        const kind = kinds.includes(args[args.length - 1]) ? args.pop() : undefined;
        const spec = api.use<SummonService>("summons")?.plan(args.join(" ")).spec;
        if (!spec) return "What creature?";
        const level = api.use<ProgressionService>("progression")?.level(p) ?? 1;
        const ctx = { tier: summonTier(spec).tier, playerLevel: level, rand: api.rand, summoner: p.name, slayer: p.name, palette: api.std.art.palette as Record<string, string>, maxHit: Math.round(api.std.balance.player.health * api.std.balance.damage.maxHitShareOfHealth) };
        const drops = kind ? [makeGear(spec, kind as GearKind, ctx)] : rollCreatureLoot({ ...spec, role: "boss" }, ctx);
        for (const d of drops) p.give({ ...reg.stack(d.item, 1), meta: d.meta });
        return drops.length ? drops.map((d) => `${d.meta.name} (${d.meta.rarity})`).join(", ") : `${spec.name} has nothing to give`;
      },
    });
  },
};
