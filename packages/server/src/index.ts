import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { VANILLA_MODULES } from "./modules";
import { Transcriber, handleTranscribe } from "./transcribe";
import { WorldHost } from "./host";
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
const host = new WorldHost({
  dataDir: DATA_DIR,
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
  if (url.pathname === "/api/worlds") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(host.list().filter((w) => w.open).map(({ name, title, description, owner, players }) => ({ name, title, description, owner, players }))));
    return;
  }
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
