import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  PALETTE_PRESETS, START_TIMES, TIER_NAMES, buildCatalog, castCost, levelForTier, powerCatalog, scenarioCatalog, summonCatalog,
  type WorldSetup,
} from "@lfg/shared";
import type { Game } from "./game";
import type { WorldHost } from "./host";
import type { Link, LinkRegistry } from "./links";
import type { Player } from "./player";
import type { ProgressionService } from "./modules/vanilla/progression";
import type { SpellbookService } from "./modules/vanilla/spellbook";

/**
 * The game's MCP server (POST/GET/DELETE /mcp, Streamable HTTP), so people can
 * prepare what they summon in a chat with ChatGPT, Claude or any other MCP
 * client: refine prompts there, see what each would cost, inscribe them as
 * scrolls in their spellbook, cast them, check their progress, and create and
 * set up worlds of their own before others join.
 *
 * A chat acts for one player in one world, after the player links it with a
 * one-time code from /link in game. Nothing here gets around the game's rules:
 * scrolls cost aether to inscribe, casting pays the full cost and arrives as a
 * normal world event, and locked world rules stay locked.
 */

const INSTRUCTIONS = `This is LFG2, a shared voxel world where players summon creatures, raids, buildings and powers by describing them.
Start by asking the player for a link code: they type /link in the game, then you call link_player with the code.
Then you can: read get_world_guide (tiers, what can be made, the world's look and rules) to help them refine prompts;
estimate_cost before anything is spent (refining prompts here is free; inscribing a scroll costs 20% of its casting aether; casting costs the full price);
inscribe_scroll to save a prompt in their spellbook; cast_scroll (they must be online); get_progress; and create_world / configure_world / open_world for worlds of their own.
Prompts are plain descriptions like "a huge kraken", "pirates raid the coast in 5 waves with bosses", "a village", "the power of a wizard".`;

interface Session {
  transport: StreamableHTTPServerTransport;
  link: Link | null;
}

export function createMcpHandler(opts: { host: WorldHost; links: LinkRegistry; publicUrl: string }) {
  const { host, links } = opts;
  const sessions = new Map<string, Session>();

  const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
  const fail = (message: string) => ({ ...text(message), isError: true });

  const makeServer = (session: Session) => {
    const server = new McpServer({ name: "lfg2", version: "0.1.0" }, { instructions: INSTRUCTIONS });
    const tokenArg = { link_token: z.string().optional().describe("The token link_player returned, if this chat was linked before (sessions don't survive server restarts)") };

    /** The linked player's world and a way to work with them (online or not). */
    const linked = async (token?: string): Promise<{ game: Game; link: Link } | string> => {
      if (token) {
        const l = links.resolve(token);
        if (!l) return "that link token isn't valid any more: ask the player for a new code (/link in game)";
        session.link = l;
      }
      if (!session.link) return "not linked to a player yet: ask them to type /link in the game and give you the code, then call link_player";
      const game = await host.get(session.link.world);
      if (!game) return `the world ${session.link.world} doesn't exist any more`;
      return { game, link: session.link };
    };
    const withPlayer = async <T>(token: string | undefined, fn: (p: Player, online: boolean, game: Game) => T) => {
      const l = await linked(token);
      if (typeof l === "string") return l;
      const out = l.game.withPlayer(l.link.player, (p, online) => fn(p, online, l.game));
      return out === null ? `${l.link.player} hasn't played in ${l.link.world} yet: join it once first` : out;
    };
    const service = <T>(game: Game, name: string) => game.kernel.services.get(name)?.value as T | undefined;

    server.registerTool("link_player", {
      title: "Link to a player",
      description: "Link this chat to a player, with the one-time code they get by typing /link in the game. Returns a link_token to reuse if the session is lost.",
      inputSchema: { code: z.string().describe("The code from /link, like K7Q-M3P") },
    }, async ({ code }) => {
      const r = links.redeem(code);
      if (!r) return fail("that code isn't valid (codes work once, for 10 minutes): ask for a new one with /link");
      session.link = { world: r.world, player: r.player };
      return text({ linked: true, player: r.player, world: r.world, link_token: r.token, next: "Try get_progress, get_world_guide or estimate_cost." });
    });

    server.registerTool("get_progress", {
      title: "Player progress",
      description: "The player's level, XP, aether, shards, the highest tier they can cast and when the next unlocks, and whether they're online.",
      inputSchema: tokenArg,
    }, async ({ link_token }) => {
      const r = await withPlayer(link_token, (p, online, game) => {
        const h = service<ProgressionService>(game, "progression")?.hud(p);
        return h ? { player: p.name, online, ...h, tierName: TIER_NAMES[h.tier - 1] } : "progression is switched off in this world";
      });
      return typeof r === "string" ? fail(r) : text(r);
    });

    server.registerTool("get_world_guide", {
      title: "World guide",
      description: "What can be made here and how strong it is: the tier ladder (levels, aether and shard costs, AI budget), the catalog of creatures, raid themes, builds and powers, the world's look (palette) and rules that differ from the defaults. Use it to help refine prompts that fit this world.",
      inputSchema: { ...tokenArg, section: z.enum(["all", "tiers", "catalog", "look", "rules"]).optional() },
    }, async ({ link_token, section }) => {
      const l = await linked(link_token);
      const game = typeof l === "string" ? await host.get(host.opts.defaultWorld) : l.game;
      if (!game) return fail("no world loaded");
      const std = game.std;
      const tiers = [1, 2, 3, 4, 5].map((t) => ({
        tier: t, name: TIER_NAMES[t - 1], unlocksAtLevel: levelForTier(t, std), ...castCost(t, std),
        inscribeAether: Math.ceil(castCost(t, std).aether * std.progression.scrolls.inscribeShareOfCast), aiTokenBudget: std.progression.tokenBudgetByTier[t - 1],
      }));
      const out: Record<string, unknown> = {};
      const want = (s: string) => !section || section === "all" || section === s;
      if (want("tiers")) out.tiers = { ladder: tiers, rituals: "Others can join a ritual (/ritual <prompt>, they press J): each helper adds 2 levels, up to one tier above the leader.", scaling: "Asking above your tier gives the biggest version your tier allows, with a note." };
      if (want("catalog")) out.catalog = {
        creatures: summonCatalog(), raids: scenarioCatalog(), builds: buildCatalog(), powers: powerCatalog(),
        tips: "Size words (tiny, big, huge, giant), colours (red, golden…), 'flying', 'angry'/'friendly' and numbers ('three wolves') change summons. Raids: 'in 5 waves', 'with bosses', 'a fleet'. Builds: 'on the mountainside', 'desert', 'stone'.",
      };
      if (want("look")) out.look = { style: std.art.style, palette: std.art.palette, reserved: std.art.reserved, presets: PALETTE_PRESETS.map(({ name, description }) => ({ name, description })) };
      if (want("rules")) out.rules = { changedInThisWorld: game.world.meta.rules ?? {}, pvp: !!game.world.meta.pvp, player: std.balance.player, damage: std.balance.damage, summons: std.summons };
      return text(out);
    });

    server.registerTool("estimate_cost", {
      title: "Estimate what a prompt costs",
      description: "Before spending anything: what a prompt would make, its tier and the level it needs, the full cost (aether, shards, AI budget), what the player would get at their level instead, how many ritual helpers it would take, and what inscribing it as a scroll costs. Refining prompts in this chat is free.",
      inputSchema: { ...tokenArg, prompt: z.string().min(1).max(300) },
    }, async ({ link_token, prompt }) => {
      const r = await withPlayer(link_token, (p, _online, game) => {
        const e = service<ProgressionService>(game, "progression")?.estimate(p, prompt);
        if (!e) return `nothing in this world knows how to make "${prompt}" yet (see get_world_guide's catalog)`;
        const ins = service<SpellbookService>(game, "spellbook")?.inscribeCost(p, prompt);
        return { ...e, inscribe: ins ?? null, canCastFullNow: e.level >= e.levelNeeded && e.have.aether >= e.full.aether && e.have.shards >= e.full.shards };
      });
      return typeof r === "string" ? fail(r) : text(r);
    });

    server.registerTool("list_scrolls", {
      title: "Spellbook",
      description: "The player's scrolls: name, prompt, what it makes, tier, and what casting it costs at their level now.",
      inputSchema: tokenArg,
    }, async ({ link_token }) => {
      const r = await withPlayer(link_token, (p, _o, game) => service<SpellbookService>(game, "spellbook")?.list(p) ?? "the spellbook is switched off in this world");
      return typeof r === "string" ? fail(r) : text(r);
    });

    server.registerTool("inscribe_scroll", {
      title: "Inscribe a scroll",
      description: "Save a refined prompt as a named scroll in the player's spellbook (it appears in game at once, if they're online). Checks it the way casting will and costs 20% of its casting aether (see estimate_cost). Same name replaces the old scroll.",
      inputSchema: { ...tokenArg, name: z.string().min(1).max(24).describe("Short name to cast it by, e.g. 'kraken storm'"), prompt: z.string().min(1).max(300) },
    }, async ({ link_token, name, prompt }) => {
      const r = await withPlayer(link_token, (p, online, game) => {
        const sb = service<SpellbookService>(game, "spellbook");
        if (!sb) return "the spellbook is switched off in this world";
        const res = sb.inscribe(p, name, prompt);
        if (!res.ok) return res.error;
        if (online) p.send({ t: "chat", kind: "event", text: `📜 A scroll arrives in your spellbook: "${res.scroll.name}" (${res.scroll.title}, tier ${res.scroll.tier})` });
        return { ...res, castWith: [`/cast ${res.scroll.name}`, "the spellbook (K)", `say "cast ${res.scroll.name}"`, "cast_scroll here"] };
      });
      return typeof r === "string" ? fail(r) : text(r);
    });

    server.registerTool("remove_scroll", {
      title: "Remove a scroll",
      description: "Remove a scroll from the player's spellbook (no refund).",
      inputSchema: { ...tokenArg, name: z.string() },
    }, async ({ link_token, name }) => {
      const r = await withPlayer(link_token, (p, _o, game) => service<SpellbookService>(game, "spellbook")?.remove(p, name) ? "removed" : `no scroll called "${name}"`);
      return r === "removed" ? text(r) : fail(String(r));
    });

    server.registerTool("cast_scroll", {
      title: "Cast a scroll",
      description: "Cast one of the player's scrolls into the world where they stand. They must be online in the world. It costs the full price and arrives as a normal world event, which everyone sees.",
      inputSchema: { ...tokenArg, name: z.string() },
    }, async ({ link_token, name }) => {
      const r = await withPlayer(link_token, (p, online, game) => {
        if (!online) return `${p.name} isn't in the world right now: scrolls are cast where the player stands`;
        return { result: service<SpellbookService>(game, "spellbook")?.cast(p, name) ?? "the spellbook is switched off in this world" };
      });
      return typeof r === "string" ? fail(r) : text(r);
    });

    // ---------------------------------------------------------------- worlds
    const setupSchema = {
      title: z.string().max(40).optional(),
      description: z.string().max(200).optional().describe("Shown to everyone who joins"),
      preset: z.enum(PALETTE_PRESETS.map((p) => p.name) as [string, ...string[]]).optional().describe(PALETTE_PRESETS.map((p) => `${p.name}: ${p.description}`).join("; ")),
      start_time: z.enum(Object.keys(START_TIMES) as [string, ...string[]]).optional(),
      day_length_minutes: z.number().min(2).max(200).optional(),
      pvp: z.boolean().optional(),
      rules: z.record(z.string(), z.union([z.number(), z.boolean(), z.string()])).optional().describe("Other world rules by path, e.g. {\"balance.player.jumpBlocks\": 2}; see get_world_guide. Locked rules can't change; values can change by at most 10×."),
    };
    const toSetup = (a: { title?: string; description?: string; preset?: string; start_time?: string; day_length_minutes?: number; pvp?: boolean; rules?: Record<string, number | boolean | string> }, seed?: number): WorldSetup => ({
      title: a.title, description: a.description, preset: a.preset, startTime: a.start_time as WorldSetup["startTime"], dayLengthMinutes: a.day_length_minutes, pvp: a.pvp, rules: a.rules, seed,
    });
    const joinUrl = (name: string) => `${opts.publicUrl.replace(/\/$/, "")}/?world=${encodeURIComponent(name)}`;

    server.registerTool("list_worlds", {
      title: "Worlds on this server",
      description: "The worlds here: open ones anyone can join, and ones still being set up.",
      inputSchema: {},
    }, async () => text(host.list().map((w) => ({ ...w, joinUrl: w.open ? joinUrl(w.name) : null }))));

    server.registerTool("create_world", {
      title: "Create a world",
      description: "Create a new world owned by the linked player, with its look and base rules, closed to others until open_world. The player is its admin. Levels are per world, so everyone starts at level 1 there.",
      inputSchema: { ...tokenArg, name: z.string().describe("3–24 letters, numbers or dashes, e.g. neon-isles"), seed: z.number().int().optional(), ...setupSchema },
    }, async (a) => {
      const l = await linked(a.link_token);
      if (typeof l === "string") return fail(l);
      const r = await host.create(a.name, l.link.player, toSetup(a, a.seed));
      if (!r.ok) return fail(r.error);
      return text({ created: r.world, setup: r.notes, join: joinUrl(r.world.name), next: "Join it to look around (only the creator can until it opens), adjust with configure_world, then open_world." });
    });

    server.registerTool("configure_world", {
      title: "Set up a world",
      description: "Change a world's look and rules while it's still closed (its creator only). After it opens, rule changes happen in game as world events.",
      inputSchema: { ...tokenArg, name: z.string(), ...setupSchema },
    }, async (a) => {
      const l = await linked(a.link_token);
      if (typeof l === "string") return fail(l);
      if (!host.games.has(a.name)) await host.get(a.name);
      const r = host.configure(a.name, l.link.player, toSetup(a));
      return r.ok ? text({ configured: a.name, setup: r.notes }) : fail(r.error ?? "couldn't");
    });

    server.registerTool("open_world", {
      title: "Open a world",
      description: "Open a world to everyone (its creator only).",
      inputSchema: { ...tokenArg, name: z.string() },
    }, async (a) => {
      const l = await linked(a.link_token);
      if (typeof l === "string") return fail(l);
      const r = host.open(a.name, l.link.player);
      return r.ok ? text({ opened: a.name, join: joinUrl(a.name) }) : fail(r.error ?? "couldn't");
    });

    return server;
  };

  const reply = (res: ServerResponse, status: number, message: string) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
  };
  const readJson = (req: IncomingMessage) => new Promise<unknown>((resolve, reject) => {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1_000_000) { reject(new Error("too large")); req.destroy(); } });
    req.on("end", () => { try { resolve(body ? JSON.parse(body) : undefined); } catch (e) { reject(e); } });
    req.on("error", reject);
  });

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const id = req.headers["mcp-session-id"] as string | undefined;
      if (req.method === "POST") {
        const body = await readJson(req);
        let s = id ? sessions.get(id) : undefined;
        if (!s) {
          if (id || !isInitializeRequest(body)) return reply(res, 400, "No valid session: start with an initialize request");
          const session: Session = { link: null, transport: null as unknown as StreamableHTTPServerTransport };
          session.transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid) => { sessions.set(sid, session); },
          });
          session.transport.onclose = () => { if (session.transport.sessionId) sessions.delete(session.transport.sessionId); };
          await makeServer(session).connect(session.transport);
          s = session;
        }
        await s.transport.handleRequest(req, res, body);
        return;
      }
      if (req.method === "GET" || req.method === "DELETE") {
        const s = id ? sessions.get(id) : undefined;
        if (!s) return reply(res, 400, "Unknown session");
        await s.transport.handleRequest(req, res);
        return;
      }
      res.writeHead(405).end();
    } catch (e) {
      if (!res.headersSent) reply(res, 500, e instanceof Error ? e.message : String(e));
    }
  };
}
