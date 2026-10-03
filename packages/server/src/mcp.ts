import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  DEFAULT_STANDARDS as DEFAULTS, EXAMPLE_RAID, RAID_LIMITS, designGuide, interpretPrompt, critiqueDesign, skillMarkdown, SKILLS, type DesignInput, type Standards, PALETTE_PRESETS, START_TIMES, TIER_NAMES, DEFAULT_STANDARDS, cloneStandards, planTheme, themeRules, rampFrom, RAMPS, buildCatalog, castCost, levelForTier, powerCatalog, scenarioCatalog, summonCatalog,
  type WorldSetup,
} from "@lfg/shared";
import type { Game } from "./game";
import { colorsFromImage } from "./images";
import type { WorldHost } from "./host";
import type { Link, LinkRegistry } from "./links";
import type { Player } from "./player";
import type { ProgressionService } from "./modules/vanilla/progression";
import type { SpellbookService } from "./modules/vanilla/spellbook";
import type { SummonService } from "./modules/vanilla/summons";
import type { RaidLibrary } from "./modules/vanilla/scenarios";
import type { DesignRenderer } from "./render";

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

/** docs/AGENT-BEST-PRACTICES.md, read once (it ships with the server). */
let bestPracticesText: string | null = null;
const bestPractices = () => (bestPracticesText ??= (() => {
  try { return readFileSync(new URL("../../../docs/AGENT-BEST-PRACTICES.md", import.meta.url), "utf8"); } catch { return "Best practices aren't bundled with this server; see get_design_guide."; }
})());

const INSTRUCTIONS = `This is LFG2, a shared voxel world where players summon creatures, raids, buildings and powers by describing them.
Start by asking the player for a link code: they type /link in the game, then you call link_player with the code.
Then you can: read get_world_guide (tiers, what can be made, the world's look and rules) to help them refine prompts;
estimate_cost before anything is spent (refining prompts here is free; inscribing a scroll costs 20% of its casting aether; casting costs the full price);
inscribe_scroll to save a prompt in their spellbook; cast_scroll (they must be online); get_progress; and create_world / configure_world / open_world for worlds of their own.
Before designing, read get_design_skill("design-best-practices"). To make something new rather than describe it: interpret_prompt (a brief and a starting design from the game's design skills), get_design_guide, write a design (JSON with a shape made of primitives), check_design and render_design until it passes and looks right, then save_design; players summon it with /summon design:<id>, and a scroll can hold "design:<id>".
Raids too: get_raid_guide, write waves of prompts or designs, check_raid (it playtests every wave), save_raid; players start it with /event raid:<id>.
Prompts are plain descriptions like "a huge kraken", "pirates raid the coast in 5 waves with bosses", "a village", "the power of a wizard".`;

interface Session {
  transport: StreamableHTTPServerTransport;
  link: Link | null;
}

export function createMcpHandler(opts: { host: WorldHost; links: LinkRegistry; publicUrl: string; renderer?: DesignRenderer }) {
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
      if (want("look")) out.look = { theme: game.world.meta.theme ?? null, materials: std.art.materials, style: std.art.style, palette: std.art.palette, reserved: std.art.reserved, presets: PALETTE_PRESETS.map(({ name, description }) => ({ name, description })) };
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
    const themeSchema = {
      theme: z.string().max(200).optional().describe("The world's style in words, e.g. 'cyberpunk sci-fi samurai'. Sets the palette, what grass/leaves/wood/stone/sky look like, start time, music key and tempo, the build style and the default raid theme."),
      reference_colors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(8).optional().describe("Main colours of reference images, as hex (#ff2fb3). Saturated ones set their hue's colours; a dark one tints greys."),
      reference_images: z.array(z.object({ data: z.string().describe("base64 PNG or JPEG"), mime_type: z.string().optional() })).max(4).optional().describe("Reference images (PNG/JPEG, ≤4 MB each). Only their dominant colours are used; images aren't kept."),
    };
    /** Colours from reference_colors plus any reference images. */
    const referenceColors = (a: { reference_colors?: string[]; reference_images?: { data: string; mime_type?: string }[] }): { colors: string[]; errors: string[] } => {
      const colors = [...(a.reference_colors ?? [])];
      const errors: string[] = [];
      for (const img of a.reference_images ?? []) {
        const r = colorsFromImage(img.data, img.mime_type);
        if ("error" in r) errors.push(r.error); else colors.push(...r.colors);
      }
      return { colors: colors.map((c) => c.toLowerCase()), errors };
    };
    const setupSchema = {
      title: z.string().max(40).optional(),
      description: z.string().max(200).optional().describe("Shown to everyone who joins"),
      preset: z.enum(PALETTE_PRESETS.map((p) => p.name) as [string, ...string[]]).optional().describe(PALETTE_PRESETS.map((p) => `${p.name}: ${p.description}`).join("; ")),
      start_time: z.enum(Object.keys(START_TIMES) as [string, ...string[]]).optional(),
      day_length_minutes: z.number().min(2).max(200).optional(),
      pvp: z.boolean().optional(),
      rules: z.record(z.string(), z.union([z.number(), z.boolean(), z.string()])).optional().describe("Other world rules by path, e.g. {\"balance.player.jumpBlocks\": 2}; see get_world_guide. Locked rules can't change; values can change by at most 10×."),
      ...themeSchema,
    };
    type SetupArgs = { title?: string; description?: string; preset?: string; start_time?: string; day_length_minutes?: number; pvp?: boolean; rules?: Record<string, number | boolean | string>; theme?: string; reference_colors?: string[]; reference_images?: { data: string; mime_type?: string }[] };
    const toSetup = (a: SetupArgs, seed?: number): WorldSetup => {
      const ref = referenceColors(a);
      return {
        title: a.title, description: a.description, preset: a.preset, startTime: a.start_time as WorldSetup["startTime"], dayLengthMinutes: a.day_length_minutes, pvp: a.pvp, rules: a.rules, seed,
        theme: a.theme, referenceColors: ref.colors.length ? ref.colors : undefined,
      };
    };

    server.registerTool("preview_theme", {
      title: "Preview a world theme",
      description: "See what a theme (words and/or reference images) would do to a world before creating it: the palette it generates, which colours grass, leaves, wood, stone and sky get, start time, music, build style, raid theme, creatures that fit, and what stays the same. Free; nothing changes.",
      inputSchema: themeSchema,
    }, async (a) => {
      const ref = referenceColors(a);
      const theme = planTheme(a.theme ?? "", ref.colors);
      const std = cloneStandards(DEFAULT_STANDARDS);
      const rules = themeRules(theme, std);
      const ramps = Object.fromEntries(RAMPS.filter((r) => theme.ramps[r]).map((r) => [r, rampFrom(theme.ramps[r]!)]));
      return text({
        theme, generatedRamps: ramps, ruleChanges: rules.changes.length, problems: [...ref.errors, ...rules.errors], adjustments: rules.notes,
        staysTheSame: "Blocks, items and recipes; reserved colours (danger, water, magic, team colours) so warnings still read the same everywhere; locked rules; the default world and every other world.",
      });
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
      return text({ created: r.world, setup: r.notes, theme: host.games.get(r.world.name)?.world.meta.theme ?? null, join: joinUrl(r.world.name), next: "Join it to look around (only the creator can until it opens), adjust with configure_world, then open_world." });
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

    // ---------------------------------------------------------------- designs
    /** The rule values that change how a design looks in a world (palette, materials, model style). */
    const lookRules = (std: Standards): [string, number | boolean | string][] => {
      const out: [string, number | boolean | string][] = [];
      for (const [k, v] of Object.entries(std.art.palette)) if (v !== (DEFAULTS.art.palette as Record<string, string>)[k]) out.push([`art.palette.${k}`, v]);
      const style = (std.art as { modelStyle?: string }).modelStyle;
      if (style) out.push(["art.modelStyle", style]);
      return out;
    };
    const designWorld = async (token?: string) => {
      const l = await linked(token);
      const game = typeof l === "string" ? await host.get(host.opts.defaultWorld) : l.game;
      return { game, link: typeof l === "string" ? null : l.link };
    };
    const promptArg = z.string().max(300).optional().describe("What the player asked for, in words: the design is also critiqued against the brief interpret_prompt makes from it (skill, mood, proportions)");
    /** Taste, on top of the rules: how well a design meets the brief for the player's words. */
    const critique = (game: Game, design: unknown, c: ReturnType<SummonService["designs"]["check"]>, prompt?: string) => {
      if (!prompt || !c.model) return undefined;
      const r = interpretPrompt(prompt, game.std);
      if ("error" in r) return { note: r.error };
      const { brief } = r;
      return { skill: brief.skill, mood: brief.mood, ...critiqueDesign(design as DesignInput, c.model, brief, game.std) };
    };
    const designArg = z.record(z.string(), z.unknown()).describe("The design as JSON (see get_design_guide): { name, movement, temperament, length, colors, shape: { parts: [...] } }");
    /** A check result, trimmed for a chat: issues first, then numbers. */
    const summary = (c: ReturnType<SummonService["designs"]["check"]>, taste?: ReturnType<typeof critique>) => ({
      ok: c.ok,
      issues: c.issues,
      errors: c.report?.errors ?? [],
      warnings: c.report?.warnings ?? [],
      fittedToRules: c.fitted,
      tier: c.tier,
      size: c.report ? c.report.stats.size.map((v) => +v.toFixed(2)) : undefined,
      triangles: c.report ? `${c.report.stats.triangles} (${c.report.stats.budget} ≤ ${c.report.stats.maxTriangles})` : undefined,
      stats: c.stats ? { kind: c.stats.kind, health: c.stats.health, damage: c.stats.damage, speed: +c.stats.speed.toFixed(2), warningSeconds: c.stats.telegraph } : undefined,
      playtest: c.playtest,
      ...(taste ? { critique: taste } : {}),
      next: !c.ok ? "fix the errors (paths say where; hints say how) and check again" : "render_design to look at it, then save_design",
    });

    server.registerTool("get_design_guide", {
      title: "How to write a design",
      description: "Everything needed to write a creature or object as a design: the JSON format, shape primitives (box, ellipsoid, cylinder, cone, capsule, torus, wedge), animation roles, limits, this world's palette and model style, triangle budgets and a working example. Free.",
      inputSchema: tokenArg,
    }, async ({ link_token }) => {
      const { game } = await designWorld(link_token);
      if (!game) return fail("no world loaded");
      return text(designGuide(game.std));
    });

    server.registerTool("interpret_prompt", {
      title: "Interpret a request like an art director",
      description: "Turn the player's words into a brief before designing: the skill (archetype) to follow, the mood (cute, menacing, heroic, elegant, comic) and what it means for proportions and forms, the model style, size, colours, what must read from 20 m away, best-practice guidance, and a starting design from the skill's template (already pushed towards the mood, with the features asked for). Change the start to fit the request, then check_design and render_design with the same prompt. Free.",
      inputSchema: { ...tokenArg, prompt: z.string().min(1).max(300) },
    }, async ({ link_token, prompt }) => {
      const { game } = await designWorld(link_token);
      if (!game) return fail("no world loaded");
      const r = interpretPrompt(prompt, game.std);
      if ("error" in r) return fail(`${r.error}. You can still write a design from get_design_guide.`);
      return text({ brief: r.brief, skill: { id: r.skill.id, name: r.skill.name, parts: r.skill.parts, styles: r.skill.styles }, start: r.start, next: "adapt `start` to the request, then check_design and render_design with this prompt; aim for no errors and a critique score of 80+" });
    });

    server.registerTool("get_design_skill", {
      title: "Design skills",
      description: "Read \"design-best-practices\" first. Then the game's best-practice guides for making creatures, one per archetype (four-legged creature, humanoid, winged creature, swimmer, floating spirit): how to build one, parts and animation roles, proportions per mood, notes per style, and a template. Without an id, lists them. Each is also a SKILL.md document your chat app can keep.",
      inputSchema: { id: z.string().optional() },
    }, async ({ id }) => {
      if (!id) return text([{ id: "design-best-practices", name: "Best practices (read first)", description: "The loop, prompt words, proportions by mood, a primitive cookbook, colour, style, common mistakes, raids, safety" }, ...SKILLS.map((k) => ({ id: k.id, name: k.name, description: k.description }))]);
      if (id === "design-best-practices") return text(bestPractices());
      const skill = SKILLS.find((k) => k.id === id);
      return skill ? text(skillMarkdown(skill)) : fail(`no skill "${id}": ${SKILLS.map((k) => k.id).join(", ")}`);
    });

    server.registerTool("check_design", {
      title: "Check a design",
      description: "Run every check a summon gets (fields, shape, size, colours, triangle budget, readability, and a playtest on this world's land with virtual players) without saving or spending anything. Issues come back with JSON paths and hints. Free; check as often as you like.",
      inputSchema: { ...tokenArg, design: designArg, prompt: promptArg },
    }, async ({ link_token, design, prompt }) => {
      const { game } = await designWorld(link_token);
      const svc = game && service<SummonService>(game, "summons");
      if (!game || !svc) return fail("summons are switched off in this world");
      const c = svc.designs.check(design);
      return text(summary(c, critique(game, design, c, prompt)));
    });

    server.registerTool("render_design", {
      title: "Render a design",
      description: "Look at a design as players will see it in this world (its colours and model style: voxel, smooth, lowpoly or sculpted; sculpted shows the close-up version): 3/4 front, side, front, top, a silhouette at 20 m and next to a player and a tree, plus the check report. Use it after check_design passes, and again after each change. Free.",
      inputSchema: { ...tokenArg, design: designArg, prompt: promptArg, style: z.enum(["voxel", "smooth", "lowpoly", "sculpted"]).optional().describe("Preview it in another style, to compare; to keep a style, put it in the design (`style`) or the prompt") },
    }, async ({ link_token, design, style, prompt }) => {
      if (!opts.renderer) return fail("rendering isn't available on this server; check_design still works");
      const { game } = await designWorld(link_token);
      const svc = game && service<SummonService>(game, "summons");
      if (!game || !svc) return fail("summons are switched off in this world");
      const c = svc.designs.check(design);
      if (!c.spec) return fail(JSON.stringify(summary(c), null, 2));
      try {
        const r = await opts.renderer.render(c.spec, lookRules(game.std), style);
        return { content: [
          { type: "image" as const, data: r.jpeg.toString("base64"), mimeType: "image/jpeg" },
          { type: "text" as const, text: JSON.stringify({ ...summary(c, critique(game, design, c, prompt)), drawn: r.report }, null, 2) },
        ] };
      } catch (e) {
        return fail(`couldn't render: ${e instanceof Error ? e.message : String(e)}`);
      }
    });

    server.registerTool("save_design", {
      title: "Save a design to the world",
      description: "Save a design that passes check_design to the linked player's world, so anyone there can summon it (/summon design:<id>) at its tier's normal cost, or keep it on a scroll (inscribe_scroll with the prompt \"design:<id>\"). Saving again with the same id replaces it (only its author can). Free.",
      inputSchema: { ...tokenArg, design: designArg },
    }, async ({ link_token, design }) => {
      const l = await linked(link_token);
      if (typeof l === "string") return fail(l);
      const svc = service<SummonService>(l.game, "summons");
      if (!svc) return fail("summons are switched off in this world");
      const r = svc.designs.save(l.link.player, design);
      if (!r.ok) return fail(JSON.stringify(summary(r.check), null, 2));
      const online = l.game.players.get(l.link.player.toLowerCase());
      online?.send({ t: "chat", kind: "event", text: `✎ Your design "${r.design.spec.name}" is saved to this world: /summon design:${r.design.id}` });
      return text({ saved: r.design.id, name: r.design.spec.name, tier: r.design.tier, castWith: [`/summon design:${r.design.id}`, `inscribe_scroll with prompt "design:${r.design.id}"`], check: summary(r.check) });
    });

    // ---------------------------------------------------------------- raids
    const raidArg = z.record(z.string(), z.unknown()).describe("The raid as JSON (see get_raid_guide): { title, ship?, ships?, waves: [{ enemies: [{ who, count }], boss? }], restSeconds?, reward? }");
    /** Where to playtest: near the linked player if they're online, else near spawn. */
    const nearOf = (game: Game, player?: string): [number, number] | undefined => {
      const p = player ? game.players.get(player.toLowerCase()) : undefined;
      return p ? [p.entity.x, p.entity.z] : undefined;
    };

    server.registerTool("get_raid_guide", {
      title: "How to write a raid",
      description: "The format for writing a raid (an invasion from the sea) instead of describing one: ships, waves of enemies (prompts or design:<id>), bosses, rest between waves, the reward; the limits, the pacing rules it's checked against, the raid themes that exist, and a working example. Free.",
      inputSchema: {},
    }, async () => text({
      howTo: [
        "Members (`who`, `boss`, `ship`) are prompts like \"a skeleton\" or saved designs like \"design:moss_golem\". Enemies are made hostile; bosses follow the boss rules (longer warnings, area attacks, health scaled to the players).",
        "Pacing: start small (2–5 enemies), let each wave be bigger or harder than the last, end with a boss, and rest 10–20 s between waves.",
        "At most 8 enemies are on the beach at once whatever the wave size; the rest wait on the ships.",
        "check_raid validates it, checks every member's model, and playtests every wave on a real coast; save_raid stores it; players start it with /event raid:<id> (or a scroll holding raid:<id>).",
      ],
      limits: RAID_LIMITS,
      themes: scenarioCatalog(),
      example: EXAMPLE_RAID,
    }));

    server.registerTool("check_raid", {
      title: "Check a raid",
      description: "Every check starting a raid makes, without saving or spending: the format (issues with JSON paths and hints), each member's model and size rules, pacing, its tier, and a playtest of every wave with virtual defenders on a coast near the player (or spawn). Free.",
      inputSchema: { ...tokenArg, raid: raidArg },
    }, async ({ link_token, raid }) => {
      const { game, link } = await designWorld(link_token);
      const lib = game && service<RaidLibrary>(game, "raids");
      if (!game || !lib) return fail("scenarios are switched off in this world");
      const c = await lib.check(raid, nearOf(game, link?.player));
      return text({ ok: c.ok, issues: c.issues, tier: c.tier, summary: c.summary, playtest: c.playtest, next: c.ok ? "save_raid, then /event raid:<id> in game" : "fix the errors and check again" });
    });

    server.registerTool("save_raid", {
      title: "Save a raid to the world",
      description: "Save a raid that passes check_raid to the linked player's world, so it can be started with /event raid:<id> at its tier's normal cost (or kept on a scroll as raid:<id>). Same id replaces it (only its author can). Free.",
      inputSchema: { ...tokenArg, raid: raidArg },
    }, async ({ link_token, raid }) => {
      const l = await linked(link_token);
      if (typeof l === "string") return fail(l);
      const lib = service<RaidLibrary>(l.game, "raids");
      if (!lib) return fail("scenarios are switched off in this world");
      const r = await lib.save(l.link.player, raid, nearOf(l.game, l.link.player));
      if (!r.ok) return fail(JSON.stringify({ ok: false, issues: r.check.issues, playtest: r.check.playtest }, null, 2));
      l.game.players.get(l.link.player.toLowerCase())?.send({ t: "chat", kind: "event", text: `⚓ Your raid "${r.raid.spec.title}" is saved to this world: /event raid:${r.raid.id}` });
      return text({ saved: r.raid.id, title: r.raid.spec.title, tier: r.raid.tier, summary: r.check.summary, startWith: [`/event raid:${r.raid.id}`, `inscribe_scroll with prompt "raid:${r.raid.id}"`] });
    });

    server.registerTool("list_raids", {
      title: "Raids in this world",
      description: "Raids saved to the linked player's world, with who wrote them, their tier and how to start them.",
      inputSchema: tokenArg,
    }, async ({ link_token }) => {
      const { game } = await designWorld(link_token);
      const lib = game && service<RaidLibrary>(game, "raids");
      return lib ? text(lib.list()) : fail("scenarios are switched off in this world");
    });

    server.registerTool("list_designs", {
      title: "Designs in this world",
      description: "Designs saved to the linked player's world (by anyone), with who made them, their tier and how to summon them.",
      inputSchema: tokenArg,
    }, async ({ link_token }) => {
      const { game } = await designWorld(link_token);
      const svc = game && service<SummonService>(game, "summons");
      return svc ? text(svc.designs.list()) : fail("summons are switched off in this world");
    });

    server.registerTool("remove_design", {
      title: "Remove a design",
      description: "Remove one of the player's designs from their world. Creatures already summoned stay until they leave.",
      inputSchema: { ...tokenArg, id: z.string() },
    }, async ({ link_token, id }) => {
      const l = await linked(link_token);
      if (typeof l === "string") return fail(l);
      const svc = service<SummonService>(l.game, "summons");
      const why = svc ? svc.designs.remove(id, l.link.player, false) : "summons are switched off in this world";
      return why ? fail(why) : text(`removed ${id}`);
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
