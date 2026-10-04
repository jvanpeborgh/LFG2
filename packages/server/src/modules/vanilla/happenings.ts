import { HAPPENINGS, happeningValue, isBuiltBlock, planHappening, type HappeningDef, type RuleValue } from "@lfg/shared";
import type { IntentService } from "../../intent";
import type { ServerModule } from "../../kernel";
import type { Player } from "../../player";

/**
 * Happenings: the world's rules changed for a while, for everyone (see shared happenings.ts):
 * low gravity, speed world, trampoline day, ice world, peace day, eternal night or day, the floor
 * is lava. `/happen low gravity for 10 minutes` (or `/event …`, or `/summon low gravity`).
 *
 * It changes things for everyone, so it needs their say: an admin starts one straight away, and
 * so does a player alone in the world; otherwise everyone online votes (/vote yes|no, 20 s).
 * A banner and a HUD timer show what's on. When the time is up (or /happen stop) every rule goes
 * back to what it was, even across a restart.
 */
interface Active { id: string; title: string; by: string; endsAt: number; saved: [string, RuleValue][]; effect?: HappeningDef["effect"] }
interface Rules { get(path: string): RuleValue | undefined; set(path: string, value: RuleValue): void }

const VOTE_SECONDS = 20;
// Words that can sit around a happening's name ("make it low gravity for 5 minutes, please").
const FILLER = new Set(["a", "an", "the", "make", "it", "its", "let", "there", "be", "for", "minute", "minutes", "min", "mins", "please", "world", "day", "time", "now", "everyone", "turn", "on", "start", "with", "some", "of", "is"]);

export const happenings: ServerModule = {
  id: "vanilla:happenings", name: "Happenings", version: "0.1.0", author: "lfg",
  description: "World rules changed for a while: low gravity, ice world, peace day, the floor is lava…",
  setup(api) {
    const rules = () => api.use<Rules>("rules");
    let active = api.storage.load<Active>("happening") ?? null;
    let vote: { def: HappeningDef; minutes: number; by: Player; yes: Set<string>; no: Set<string>; left: number } | null = null;
    const heat = new Map<string, number>();

    const save = () => api.storage.save("happening", active);
    const hud = (p?: Player) => {
      const msg = active
        ? { t: "happening" as const, title: active.title, left: Math.max(0, Math.round((active.endsAt - Date.now()) / 1000)), detail: HAPPENINGS.find((h) => h.id === active!.id)?.description ?? "" }
        : { t: "happening" as const, title: "", left: 0, detail: "" };
      if (p) p.send(msg); else for (const q of api.players()) q.send(msg);
    };

    const end = (why: string) => {
      const a = active;
      if (!a) return;
      const r = rules();
      // Back exactly as it was (in reverse, in case one rule was saved twice).
      if (r) for (const [path, value] of [...a.saved].reverse()) r.set(path, value);
      active = null;
      save();
      heat.clear();
      api.broadcast(`⟲ ${a.title} is over${why ? ` (${why})` : ""}`, "event");
      api.worldEvent({ phase: "undo", title: a.title, by: a.by, detail: "the world's rules are back to normal" });
      hud();
    };

    const begin = (def: HappeningDef, minutes: number, by: string) => {
      const r = rules();
      const saved: [string, RuleValue][] = [];
      for (const [path, v] of def.rules) {
        const before = r?.get(path);
        if (typeof before !== "number") continue;
        saved.push([path, before]);
        r!.set(path, happeningValue(before, v));
      }
      active = { id: def.id, title: def.title, by, endsAt: Date.now() + minutes * 60_000, saved, ...(def.effect ? { effect: def.effect } : {}) };
      save();
      api.worldEvent({ phase: "arrival", title: def.title, by, detail: `${def.description} · ${minutes} min` });
      hud();
    };

    // A happening left running across a restart: its rules are still in place (saved with the
    // world), so carry on until its time is up, or end it now if that's passed.
    if (active && Date.now() >= active.endsAt) end("its time ran out while the world was closed");

    const start = (p: Player, text: string): string => {
      const plan = planHappening(text);
      if (!plan) return `I don't know that one. Try: ${HAPPENINGS.map((h) => h.title.toLowerCase()).join(", ")}`;
      return startDef(p, plan.def, plan.minutes, plan.notes);
    };
    /** Start a happening already planned (one of the catalogue, or one the model made up from the allowed rules). */
    const startDef = (p: Player, def: HappeningDef, minutes: number, notes: string[]): string => {
      const plan = { def, minutes, notes };
      if (!def.rules.length && !def.effect) return "That wouldn't change anything";
      if (active) return `${active.title} is on (${Math.ceil((active.endsAt - Date.now()) / 60000)} min left); /happen stop ends it`;
      if (vote) return `There's a vote on already (${vote.def.title})`;
      const others = api.players().filter((q) => q !== p);
      if (p.admin || others.length === 0) {
        begin(plan.def, plan.minutes, p.name);
        return `${plan.def.title} for ${plan.minutes} min${plan.notes.length ? ` (${plan.notes.join("; ")})` : ""}`;
      }
      vote = { def: plan.def, minutes: plan.minutes, by: p, yes: new Set([p.name]), no: new Set(), left: VOTE_SECONDS };
      api.broadcast(`🗳 ${p.name} wants ${plan.def.title} for ${plan.minutes} min: ${plan.def.description}. /vote yes or /vote no (${VOTE_SECONDS} s)`, "event");
      return "Put to a vote";
    };
    api.provide("happenings", { start, startDef, active: () => active?.title ?? null });

    // As a caster: "/summon low gravity" (only when that's all it asks, so "a fast horse" stays a horse).
    const onlyHappening = (text: string) => {
      const plan = planHappening(text);
      if (!plan) return null;
      const rest = text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean)
        .filter((w) => !FILLER.has(w) && !/^\d+$/.test(w) && !plan.def.words.some((p) => p.split(" ").includes(w)) && !["one", "two", "three", "four", "five", "ten", "fifteen"].includes(w));
      return rest.length ? null : plan;
    };
    api.provide("caster:happenings", {
      plan: (_p: Player, text: string) => { const h = onlyHappening(text); return h ? { tier: 1, title: h.def.title } : null; },
      cast: (p: Player, text: string) => start(p, text),
      preview: (_p: Player, text: string) => { const h = onlyHappening(text); return h ? { tier: 1, title: h.def.title } : null; },
    });

    api.every(1, (dt) => {
      if (vote) vote.left -= dt;
      if (vote && vote.left <= 0) {
        const v = vote;
        vote = null;
        const online = api.players().length;
        if (v.yes.size > v.no.size && v.yes.size * 2 >= online) {
          api.broadcast(`🗳 ${v.def.title}: yes ${v.yes.size}, no ${v.no.size}. It's on!`, "event");
          begin(v.def, v.minutes, v.by.name);
        } else api.broadcast(`🗳 ${v.def.title}: yes ${v.yes.size}, no ${v.no.size}. Not this time.`, "event");
      }
      if (!active) return;
      if (Date.now() >= active.endsAt) { end(""); return; }
      // The sky held at night or day.
      if (active.effect === "night" || active.effect === "day") {
        const { dayLength } = api.time();
        api.setTime((active.effect === "night" ? 0.75 : 0.25) * dayLength);
        for (const q of api.players()) q.send({ t: "time", time: api.time().time, dayLength });
      }
      hud();
    });

    // The floor is lava: standing on natural ground burns after a moment (built blocks are safe).
    api.every(0.5, () => {
      if (active?.effect !== "lava") return;
      for (const p of api.players()) {
        const b = p.entity.body;
        if (p.dead || p.gameMode === "creative" || p.flying || p.riding || !b.onGround || b.inWater) { heat.delete(p.name); continue; }
        const def = api.reg.blockById(api.world.getBlock(Math.floor(b.x), Math.floor(b.y - 0.1), Math.floor(b.z)));
        if (isBuiltBlock(def.name, def.tags)) { heat.delete(p.name); continue; }
        const h = (heat.get(p.name) ?? 0) + 0.5;
        heat.set(p.name, h);
        if (h >= 1.5 && p.entity.health > 8) {
          api.damage(p.entity, 4, { kind: "fire" });
          api.sendNear(b.x, b.y, b.z, 32, { t: "entityEvent", id: p.entity.id, event: "fuse" });
        }
      }
    });

    // Peace day: nothing hurts anyone (falling out of the world still does).
    api.on("entity:damage", (ev) => {
      if (active?.effect === "peace" && ev.source.kind !== "void" && ev.source.kind !== "command") ev.cancelled = true;
    }, -100);

    api.on("player:join", ({ player }) => hud(player));

    api.command({
      name: "happen",
      usage: "/happen <what> [for N minutes] | /happen stop | /happen list",
      help: "Change the world's rules for a while (low gravity, ice world, peace day, the floor is lava…)",
      admin: false,
      run(p, args) {
        const text = args.join(" ").trim();
        if (!text || text === "list") return HAPPENINGS.map((h) => `${h.title}: ${h.description} (${h.minutes} min)`).join("\n") + (active ? `\nNow: ${active.title}` : "");
        if (text === "stop") {
          if (!active) return "Nothing's happening";
          if (p && !p.admin && p.name !== active.by) return "Only whoever started it (or an admin) can stop it";
          end(`called off by ${p?.name ?? "the console"}`);
          return "Stopped";
        }
        if (!p) return "Players only";
        const intent = api.use<IntentService>("intent");
        if (intent) { intent.handle(p, text, "/happen (a change to the world's rules)", () => start(p, text)); return "✧ …"; }
        return start(p, text);
      },
    });
    api.command({
      name: "vote",
      usage: "/vote yes|no",
      help: "Vote on a happening someone proposed",
      admin: false,
      run(p, [choice]) {
        if (!p) return "Players only";
        if (!vote) return "Nothing to vote on";
        const yes = /^(y|yes|aye|ok|sure)$/i.test(choice ?? ""), no = /^(n|no|nay)$/i.test(choice ?? "");
        if (!yes && !no) return "/vote yes or /vote no";
        vote.yes.delete(p.name); vote.no.delete(p.name);
        (yes ? vote.yes : vote.no).add(p.name);
        return `Voted ${yes ? "yes" : "no"} (yes ${vote.yes.size}, no ${vote.no.size})`;
      },
    });
  },
};
