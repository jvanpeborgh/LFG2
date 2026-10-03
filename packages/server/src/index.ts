import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { VANILLA_MODULES } from "./modules";
import { Transcriber, handleTranscribe } from "./transcribe";
import { WorldHost } from "./host";
import { Accounts } from "./accounts";
import { LinkRegistry } from "./links";
import { createMcpHandler } from "./mcp";
import { DesignRenderer } from "./render";
import { ClaudeDesigner, imagineModule } from "./designer";

// A local .env (git-ignored) for secrets such as ANTHROPIC_API_KEY; the real environment wins.
try { process.loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url))); } catch { /* no .env */ }
const env = process.env;
const PORT = Number(env.PORT ?? 8080);
const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const CLIENT_DIST = resolve(ROOT, "packages/client/dist");

const transcriber = Transcriber.fromEnv(env);
const PUBLIC_URL = env.PUBLIC_URL ?? `http://localhost:${PORT}`;
const DATA_DIR = env.DATA_DIR ?? join(ROOT, "data");
const links = new LinkRegistry(join(DATA_DIR, "links.json"));

// Designs are rendered by this server's own viewer page, in headless Chromium (if there is one).
const renderer = new DesignRenderer(`http://127.0.0.1:${PORT}`);
// Claude designs what players describe (/imagine), when there's an Anthropic API key.
const designer = ClaudeDesigner.fromEnv(env, renderer);

// Several worlds can run side by side: the default one, and worlds players create (see host.ts).
// Names are kept by the browsers that claimed them (accounts.ts).
const accounts = new Accounts(join(DATA_DIR, "accounts.json"));
const host = new WorldHost({
  dataDir: DATA_DIR,
  accounts,
  defaultWorld: env.WORLD ?? "world",
  links,
  maxWorlds: Number(env.MAX_WORLDS ?? 10),
  game: {
    modules: [...VANILLA_MODULES, imagineModule(designer)],
    voiceServer: transcriber.available,
    publicUrl: PUBLIC_URL,
    seed: env.SEED !== undefined ? Number(env.SEED) : undefined,
    viewDistance: Number(env.VIEW_DISTANCE ?? 4),
    admins: (env.ADMINS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    // EVENT_PACING=fast: short build-ups and no spacing between world events, for trying changes out.
    eventTiming: env.EVENT_PACING === "fast"
      ? { gatherSeconds: { minor: 2, major: 3, epic: 4 }, watchSeconds: 10, spacingSeconds: { minor: 0, major: 0, epic: 0 } }
      : undefined,
  },
});
const game = (await host.get(host.opts.defaultWorld))!;
const mcp = createMcpHandler({ host, links, publicUrl: PUBLIC_URL, renderer });

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".wasm": "application/wasm",
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (handleTranscribe(req, res, transcriber, (token) => {
    for (const g of host.games.values()) { const who = g.playerForVoiceToken(token); if (who) return who; }
    return null;
  })) return;
  if (url.pathname === "/mcp") { void mcp(req, res); return; }
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, fingerprint: game.reg.fingerprint(), ...game.stats(), worlds: host.list().length }));
    return;
  }
  if (url.pathname.startsWith("/api/") && handleApi(req, res, url)) return;
  if (!existsSync(CLIENT_DIST)) {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("LFG2 server running. Build the client (npm run build) or use the Vite dev server (npm run dev).");
    return;
  }
  let file = normalize(join(CLIENT_DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(CLIENT_DIST)) { res.writeHead(403); res.end(); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(CLIENT_DIST, "index.html");
  res.writeHead(200, {
    "content-type": MIME[extname(file)] ?? "application/octet-stream",
    "cache-control": file.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
  });
  createReadStream(file).pipe(res);
});

/** Read a small JSON request body. */
function readJson(req: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 8192) { reject(new Error("too big")); req.destroy(); } });
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}
const sendJson = (res: import("node:http").ServerResponse, status: number, data: unknown) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
};

/**
 * The title screen's API:
 *   GET  /api/worlds              the open public worlds; with x-lfg-name and x-lfg-key headers, also yours
 *                                 (ones you made or were invited to), and the world you were last in
 *   GET  /api/invite/<code>       what an invite opens (world, who it's from, how many are playing)
 *   POST /api/worlds              make a world: { name, key, title, description, look, theme, access, startTime, setUp }
 *   POST /api/signin              { code } from /device → { name, key } for this browser
 */
function handleApi(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, url: URL): boolean {
  const who = String(req.headers["x-lfg-name"] ?? ""), key = String(req.headers["x-lfg-key"] ?? "");
  if (url.pathname === "/api/worlds" && req.method === "GET") {
    const me = who && accounts.verify(who, key) ? who : null;
    const list = host.list().filter((w) => (w.open && (w.access ?? "public") === "public") || (me && host.canSee(w, me)));
    sendJson(res, 200, {
      worlds: list.map((w) => ({ name: w.name, title: w.title, description: w.description, owner: w.owner, players: w.players, open: w.open, access: w.access ?? "public", mine: !!me && w.owner?.toLowerCase() === me.toLowerCase(), member: !!me && host.canSee(w, me) })),
      lastWorld: me ? accounts.get(me)?.lastWorld ?? null : null,
      claimed: who ? (accounts.get(who) ? (me ? "yours" : "taken") : "free") : null,
    });
    return true;
  }
  const inv = /^\/api\/invite\/([a-z0-9]{4,16})$/i.exec(url.pathname);
  if (inv && req.method === "GET") {
    const i = host.invite(inv[1]);
    if (!i) sendJson(res, 404, { error: "That invite link doesn't work any more (or was mistyped)" });
    else sendJson(res, 200, { world: i.world, title: i.title, description: i.description, owner: i.owner, by: i.by, players: i.players, open: i.open, access: i.access });
    return true;
  }
  if (url.pathname === "/api/signin" && req.method === "POST") {
    readJson(req).then((b) => {
      const r = accounts.redeem(String(b.code ?? ""));
      if (r) sendJson(res, 200, r); else sendJson(res, 400, { error: "That code doesn't work: get a new one with /device (codes last 10 minutes and work once)" });
    }, () => sendJson(res, 400, { error: "bad request" }));
    return true;
  }
  if (url.pathname === "/api/worlds" && req.method === "POST") {
    readJson(req).then(async (b) => {
      const name = String(b.name ?? ""), k = String(b.key ?? "");
      if (!/^[A-Za-z0-9_]{2,16}$/.test(name)) return sendJson(res, 400, { error: "Pick a name first (2–16 letters, numbers or _)" });
      const denied = accounts.admit(name, k);
      if (denied) return sendJson(res, 403, { error: denied });
      if (!accounts.verify(name, k)) return sendJson(res, 403, { error: "This browser couldn't keep your name; reload and try again" });
      const title = String(b.title ?? "").trim().slice(0, 40);
      if (title.length < 3) return sendJson(res, 400, { error: "Give your world a name (at least 3 letters)" });
      // A web-safe name from the title, made unique.
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20) || "world";
      let world = slug.length >= 3 ? slug : `${slug}-world`;
      for (let i = 2; host.entry(world); i++) world = `${slug.slice(0, 18)}-${i}`;
      const look = typeof b.look === "string" && b.look ? b.look : undefined;
      const theme = typeof b.theme === "string" && b.theme.trim() ? b.theme.trim().slice(0, 300) : undefined;
      const startTime = typeof b.startTime === "string" ? b.startTime : undefined;
      const r = await host.create(world, name, {
        title, description: String(b.description ?? theme ?? "").slice(0, 200), access: b.access === "invite" ? "invite" : "public",
        ...(look && look !== "theme" ? { preset: look } : {}), ...(theme ? { theme } : {}), ...(startTime ? { startTime: startTime as never } : {}),
      });
      if (!r.ok) return sendJson(res, 400, { error: r.error });
      // Open straight away unless they want to set it up alone first.
      if (!b.setUp) host.open(world, name);
      sendJson(res, 200, { world, title, notes: r.notes, open: !b.setUp });
    }, () => sendJson(res, 400, { error: "bad request" }));
    return true;
  }
  return false;
}

const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 64 * 1024 });
wss.on("connection", (socket, req) => {
  const world = new URL(req.url ?? "/", "http://x").searchParams.get("world") || host.opts.defaultWorld;
  host.connect(socket, world.toLowerCase());
});
host.startIdleUnloading();
server.listen(PORT, () => console.log(`[server] listening on http://localhost:${PORT} (websocket /ws)${transcriber.available ? `; voice transcription via ${new URL(transcriber.url!).host}` : ""}${designer ? "; Claude designs /imagine requests" : ""}`));

// Console commands: type e.g. "time set night" or "modules".
if (process.stdin.isTTY) {
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => game.runCommand(null, line.replace(/^\//, "")));
}

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  console.log("[server] saving and shutting down…");
  await host.stopAll();
  server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
