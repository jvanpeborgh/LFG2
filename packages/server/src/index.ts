import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { Game } from "./game";
import { VANILLA_MODULES } from "./modules";

const env = process.env;
const PORT = Number(env.PORT ?? 8080);
const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const CLIENT_DIST = resolve(ROOT, "packages/client/dist");

const game = new Game({
  modules: VANILLA_MODULES,
  dataDir: env.DATA_DIR ?? join(ROOT, "data"),
  worldName: env.WORLD ?? "world",
  seed: Number(env.SEED ?? Math.floor(Math.random() * 2 ** 31)),
  viewDistance: Number(env.VIEW_DISTANCE ?? 4),
  admins: (env.ADMINS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
});

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".wasm": "application/wasm",
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, fingerprint: game.reg.fingerprint(), ...game.stats() }));
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
wss.on("connection", (socket) => game.handleConnection(socket));

await game.init();
game.start();
server.listen(PORT, () => console.log(`[server] listening on http://localhost:${PORT} (websocket /ws)`));

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
  await game.stop();
  server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
