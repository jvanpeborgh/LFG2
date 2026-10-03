import { castCost, fitSpecToRules, planSummon, summonTier, type ScrollHud } from "@lfg/shared";
import type { ServerModule } from "../../kernel";
import type { Player } from "../../player";
import type { Caster, ProgressionService } from "./progression";
import type { SummonService } from "./summons";

interface Scroll {
  name: string;
  prompt: string;
  inscribedAt: string;
}

/** What the spellbook offers other code (the MCP server uses it for players' chats). */
export interface SpellbookService {
  list(p: Player): ScrollHud[];
  /** Check a prompt and inscribe it as a named scroll (costs a share of its casting aether). */
  inscribe(p: Player, name: string, prompt: string): { ok: true; scroll: ScrollHud; paid: number } | { ok: false; error: string };
  remove(p: Player, name: string): boolean;
  /** Cast a scroll where the player is (as any summon: tier, cost, world event). */
  cast(p: Player, name: string): string;
  /** What inscribing a prompt would cost (aether), or why it can't be inscribed. */
  inscribeCost(p: Player, prompt: string): { aether: number } | { error: string };
}

const NAME = /^[a-z0-9][a-z0-9 '-]{0,23}$/i;

/**
 * The spellbook: prompts saved as named scrolls, so players can prepare what
 * they want to cast (in game, or refined in a chat with ChatGPT or Claude and
 * loaded through the MCP server) and cast it in a moment: from the book (K),
 * with /cast <name>, or by saying "cast <name>".
 *
 * Inscribing checks the prompt the way casting will (what it is, its tier, a
 * generated model that passes the art checks) and costs a share of its
 * casting aether, so scrolls are worth preparing but can't be spammed.
 * Casting still pays the full cost and arrives as a normal world event.
 */
export const spellbook: ServerModule = {
  id: "vanilla:spellbook",
  name: "Spellbook",
  version: "0.1.0",
  author: "lfg",
  description: "Named scrolls of prepared prompts: inscribe, list, cast.",
  setup(api) {
    const { std } = api;
    const cfg = () => std.progression.scrolls;
    const scrolls = (p: Player): Scroll[] => ((p.data.spellbook as Scroll[] | undefined) ??= []);
    const prog = () => api.use<ProgressionService>("progression");

    const describe = (p: Player, s: Scroll): ScrollHud => {
      const e = prog()?.estimate(p, s.prompt);
      if (!e) return { name: s.name, prompt: s.prompt, title: "?", kind: "?", tier: 0, aether: 0, shards: 0 };
      const now = e.level >= e.levelNeeded ? { ...castCost(e.tier, std), title: e.title } : e.youGet ? { aether: e.youGet.aether, shards: e.youGet.shards, title: e.youGet.title } : null;
      return {
        name: s.name, prompt: s.prompt, title: e.title, kind: e.kind, tier: e.tier,
        aether: now?.aether ?? e.full.aether, shards: now?.shards ?? e.full.shards,
        ...(now && now.title !== e.title ? { castsAs: now.title } : !now ? { castsAs: `nothing yet (needs level ${e.levelNeeded}, or a ritual)` } : {}),
      };
    };
    const send = (p: Player) => p.send({ t: "spellbook", scrolls: scrolls(p).map((s) => describe(p, s)) });
    api.on("player:join", ({ player }) => send(player));

    /** The same checks a cast will make, before anything is spent. */
    const check = (p: Player, prompt: string): { tier: number; error?: string } => {
      const e = prog()?.estimate(p, prompt);
      if (!e) return { tier: 0, error: `nothing in this world knows how to make "${prompt}" yet` };
      if (e.kind === "summon") {
        const plan = planSummon(prompt);
        if (!plan.spec) return { tier: e.tier, error: plan.notes.join("; ") };
        const tier = summonTier(plan.spec).tier;
        const fitted = fitSpecToRules(plan.spec, std, tier);
        const prep = api.use<SummonService>("summons")?.prepare(fitted.spec, tier);
        if (typeof prep === "string") return { tier, error: `its model doesn't pass the art checks: ${prep}` };
      }
      return { tier: e.tier };
    };
    const costOf = (tier: number) => Math.ceil(castCost(tier, std).aether * cfg().inscribeShareOfCast);

    const service: SpellbookService = {
      list: (p) => scrolls(p).map((s) => describe(p, s)),
      inscribeCost(p, prompt) {
        const c = check(p, prompt);
        return c.error ? { error: c.error } : { aether: costOf(c.tier) };
      },
      inscribe(p, name, prompt) {
        const n = name.trim().toLowerCase();
        const text = prompt.trim().replace(/^\/(summon|event)\s+/i, "");
        if (!NAME.test(n)) return { ok: false, error: "scroll names are 1–24 letters, numbers, spaces or dashes" };
        if (!text || text.length > 300) return { ok: false, error: "the prompt must be 1–300 characters" };
        const list = scrolls(p);
        const existing = list.findIndex((s) => s.name === n);
        if (existing < 0 && list.length >= cfg().maxPerPlayer) return { ok: false, error: `your spellbook is full (${cfg().maxPerPlayer} scrolls); remove one first` };
        const c = check(p, text);
        if (c.error) return { ok: false, error: c.error };
        const paid = costOf(c.tier);
        const pr = prog();
        if (pr && !pr.spend(p, paid)) return { ok: false, error: `inscribing it costs ${paid} aether (a fifth of casting it); you have ${pr.hud(p).aether}` };
        const scroll: Scroll = { name: n, prompt: text, inscribedAt: new Date().toISOString() };
        if (existing >= 0) list[existing] = scroll; else list.push(scroll);
        send(p);
        return { ok: true, scroll: describe(p, scroll), paid };
      },
      remove(p, name) {
        const list = scrolls(p);
        const i = list.findIndex((s) => s.name === name.trim().toLowerCase());
        if (i < 0) return false;
        list.splice(i, 1);
        send(p);
        return true;
      },
      cast(p, name) {
        const n = name.trim().toLowerCase().replace(/^(the |my )?(scroll (of )?)?/, "");
        const s = scrolls(p).find((x) => x.name === n) ?? scrolls(p).find((x) => x.name.startsWith(n));
        if (!s) return `No scroll called "${name}" (you have: ${scrolls(p).map((x) => x.name).join(", ") || "none yet"})`;
        const caster = api.use<Caster>("caster:summons");
        if (!caster) return "Summoning is switched off in this world";
        const reply = caster.cast(p, s.prompt, {});
        send(p);
        return `📜 ${s.name}: ${reply}`;
      },
    };
    api.provide("spellbook", service);
    // Aether changes what a scroll would cast as; keep the book fresh now and then.
    api.every(15, () => { for (const p of api.players()) if (scrolls(p).length) send(p); });

    api.command({
      name: "inscribe",
      usage: "/inscribe <name> = <what to summon>",
      help: "Save a prompt as a named scroll in your spellbook (costs a fifth of casting it)",
      admin: false,
      run(p, args) {
        if (!p) return "Players only";
        const m = args.join(" ").match(/^(.+?)\s*=\s*(.+)$/);
        if (!m) return "Usage: /inscribe kraken storm = a huge kraken";
        const r = service.inscribe(p, m[1], m[2]);
        return r.ok ? `📜 Inscribed "${r.scroll.name}": ${r.scroll.title} (tier ${r.scroll.tier}) for ${r.paid} aether. Cast it with /cast ${r.scroll.name}, from your spellbook (K), or by saying "cast ${r.scroll.name}".` : `Can't inscribe: ${r.error}`;
      },
    });
    api.command({
      name: "cast",
      usage: "/cast <scroll name>",
      help: "Cast a scroll from your spellbook",
      admin: false,
      run(p, args) {
        if (!p) return "Players only";
        return service.cast(p, args.join(" "));
      },
    });
    api.command({
      name: "scrolls",
      usage: "/scrolls [remove <name>]",
      help: "Your spellbook",
      admin: false,
      run(p, [sub, ...rest]) {
        if (!p) return "Players only";
        if (sub === "remove") return service.remove(p, rest.join(" ")) ? "Removed" : "No such scroll";
        const list = service.list(p);
        return list.length ? list.map((s) => `📜 ${s.name}: ${s.title} (tier ${s.tier}) · ${s.aether} aether${s.shards ? ` + ${s.shards} shards` : ""}${s.castsAs ? ` · at your level: ${s.castsAs}` : ""}`).join("\n") : "Your spellbook is empty. /inscribe <name> = <what to summon>, or load scrolls from a chat through the MCP server (/link)";
      },
    });
  },
};
