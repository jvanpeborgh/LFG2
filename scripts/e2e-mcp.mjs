// End-to-end: a chat (an MCP client, standing in for ChatGPT or Claude) links to
// a player, refines and inscribes scrolls that appear in the browser's spellbook,
// the player casts one, and the chat creates a world with its own look that
// the player joins before opening it to everyone.
//   npm run build && node scripts/e2e-mcp.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://localhost:${PORT}`;
const out = process.env.E2E_OUT ?? "test-results";
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), "lfg2-e2e-mcp-"));
const server = spawn("npx", ["tsx", "packages/server/src/index.ts"], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, SEED: "42", VIEW_DISTANCE: "3", EVENT_PACING: "fast", PUBLIC_URL: BASE },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (ok, what) => { console.log(`${ok ? "✓" : "✗"} ${what}`); if (!ok) failed = true; };
for (let i = 0; i < 60 && !serverLog.includes("listening"); i++) await sleep(250);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const errors = [];
const open = async (name, world) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(`${BASE}/?name=${name}${world ? `&world=${world}` : ""}&autoplay`);
  await page.waitForFunction(() => window.lfg && window.lfg.world.meshCount > 20, null, { timeout: 90000, polling: 250 });
  await page.evaluate(() => window.lfg.ui.toggleHelp());
  return page;
};
const say = (page, text) => page.evaluate((t) => window.lfg.send({ t: "chat", text: t }), text);
const chat = (page) => page.evaluate(() => [...document.querySelectorAll(".chat-line")].map((e) => e.textContent).join("\n"));
const mcp = new Client({ name: "e2e-chat", version: "1.0.0" });
const call = async (name, args = {}) => {
  const r = await mcp.callTool({ name, arguments: args });
  const t = r.content[0].text;
  try { return { error: !!r.isError, data: JSON.parse(t) }; } catch { return { error: !!r.isError, data: t }; }
};

try {
  const a = await open("Alice");
  await say(a, "/time set noon");
  await say(a, "/xp level 12");
  await say(a, "/aether shards 10");
  await say(a, "/link");
  await sleep(500);
  const code = (await chat(a)).match(/link code: ([A-Z0-9]{3}-[A-Z0-9]{3})/)?.[1];
  check(!!code, `/link gave a code: ${code}`);
  await mcp.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`)));
  const linked = await call("link_player", { code });
  check(linked.data.player === "Alice", "the chat linked to Alice");

  // The chat refines a prompt by checking costs, then inscribes scrolls.
  const est = await call("estimate_cost", { prompt: "a red dragon" });
  check(est.data.tier === 3 && est.data.inscribe.aether === 7, `estimate: ${est.data.title} tier ${est.data.tier}, ${est.data.full.aether} aether to cast, ${est.data.inscribe.aether} to inscribe`);
  const s1 = await call("inscribe_scroll", { name: "dragon", prompt: "a red dragon" });
  const s2 = await call("inscribe_scroll", { name: "wizard", prompt: "the power of a wizard" });
  check(s1.data.ok && s2.data.ok, "two scrolls inscribed from the chat");
  await a.waitForFunction(() => window.lfg.ui.scrolls.length === 2, null, { timeout: 10000, polling: 200 });
  await a.evaluate(() => window.lfg.ui.toggleBook(true));
  await sleep(300);
  await a.screenshot({ path: join(out, "mcp-1-spellbook.png") });
  check(true, "they appear in Alice's spellbook (K)");
  // Cast one from the book.
  await a.click(".scroll button");
  await a.waitForFunction(() => { const b = document.querySelector(".banner"); return !!b && b.classList.contains("arrival") && b.innerText.includes("Dragon"); }, null, { timeout: 40000, polling: 200 });
  check(true, "casting the dragon scroll from the book summoned it");
  // And one from the chat (after a refill: the dragon used most of her aether).
  await say(a, "/aether fill");
  await sleep(300);
  const c2 = await call("cast_scroll", { name: "wizard" });
  check(/Wizard for 10 min/.test(c2.data.result), `cast from the chat: ${c2.data.result?.split("\n")[0]}`);

  // The chat creates a world with its own look, closed until it opens.
  const w = await call("create_world", { name: "neon-isles", title: "Neon Isles", description: "Glowing islands at dusk", preset: "neon", start_time: "dusk", rules: { "balance.player.jumpBlocks": 2 } });
  check(w.data.created?.open === false, `created ${w.data.created?.title}, closed for setup`);
  const b = await browser.newPage({ viewport: { width: 640, height: 360 } });
  await b.goto(`${BASE}/?name=Bob&world=neon-isles&autoplay`);
  await b.waitForFunction(() => /being set up/.test(document.getElementById("status").textContent), null, { timeout: 20000, polling: 250 });
  check(true, "Bob can't join it yet");
  const a2 = await open("Alice", "neon-isles");
  await sleep(2000);
  check(/Welcome to Neon Isles \(made by Alice\)/.test(await chat(a2)), "Alice (its creator) can, and is greeted");
  await a2.evaluate(() => { const g = window.lfg; g.player.pitch = -0.15; });
  await sleep(1500);
  await a2.screenshot({ path: join(out, "mcp-2-neon-world.png") });
  const opened = await call("open_world", { name: "neon-isles" });
  check(opened.data.opened === "neon-isles", "the chat opened it");
  await b.goto(`${BASE}/?name=Bob&world=neon-isles&autoplay`);
  await b.waitForFunction(() => window.lfg && window.lfg.world.meshCount > 10, null, { timeout: 90000, polling: 250 });
  check(true, "now Bob can join");
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
} catch (err) {
  check(false, err?.stack ?? String(err));
} finally {
  await mcp.close().catch(() => {});
  await browser.close();
  try { process.kill(-server.pid, "SIGINT"); } catch { /* gone */ }
  await sleep(800);
  rmSync(dataDir, { recursive: true, force: true });
  if (failed) console.log(`--- server log (tail) ---\n${serverLog.slice(-4000)}`);
  console.log(failed ? "E2E MCP FAILED" : `E2E MCP OK — screenshots in ${out}/`);
  process.exit(failed ? 1 : 0);
}
