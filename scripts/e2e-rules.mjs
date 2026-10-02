// End-to-end: change rules and add code while two players are in the world.
// Checks that every change reaches the other player live, that nobody is
// disconnected, and that a broken module is undone automatically.
//
//   npm run build && node scripts/e2e-rules.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = 8000 + Math.floor(Math.random() * 900);
const out = process.env.E2E_OUT ?? "test-results";
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), "lfg2-e2e-rules-"));
const server = spawn("npx", ["tsx", "packages/server/src/index.ts"], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, SEED: process.env.SEED ?? "42", VIEW_DISTANCE: "3", EVENT_PACING: "fast" },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));
const stopServer = () => { try { process.kill(-server.pid, "SIGINT"); } catch { /* gone */ } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (ok, what) => { results.push(`${ok ? "✓" : "✗"} ${what}`); console.log(`${ok ? "✓" : "✗"} ${what}`); if (!ok) failed = true; };
let failed = false;

for (let i = 0; i < 60 && !serverLog.includes("listening"); i++) await sleep(250);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const errors = [];
const open = async (name) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(`http://localhost:${PORT}/?name=${name}&autoplay`);
  await page.waitForFunction(() => window.lfg && window.lfg.world.meshCount > 30, null, { timeout: 90000, polling: 250 });
  return page;
};
const say = (page, text) => page.evaluate((t) => window.lfg.send({ t: "chat", text: t }), text);
const banner = (page) => page.evaluate(() => document.querySelector(".banner")?.innerText ?? "");
const waitBanner = (page, re, timeout = 30000) =>
  page.waitForFunction((src) => new RegExp(src).test(document.querySelector(".banner")?.innerText ?? ""), re.source, { timeout, polling: 200 });

try {
  const a = await open("Alice");
  const b = await open("Bob");
  // Give them a nice view: noon, Bob looking out over the land.
  await say(a, "/time set noon");
  await b.evaluate(() => { window.lfg.player.pitch = -0.3; window.lfg.player.yaw = 2.2; });
  await b.bringToFront();
  await sleep(1500);
  await b.screenshot({ path: join(out, "rules-1-before.png") });

  // 1) A rule change: the leaf colour (a palette value). Bob should see the world restyle.
  await say(a, "/rule set art.palette.green2 #c04090");
  await waitBanner(b, /Palette green2/);
  const gathering = await banner(b);
  check(/arrives in/.test(gathering), `Bob sees the change gathering: "${gathering.replace(/\n/g, " · ")}"`);
  await b.waitForFunction(() => window.lfg.std.art.palette.green2 === "#c04090", null, { timeout: 20000, polling: 200 });
  check(true, "the new palette value reached Bob's client");
  await sleep(1500);
  await b.screenshot({ path: join(out, "rules-2-pink-leaves.png") });

  // 2) A physics rule: jump height. Bob's own client simulates it.
  const jump = async () => b.evaluate(async () => {
    const g = window.lfg;
    g.locked = true;
    let start = g.player.body.y, max = start;
    g.keys.add("Space");
    const t0 = performance.now();
    while (performance.now() - t0 < 1500) { max = Math.max(max, g.player.body.y); await new Promise((r) => setTimeout(r, 16)); }
    g.keys.delete("Space");
    g.locked = false;
    return max - start;
  });
  const before = await jump();
  await say(a, "/rule set balance.player.jumpBlocks 4");
  await b.waitForFunction(() => window.lfg.std.balance.player.jumpBlocks === 4, null, { timeout: 30000, polling: 200 });
  await sleep(500);
  const after = await jump();
  check(after > before * 2, `Bob's jump went from ${before.toFixed(2)} to ${after.toFixed(2)} blocks`);

  // 3) Code: a new module arrives without a restart.
  await say(a, "/module install chicken-rain");
  await waitBanner(b, /chicken-rain/);
  await b.waitForFunction(() => /Chicken rain/.test(document.querySelector(".banner")?.innerText ?? "") && document.querySelector(".banner").classList.contains("arrival"), null, { timeout: 30000, polling: 200 });
  check(true, "the chicken-rain module arrived for Bob");

  // 4) Broken code: arrives, starts failing, gets undone automatically.
  await say(a, "/module install broken-on-purpose");
  await b.waitForFunction(() => document.querySelector(".banner")?.classList.contains("undo") && /Unstable portal/.test(document.querySelector(".banner").innerText), null, { timeout: 60000, polling: 200 });
  const undo = await banner(b);
  check(/by Alice/.test(undo), "the event credits Alice, who installed it");
  check(true, `the broken module was undone automatically: "${undo.replace(/\n/g, " · ")}"`);
  await b.screenshot({ path: join(out, "rules-3-auto-undo.png") });

  // 5) Undo the palette change: the grass goes back.
  await say(a, "/rule undo");
  await say(a, "/rule undo");
  await b.waitForFunction(() => window.lfg.std.art.palette.green2 !== "#c04090", null, { timeout: 30000, polling: 200 });
  check(true, "undoing restored the original leaf colour for Bob");

  // Nobody was disconnected, no page errors.
  const connected = await Promise.all([a, b].map((p) => p.evaluate(() => window.lfg.ws.readyState === 1)));
  check(connected.every(Boolean), "both players stayed connected the whole time");
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
  const events = await a.evaluate(() => new Promise((resolve) => {
    const g = window.lfg;
    const before = document.querySelectorAll(".chat-line").length;
    g.send({ t: "chat", text: "/events" });
    setTimeout(() => resolve([...document.querySelectorAll(".chat-line")].slice(before).map((e) => e.textContent).join("\n")), 800);
  }));
  console.log(`\n/events on Alice's screen:\n${events}`);
} catch (err) {
  check(false, err?.stack ?? String(err));
} finally {
  await browser.close();
  stopServer();
  await sleep(800);
  rmSync(dataDir, { recursive: true, force: true });
  if (failed) console.log(`--- server log ---\n${serverLog}`);
  console.log(failed ? "E2E RULES FAILED" : `E2E RULES OK — screenshots in ${out}/`);
  process.exit(failed ? 1 : 0);
}
