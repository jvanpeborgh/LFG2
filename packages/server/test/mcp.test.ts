import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { DEFAULT_STANDARDS, PROTOCOL_VERSION, VANILLA_CONTENT, buildRegistry, castCost, presetRules, type ScrollHud } from "@lfg/shared";
import { WorldHost } from "../src/host";
import { LinkRegistry } from "../src/links";
import { createMcpHandler } from "../src/mcp";
import { VANILLA_MODULES } from "../src/modules";
import { TestClient } from "./helpers";

const reg = buildRegistry([VANILLA_CONTENT.id], DEFAULT_STANDARDS);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const std = DEFAULT_STANDARDS;

describe("MCP server: prepare prompts in a chat, load them into the game", () => {
  let dir: string;
  let host: WorldHost;
  let http: Server;
  let base: string;
  let alice: TestClient;
  let mcp: Client;
  let token = "";

  const join_ = async (name: string, world = "world") => {
    const c = new TestClient(`${base.replace("http", "ws")}/ws?world=${world}`);
    await c.open();
    c.send({ t: "hello", name, protocol: PROTOCOL_VERSION, fingerprint: reg.fingerprint() });
    const first = await Promise.race([c.waitFor("welcome"), c.waitFor("reject")]);
    return { c, first };
  };
  const say = async (c: TestClient, text: string) => {
    const n = c.messages.length;
    c.send({ t: "chat", text });
    await sleep(200);
    return c.messages.slice(n).filter((m) => m.t === "chat").map((m) => (m as { text: string }).text).join("\n");
  };
  const connectMcp = async () => {
    const client = new Client({ name: "test-chat", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    return client;
  };
  const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name, arguments: args }) as { content: { text: string }[]; isError?: boolean };
    const t = r.content[0].text;
    let data: unknown = t;
    try { data = JSON.parse(t); } catch { /* plain text */ }
    return { error: !!r.isError, data: data as Record<string, any> & string };
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "lfg2-mcp-"));
    const links = new LinkRegistry(join(dir, "links.json"));
    host = new WorldHost({
      dataDir: dir, defaultWorld: "world", links,
      game: {
        modules: VANILLA_MODULES, seed: 42, viewDistance: 1, log: () => {},
        eventTiming: { gatherSeconds: { minor: 0.5, major: 0.5, epic: 0.5 }, watchSeconds: 1, spacingSeconds: { minor: 0, major: 0, epic: 0 } },
      },
    });
    await host.get("world");
    const handler = createMcpHandler({ host, links, publicUrl: "http://game.example" });
    http = createServer((req, res) => { if (req.url?.startsWith("/mcp")) void handler(req, res); else res.writeHead(404).end(); });
    new WebSocketServer({ server: http, path: "/ws" }).on("connection", (s, req) => host.connect(s, new URL(req.url ?? "/", "http://x").searchParams.get("world") ?? "world"));
    await new Promise<void>((r) => http.listen(0, r));
    const addr = http.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    alice = (await join_("Alice")).c;
    await sleep(300);
    mcp = await connectMcp();
  }, 60000);

  afterAll(async () => {
    await mcp.close().catch(() => {});
    alice.ws.close();
    await host.stopAll();
    http.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("lists its tools, and needs a link before acting for anyone", async () => {
    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "cast_scroll", "configure_world", "create_world", "estimate_cost", "get_progress", "get_world_guide", "inscribe_scroll", "link_player", "list_scrolls", "list_worlds", "open_world", "preview_theme", "remove_scroll",
    ]);
    const r = await call(mcp, "get_progress");
    expect(r.error).toBe(true);
    expect(r.data).toMatch(/type \/link in the game/);
    expect((await call(mcp, "link_player", { code: "AAA-AAA" })).error).toBe(true);
  });

  it("links with a one-time code from /link", async () => {
    const reply = await say(alice, "/link");
    const code = reply.match(/link code: ([A-Z0-9]{3}-[A-Z0-9]{3})/)![1];
    expect(reply).toMatch(/http:\/\/game\.example\/mcp|\/mcp/);
    const r = await call(mcp, "link_player", { code });
    expect(r.data).toMatchObject({ linked: true, player: "Alice", world: "world" });
    token = r.data.link_token;
    // Codes work once.
    expect((await call(mcp, "link_player", { code })).error).toBe(true);
    const p = await call(mcp, "get_progress");
    expect(p.data).toMatchObject({ player: "Alice", online: true, level: 1, aether: 100, tier: 1 });
  });

  it("gives a guide to what can be made, and estimates costs before anything is spent", async () => {
    const g = await call(mcp, "get_world_guide", { section: "all" });
    expect(g.data.tiers.ladder[2]).toMatchObject({ tier: 3, name: "Major", unlocksAtLevel: 8, aether: 35, shards: 1, inscribeAether: 7 });
    expect(g.data.catalog.creatures.map((c: { name: string }) => c.name)).toContain("kraken");
    expect(g.data.catalog.raids.map((c: { theme: string }) => c.theme)).toContain("pirates");
    expect(g.data.look.presets.map((c: { name: string }) => c.name)).toContain("neon");
    const e = await call(mcp, "estimate_cost", { prompt: "a huge kraken" });
    expect(e.data).toMatchObject({ kind: "summon", title: "Huge Kraken", tier: 3, levelNeeded: 8, level: 1, full: { aether: 35, shards: 1 }, inscribe: { aether: 7 } });
    expect(e.data.youGet).toMatchObject({ title: "Young Kraken", tier: 1, aether: 5 });
    expect(e.data.ritualHelpers).toBeNull();
    expect((await call(mcp, "estimate_cost", { prompt: "a toaster" })).error).toBe(true);
  });

  it("inscribes a refined prompt as a scroll that appears in game, for a fifth of its casting aether", async () => {
    const r = await call(mcp, "inscribe_scroll", { name: "Kraken Storm", prompt: "a huge kraken" });
    expect(r.data).toMatchObject({ ok: true, paid: Math.ceil(castCost(3, std).aether * 0.2), scroll: { name: "kraken storm", tier: 3, castsAs: "Young Kraken" } });
    const book = await alice.waitFor("spellbook", (m) => m.scrolls.length === 1);
    expect(book.scrolls[0]).toMatchObject({ name: "kraken storm", title: "Huge Kraken" } satisfies Partial<ScrollHud>);
    expect(alice.messages.some((m) => m.t === "chat" && /A scroll arrives in your spellbook: "kraken storm"/.test(m.text))).toBe(true);
    expect((await call(mcp, "list_scrolls")).data).toHaveLength(1);
    // Prompts that can't be made aren't inscribed (and cost nothing).
    const bad = await call(mcp, "inscribe_scroll", { name: "toast", prompt: "a toaster" });
    expect(bad.error).toBe(true);
  });

  it("casts a scroll from the chat (the player must be online), or in game with /cast", async () => {
    const r = await call(mcp, "cast_scroll", { name: "kraken storm" });
    expect(r.data.result).toMatch(/📜 kraken storm: Summoning Young Kraken/);
    expect(await say(alice, "/scrolls")).toMatch(/kraken storm: Huge Kraken \(tier 3\) .* at your level: Young Kraken/);
  });

  it("works while the player is offline too (except casting), and a token re-links a new chat", async () => {
    alice.ws.close();
    await sleep(300);
    const chat2 = await connectMcp();
    const r = await call(chat2, "inscribe_scroll", { link_token: token, name: "pig", prompt: "a pig" });
    expect(r.data).toMatchObject({ ok: true, paid: 1 });
    expect((await call(chat2, "get_progress")).data).toMatchObject({ online: false });
    expect((await call(chat2, "cast_scroll", { name: "pig" })).data).toMatch(/isn't in the world right now/);
    await chat2.close();
    alice = (await join_("Alice")).c;
    const book = await alice.waitFor("spellbook", (m) => m.scrolls.length === 2);
    expect(book.scrolls.map((s) => s.name)).toEqual(["kraken storm", "pig"]);
  });

  it("creates a world with its look and rules, closed to others until its creator opens it", async () => {
    const bad = await call(mcp, "create_world", { name: "nope", rules: { "locked.maxWorldwideHazards": 9 } });
    expect(bad.error).toBe(true);
    expect(bad.data).toMatch(/locked/);
    const r = await call(mcp, "create_world", {
      name: "neon-isles", title: "Neon Isles", description: "Glowing islands, low gravity", preset: "neon", start_time: "dusk", pvp: true,
      rules: { "balance.player.jumpBlocks": 2 },
    });
    expect(r.data.created).toMatchObject({ name: "neon-isles", title: "Neon Isles", owner: "Alice", open: false });
    expect(r.data.join).toBe("http://game.example/?world=neon-isles");
    const world = host.games.get("neon-isles")!;
    expect(world.std.balance.player.jumpBlocks).toBe(2);
    const neonGreen = presetRules("neon", std)["art.palette.green3"];
    expect(world.std.art.palette.green3).toBe(neonGreen);
    expect(world.world.meta.pvp).toBe(true);
    // Others can't join yet; the creator can, and is greeted.
    const bob = await join_("Bob", "neon-isles");
    expect(bob.first.t).toBe("reject");
    expect((bob.first as { reason: string }).reason).toMatch(/still being set up by Alice/);
    const a2 = await join_("Alice", "neon-isles");
    expect(a2.first.t).toBe("welcome");
    await sleep(200);
    expect(a2.c.messages.some((m) => m.t === "chat" && /Welcome to Neon Isles \(made by Alice\): Glowing islands/.test(m.text))).toBe(true);
    // Adjust, then open.
    expect((await call(mcp, "configure_world", { name: "neon-isles", preset: "autumn" })).data).toMatchObject({ configured: "neon-isles" });
    expect((await call(mcp, "open_world", { name: "neon-isles" })).data).toMatchObject({ opened: "neon-isles" });
    expect((await call(mcp, "configure_world", { name: "neon-isles", pvp: false })).data).toMatch(/it's open now/);
    const bob2 = await join_("Bob", "neon-isles");
    expect(bob2.first.t).toBe("welcome");
    expect(await say(bob2.c, "/worlds")).toMatch(/▶ Neon Isles \(neon-isles\) by Alice/);
    expect((await call(mcp, "list_worlds")).data.map((w: { name: string }) => w.name).sort()).toEqual(["neon-isles", "world"]);
    // Levels are per world: Alice starts again at level 1 there.
    expect(await say(a2.c, "/progress")).toMatch(/Alice: level 1/);
    a2.c.ws.close(); bob2.c.ws.close();
  }, 60000);

  it("previews and applies a theme from words and a reference image (only its colours are used)", async () => {
    // A tiny PNG: magenta and cyan on near-black.
    const { PNG } = await import("pngjs");
    const png = new PNG({ width: 8, height: 8 });
    for (let i = 0; i < 64; i++) png.data.set(i < 32 ? [10, 12, 30, 255] : i < 48 ? [255, 40, 160, 255] : [20, 230, 240, 255], i * 4);
    const image = PNG.sync.write(png).toString("base64");
    const prev = await call(mcp, "preview_theme", { theme: "cyberpunk samurai", reference_images: [{ data: image, mime_type: "image/png" }] });
    expect(prev.data.theme.title).toBe("Cyberpunk Samurai");
    expect(prev.data.theme.referenceColors).toEqual(expect.arrayContaining(["#ff28a0", "#14e6f0"]));
    expect(prev.data.staysTheSame).toMatch(/reserved colours/);
    expect((await call(mcp, "preview_theme", { reference_images: [{ data: "bm90IGFuIGltYWdl" }] })).data.problems.join(" ")).toMatch(/PNG and JPEG/);
    const r = await call(mcp, "create_world", { name: "neo-kyoto", theme: "cyberpunk samurai", reference_images: [{ data: image, mime_type: "image/png" }] });
    expect(r.data.theme).toMatchObject({ title: "Cyberpunk Samurai", raidTheme: "ninjas", build: { roof: "eaves", neon: true } });
    const g = host.games.get("neo-kyoto")!;
    expect(g.std.art.materials.leaves).toBe("pink4");
    expect(g.std.art.palette.pink3).toBe("#ff28a0");
    // The base world is untouched.
    expect(host.games.get("world")!.std.art.materials.leaves).toBe("green2");
    expect(host.games.get("world")!.std.art.palette.pink3).toBe(std.art.palette.pink3);
  }, 60000);
});
