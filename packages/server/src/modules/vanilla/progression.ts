import {
  TIER_NAMES, castCost, helpersNeeded, levelForTier, levelFromXp, ritualLevel, tierForLevel, xpForLevel,
  type ProgressHud, type RitualHud,
} from "@lfg/shared";
import type { ServerModule } from "../../kernel";
import type { Player } from "../../player";

/** What a player's progression looks like when saved (in player.data.progress). */
interface Progress {
  xp: number;
  aether: number;
  shards: number;
  lastSeen: number;
  /** Normal-play XP this minute (capped). */
  play: { minute: number; xp: number };
  /** XP earned per creation today (capped). */
  creations: Record<string, { day: number; xp: number }>;
}

/** Something that can be cast through a ritual (summons, scenarios). */
export interface Caster {
  /** How strong this request is (its tier) and what to call it, or null if it isn't this caster's. */
  plan(p: Player, text: string): { tier: number; title: string } | null;
  /** Cast it. `ctx.level` overrides the caster's level; `ctx.payers` share the cost. */
  cast(p: Player, text: string, ctx: CastContext): string;
  /** What someone at `level` would actually get (scaled down if needed), without casting. */
  preview(p: Player, text: string, level: number): { tier: number; title: string } | null;
}

/** What a request would cost, before anyone spends anything (for /cost, and for tools outside the game). */
export interface CastEstimate {
  /** What kind of thing it is (which caster would make it). */
  kind: "power" | "scenario" | "build" | "summon";
  title: string;
  tier: number;
  level: number;
  levelNeeded: number;
  /** What you'd get at your level (the same as the request if you can cast it). */
  youGet: { title: string; tier: number; aether: number; shards: number; tokenBudget: number } | null;
  full: { aether: number; shards: number; tokenBudget: number };
  /** Helpers a ritual led by you would need for the full version (null: you can't lead it; 0: no ritual needed). */
  ritualHelpers: number | null;
  have: { aether: number; shards: number };
}

export interface CastContext {
  level?: number;
  payers?: Player[];
}

/** The "progression" service other modules use. */
export interface ProgressionService {
  level(p: Player): number;
  tier(p: Player): number;
  /**
   * Pay for a cast at a tier, shared evenly between the payers (aether), shards
   * from whoever has them (the first payer first). Returns a refund function, or
   * why it can't be paid.
   */
  pay(payers: Player[], tier: number): ((share: number) => void) | string;
  award(p: Player, xp: number, reason: string): void;
  awardShards(p: Player, n: number, reason: string): void;
  /** A player engaged with someone's creation: XP for the creator (capped per creation per day). */
  engaged(creator: string, creation: string, player: Player): void;
  /** What casting `text` would cost `p` (or null if nothing knows how to make it). */
  estimate(p: Player, text: string): CastEstimate | null;
  /** Spend aether on something other than a cast (inscribing a scroll). False if there isn't enough. */
  spend(p: Player, aether: number): boolean;
  /** Summary of a player's progress (for the HUD and outside tools). */
  hud(p: Player): ProgressHud;
}

const DAY = 24 * 3600 * 1000;

/**
 * Levels, XP, aether and shards (docs/standards/progression-and-power.md), and
 * rituals: casting above your tier together. XP is weighted to shared moments:
 * normal play gives a little (capped), defending, beating bosses, joining
 * rituals and other people enjoying what you made give most of it.
 */
export const progression: ServerModule = {
  id: "vanilla:progression",
  name: "Progression",
  version: "0.1.0",
  author: "lfg",
  description: "Levels, XP, aether and shards; summoning tiers; rituals.",
  setup(api) {
    const { std } = api;
    const pr = () => std.progression;
    // Casters are found as services, so they work whichever order modules load (or reload) in.
    const CASTERS = [["caster:powers", "power"], ["caster:scenarios", "scenario"], ["caster:builds", "build"], ["caster:summons", "summon"]] as const;
    const kindFor = (p: Player, text: string) => {
      // A saved design is always a summon, whatever words its id has in it.
      if (/^(?:a |an |the )?design[: ]/i.test(text.trim())) { const c = api.use<Caster>("caster:summons"); return c?.plan(p, text) ? { caster: c, kind: "summon" as const } : null; }
      for (const [n, kind] of CASTERS) { const c = api.use<Caster>(n); if (c?.plan(p, text)) return { caster: c, kind }; }
      return null;
    };
    const casterFor = (p: Player, text: string) => kindFor(p, text)?.caster;

    const state = (p: Player): Progress => {
      let s = p.data.progress as Progress | undefined;
      if (!s) {
        s = { xp: 0, aether: pr().aether.max, shards: 0, lastSeen: Date.now(), play: { minute: 0, xp: 0 }, creations: {} };
        p.data.progress = s;
      }
      return s;
    };
    const level = (p: Player) => levelFromXp(state(p).xp, std).level;
    const tier = (p: Player) => tierForLevel(level(p), std);

    const hud = (p: Player): ProgressHud => {
      const s = state(p);
      const l = levelFromXp(s.xp, std);
      const t = tierForLevel(l.level, std);
      return {
        level: l.level, xp: l.into, next: l.next, aether: Math.floor(s.aether), aetherMax: pr().aether.max, shards: s.shards,
        tier: t, nextTierLevel: t < std.locked.progression.tiers ? levelForTier(t + 1, std) : 0,
      };
    };
    const lastSent = new Map<Player, string>();
    const send = (p: Player, force = false) => {
      const h = hud(p);
      const key = JSON.stringify(h);
      if (!force && lastSent.get(p) === key) return;
      lastSent.set(p, key);
      p.send({ t: "progress", progress: h });
    };

    const award = (p: Player, xp: number, reason: string) => {
      if (xp <= 0) return;
      const s = state(p);
      const before = levelFromXp(s.xp, std).level;
      s.xp += Math.round(xp);
      const after = levelFromXp(s.xp, std).level;
      if (after > before) {
        const t0 = tierForLevel(before, std), t1 = tierForLevel(after, std);
        api.broadcast(
          t1 > t0
            ? `⭐ ${p.name} reached level ${after}: ${TIER_NAMES[t1 - 1]} (tier ${t1}) summons unlocked!`
            : `⭐ ${p.name} reached level ${after}`,
          "event",
        );
        api.log(`${p.name} level ${after} (${reason})`);
      }
      send(p);
    };

    const service: ProgressionService = {
      level, tier, award,
      pay(payers, t) {
        const cost = castCost(t, std);
        const share = cost.aether / payers.length;
        const short = payers.filter((q) => state(q).aether + 1e-9 < share);
        if (short.length) {
          return short.length === 1 && payers.length === 1
            ? `not enough aether (${Math.floor(state(short[0]).aether)}/${cost.aether}); it refills ${pr().aether.refillPerMinuteOnline} per minute`
            : `not enough aether: ${short.map((q) => `${q.name} has ${Math.floor(state(q).aether)}`).join(", ")} (each pays ${Math.ceil(share)})`;
        }
        const shardsHave = payers.reduce((n, q) => n + state(q).shards, 0);
        if (shardsHave < cost.shards) return `needs ${cost.shards} aether shard${cost.shards > 1 ? "s" : ""} (${payers.length > 1 ? "together you have" : "you have"} ${shardsHave}); shards come from bosses and scenario rewards`;
        const paidShards = new Map<Player, number>();
        let left = cost.shards;
        for (const q of payers) {
          const take = Math.min(left, state(q).shards);
          state(q).shards -= take;
          paidShards.set(q, take);
          left -= take;
        }
        for (const q of payers) { state(q).aether -= share; send(q); }
        return (frac: number) => {
          for (const q of payers) {
            const s = state(q);
            s.aether = Math.min(pr().aether.max, s.aether + share * frac);
            s.shards += Math.round((paidShards.get(q) ?? 0) * frac);
            send(q);
          }
        };
      },
      awardShards(p, n, reason) {
        if (n <= 0) return;
        state(p).shards += n;
        api.tell(p, `+${n} aether shard${n > 1 ? "s" : ""} (${reason})`);
        send(p);
      },
      hud,
      spend(p, aether) {
        const s = state(p);
        if (s.aether + 1e-9 < aether) return false;
        s.aether -= aether;
        send(p);
        return true;
      },
      estimate(p, text) {
        const found = kindFor(p, text);
        const caster = found?.caster;
        const plan = caster?.plan(p, text);
        if (!found || !caster || !plan) return null;
        const lvl = level(p);
        const budget = (t: number) => pr().tokenBudgetByTier[Math.max(0, Math.min(4, t - 1))];
        const got = caster.preview(p, text, lvl);
        const full = castCost(plan.tier, std);
        return {
          kind: found.kind, title: plan.title, tier: plan.tier, level: lvl, levelNeeded: levelForTier(plan.tier, std),
          youGet: got ? { ...got, ...castCost(got.tier, std), tokenBudget: budget(got.tier) } : null,
          full: { ...full, tokenBudget: budget(plan.tier) },
          ritualHelpers: helpersNeeded(lvl, plan.tier, std),
          have: { aether: Math.floor(state(p).aether), shards: state(p).shards },
        };
      },
      engaged(creator, creation, player) {
        const owner = api.playerByName(creator);
        if (!owner || owner === player) return;
        const s = state(owner);
        const day = Math.floor(Date.now() / DAY);
        const c = s.creations[creation] ?? { day, xp: 0 };
        if (c.day !== day) { c.day = day; c.xp = 0; }
        const gain = Math.min(pr().xp.creationEngagedPlayer, pr().xp.creationMaxPerDay - c.xp);
        if (gain <= 0) return;
        c.xp += gain;
        s.creations[creation] = c;
        // Keep the record small: forget other days.
        for (const [k, v] of Object.entries(s.creations)) if (v.day !== day) delete s.creations[k];
        award(owner, gain, `${player.name} enjoyed your ${creation.split("#")[0]}`);
      },
    };
    api.provide("progression", service);

    // ---------------------------------------------------------------- joining, refilling
    api.on("player:join", ({ player }) => {
      const s = state(player);
      const offlineMin = Math.max(0, (Date.now() - s.lastSeen) / 60000);
      s.aether = Math.min(pr().aether.max, s.aether + offlineMin * pr().aether.refillPerMinuteOffline);
      s.lastSeen = Date.now();
      send(player, true);
    });
    api.on("player:leave", ({ player }) => { state(player).lastSeen = Date.now(); lastSent.delete(player); });
    api.every(1, () => {
      for (const p of api.players()) {
        const s = state(p);
        s.aether = Math.min(pr().aether.max, s.aether + pr().aether.refillPerMinuteOnline / 60);
        s.lastSeen = Date.now();
        send(p);
      }
    });

    // ---------------------------------------------------------------- XP from normal play (capped per minute)
    const play = (p: Player, xp: number) => {
      const s = state(p);
      const minute = Math.floor(Date.now() / 60000);
      if (s.play.minute !== minute) s.play = { minute, xp: 0 };
      const gain = Math.min(xp, pr().xp.playMaxPerMinute - s.play.xp);
      if (gain <= 0) return;
      s.play.xp += gain;
      award(p, gain, "play");
    };
    api.on("block:broken", ({ player }) => { if (player && player.gameMode === "survival") play(player, 1); });
    api.on("entity:death", ({ entity, source }) => {
      const killer = source.attacker ? api.playerOf(source.attacker) : undefined;
      // Killing your own summons doesn't count.
      if (!killer || killer.gameMode !== "survival" || entity.type.kind === "player" || entity.data.summonedBy === killer.name) return;
      play(killer, entity.type.kind === "hostile" ? 3 : 1);
    });

    // ---------------------------------------------------------------- rituals
    interface Ritual {
      id: number;
      caster: Player;
      text: string;
      title: string;
      tier: number;
      needed: number;
      joined: Player[];
      at: [number, number, number];
      left: number;
    }
    const rituals = new Map<number, Ritual>();
    let nextRitual = 1;
    const RADIUS = 4;
    const ritualHud = (r: Ritual, to: Player): RitualHud => ({
      id: r.id, by: r.caster.name, title: r.title, tier: r.tier, at: r.at, radius: RADIUS,
      joined: r.joined.map((q) => q.name), needed: r.needed, secondsLeft: Math.ceil(r.left),
      canJoin: to !== r.caster && !r.joined.includes(to),
    });
    const sendRitual = (r: Ritual, over = false) => {
      for (const q of api.players()) {
        if (Math.hypot(q.entity.x - r.at[0], q.entity.z - r.at[2]) > 48) continue;
        q.send({ t: "ritual", ritual: over ? null : ritualHud(r, q) });
      }
    };
    const finishRitual = (r: Ritual) => { rituals.delete(r.id); sendRitual(r, true); };

    const castRitual = (r: Ritual) => {
      finishRitual(r);
      const caster = casterFor(r.caster, r.text);
      if (!caster) return;
      const payers = [r.caster, ...r.joined];
      const lvl = ritualLevel(payers.map(level), std);
      for (const q of r.joined) award(q, pr().xp.ritualJoin, "joined a ritual");
      api.broadcast(`✦ The ritual is complete: ${payers.map((q) => q.name).join(", ")} summon ${r.title}!`, "event");
      const msg = caster.cast(r.caster, r.text, { level: lvl, payers });
      for (const q of payers) api.tell(q, msg);
    };

    api.every(0.5, () => {
      for (const r of rituals.values()) {
        r.left -= 0.5;
        // Helpers who wander off leave the circle.
        r.joined = r.joined.filter((q) => api.players().includes(q) && Math.hypot(q.entity.x - r.at[0], q.entity.z - r.at[2]) < RADIUS + 6);
        if (!api.players().includes(r.caster)) { finishRitual(r); continue; }
        if (r.left <= 0) {
          finishRitual(r);
          api.tell(r.caster, `The ritual faded: ${r.joined.length}/${r.needed} joined. You cast what you can on your own.`);
          const caster = casterFor(r.caster, r.text);
          if (caster) api.tell(r.caster, caster.cast(r.caster, r.text, {}));
          continue;
        }
        if (r.left % 1 === 0) sendRitual(r);
      }
    });

    api.command({
      name: "ritual",
      usage: "/ritual <what to summon>",
      help: "Summon something above your tier together: others nearby /join the circle",
      admin: false,
      run(p, args) {
        if (!p) return "Players only";
        const text = args.join(" ").trim();
        if (!text) return "Summon what? e.g. /ritual a huge kraken";
        if ([...rituals.values()].some((r) => r.caster === p)) return "You're already leading a ritual";
        const caster = casterFor(p, text);
        const plan = caster?.plan(p, text);
        if (!caster || !plan) return `I don't know how to summon "${text}" yet`;
        const lvl = level(p);
        const mine = tierForLevel(lvl, std);
        if (plan.tier <= mine) return caster.cast(p, text, {});
        if (plan.tier > mine + std.locked.progression.ritualMaxTiersAbove)
          return `${plan.title} is tier ${plan.tier}: a ritual can reach one tier above its leader's, so it needs a leader of level ${levelForTier(plan.tier - std.locked.progression.ritualMaxTiersAbove, std)}+`;
        const needed = Math.ceil((levelForTier(plan.tier, std) - lvl) / pr().ritual.levelsPerHelper);
        const r: Ritual = {
          id: nextRitual++, caster: p, text, title: plan.title, tier: plan.tier, needed, joined: [],
          at: [p.entity.x, p.entity.y, p.entity.z], left: pr().ritual.joinSeconds,
        };
        rituals.set(r.id, r);
        api.broadcast(`✦ ${p.name} begins a ritual to summon ${plan.title} (tier ${plan.tier}). ${needed} helper${needed > 1 ? "s" : ""} needed: stand in the circle and /join (or press J).`, "event");
        sendRitual(r);
        return `Ritual started: ${needed} helper${needed > 1 ? "s" : ""} needed within ${pr().ritual.joinSeconds} s`;
      },
    });

    api.command({
      name: "join",
      usage: "/join",
      help: "Join the ritual circle you're standing in",
      admin: false,
      run(p) {
        if (!p) return "Players only";
        const near = [...rituals.values()]
          .map((r) => ({ r, d: Math.hypot(p.entity.x - r.at[0], p.entity.z - r.at[2]) }))
          .sort((a, b) => a.d - b.d)[0];
        if (!near) return "There's no ritual here to join";
        const r = near.r;
        if (r.caster === p) return "You're leading this ritual";
        if (near.d > RADIUS + 2) return `Stand in ${r.caster.name}'s circle to join (${Math.round(near.d)} blocks away)`;
        if (r.joined.includes(p)) return "You've already joined";
        r.joined.push(p);
        api.broadcast(`✦ ${p.name} joins ${r.caster.name}'s ritual (${r.joined.length}/${r.needed})`, "event");
        if (r.joined.length >= r.needed) castRitual(r);
        else sendRitual(r);
        return "Joined";
      },
    });

    // ---------------------------------------------------------------- info and admin
    const target = (p: Player | null, name?: string) => (name ? api.playerByName(name) : p ?? undefined);
    api.command({
      name: "progress",
      usage: "/progress [player]",
      help: "Your level, XP, aether, shards and what you can summon",
      admin: false,
      run(p, [name]) {
        const t = target(p, name);
        if (!t) return "No such player";
        const h = hud(t);
        return `${t.name}: level ${h.level}${h.next ? ` (${h.xp}/${h.next} XP)` : " (max)"} · aether ${h.aether}/${h.aetherMax} · shards ${h.shards} · ` +
          `can summon up to tier ${h.tier} (${TIER_NAMES[h.tier - 1]})${h.nextTierLevel ? `; tier ${h.tier + 1} at level ${h.nextTierLevel}` : ""}`;
      },
    });
    api.command({
      name: "cost",
      usage: "/cost <what you'd summon>",
      help: "What summoning something would cost you, without casting it",
      admin: false,
      run(p, args) {
        if (!p) return "Players only";
        const text = args.join(" ").trim();
        if (!text) return "Cost of what? e.g. /cost a huge kraken";
        const e = service.estimate(p, text);
        if (!e) return `I don't know how to make "${text}" yet`;
        const price = (c: { aether: number; shards: number; tokenBudget: number }) =>
          `${c.aether} aether${c.shards ? ` + ${c.shards} shard${c.shards > 1 ? "s" : ""}` : ""} (AI budget ${Math.round(c.tokenBudget / 1000)}k tokens)`;
        const lines = [`${e.title}: tier ${e.tier} (${TIER_NAMES[e.tier - 1]}), needs level ${e.levelNeeded}. Full cost: ${price(e.full)}.`];
        if (e.level >= e.levelNeeded) lines.push(`You're level ${e.level}: you can cast it.`);
        else {
          lines.push(e.youGet ? `At level ${e.level} you'd get ${e.youGet.title} (tier ${e.youGet.tier}) for ${price(e.youGet)}.` : `At level ${e.level} you can't cast any version of it.`);
          lines.push(e.ritualHelpers === null ? `A ritual led by you can't reach it (rituals reach one tier above their leader).` : `Or lead a ritual with ${e.ritualHelpers} helper${e.ritualHelpers > 1 ? "s" : ""} (the cost is shared).`);
        }
        const need = e.level >= e.levelNeeded ? castCost(e.tier, std) : e.youGet;
        if (need && (e.have.aether < need.aether || e.have.shards < need.shards))
          lines.push(`You have ${e.have.aether} aether and ${e.have.shards} shards: ${e.have.aether < need.aether ? `aether refills in ~${Math.ceil((need.aether - e.have.aether) / pr().aether.refillPerMinuteOnline)} min` : "you need more shards"}.`);
        return lines.join("\n");
      },
    });

    api.command({
      name: "xp",
      usage: "/xp give <n> [player] | /xp level <n> [player]",
      help: "Give XP or set a level (admin)",
      admin: true,
      run(p, [what, n, name]) {
        const t = target(p, name);
        if (!t) return "No such player";
        const v = Math.max(0, Math.floor(Number(n) || 0));
        if (what === "level") {
          state(t).xp = xpForLevel(Math.min(std.locked.progression.maxLevel, Math.max(1, v)), std);
          send(t, true);
          return `${t.name} is now level ${level(t)}`;
        }
        award(t, v, "admin");
        return `Gave ${v} XP to ${t.name}`;
      },
    });
    api.command({
      name: "aether",
      usage: "/aether fill [player] | /aether shards <n> [player]",
      help: "Refill aether or give shards (admin)",
      admin: true,
      run(p, [what, a, b]) {
        if (what === "shards") {
          const t = target(p, b);
          if (!t) return "No such player";
          state(t).shards += Math.max(0, Math.floor(Number(a) || 0));
          send(t, true);
          return `${t.name} has ${state(t).shards} shards`;
        }
        const t = target(p, a);
        if (!t) return "No such player";
        state(t).aether = pr().aether.max;
        send(t, true);
        return `${t.name}'s aether is full`;
      },
    });
  },
};
