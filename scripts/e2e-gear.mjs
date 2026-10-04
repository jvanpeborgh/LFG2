// Creature gear in the browser: make a red dragon's gear (/loot), put it on (right-click each),
// see it on your model in third person, and read a piece's tooltip in the inventory.
// Screenshots in test-results/gear/.
//   npm run build && node scripts/e2e-gear.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://localhost:${PORT}`;
const out = "test-results/gear";
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), "lfg2-gear-"));
const server = spawn("npx", ["tsx", "packages/server/src/index.ts"], {
  env: { ...process.env, ANTHROPIC_API_KEY: "", PORT: String(PORT), DATA_DIR: dataDir, SEED: "12", VIEW_DISTANCE: "3", PUBLIC_URL: BASE },
  stdio: ["ignore", "pipe", "pipe"], detached: true,
});
let log = "";
server.stdout.on("data", (d) => (log += d)); server.stderr.on("data", (d) => (log += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 80 && !log.includes("listening"); i++) await sleep(250);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const say = (t) => page.evaluate((x) => window.lfg.send({ t: "chat", text: x }), t);
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failed++; };
try {
  await page.goto(`${BASE}/?name=Smith&autoplay`);
  await page.waitForFunction(() => window.lfg && window.lfg.world.meshCount > 20, null, { timeout: 90000, polling: 250 });
  await page.evaluate(() => { window.lfg.ui.toggleHelp(); window.lfg.ui.setSteps(null); });
  await say("/time set noon");
  // A clear stone floor in the air, away from the trees, for the camera.
  const base = await page.evaluate(() => { const b = window.lfg.player.body; return { x: Math.floor(b.x), y: Math.floor(b.y) + 14, z: Math.floor(b.z) }; });
  await say(`/fill ${base.x - 8} ${base.y - 1} ${base.z - 8} ${base.x + 8} ${base.y - 1} ${base.z + 8} stone_bricks`);
  await say(`/fill ${base.x - 8} ${base.y} ${base.z - 8} ${base.x + 8} ${base.y + 6} ${base.z + 8} air`);
  await sleep(600);
  await say(`/tp ${base.x + 0.5} ${base.y + 0.2} ${base.z + 0.5}`);
  await sleep(1200);
  for (const k of ["helm", "plate", "legs", "boots"]) { await say(`/loot an angry red dragon ${k}`); await sleep(300); }
  await say("/loot a shark sword");
  await sleep(1000);
  // Wear each armour piece: select it, right-click.
  for (const k of ["helm", "plate", "legs", "boots"]) {
    const slot = await page.evaluate((k) => window.lfg.ui.self.hotbar.findIndex((s) => s?.meta?.kind === k), k);
    await page.evaluate((i) => window.lfg.send({ t: "select", slot: i }), slot);
    await sleep(200);
    await page.evaluate(() => window.lfg.send({ t: "useItem" }));
    await sleep(400);
  }
  await sleep(800);
  const worn = await page.evaluate(() => Object.keys(window.lfg.myWear ?? {}));
  check(worn.length === 4, `wearing ${worn.join(", ")}`);
  // Hold the sword, third person, a look from the front.
  const sword = await page.evaluate(() => window.lfg.ui.self.hotbar.findIndex((s) => s?.meta?.kind === "sword"));
  await page.evaluate((i) => window.lfg.send({ t: "select", slot: i }), sword);
  await page.mouse.click(450, 280);
  await sleep(300);
  await page.keyboard.down("KeyV"); await sleep(300); await page.keyboard.up("KeyV");
  console.log("  at", await page.evaluate(() => { const b = window.lfg.player.body; return [b.x, b.y, b.z].map((v) => v.toFixed(1)).join(" "); }), "third person", await page.evaluate(() => window.lfg.thirdPerson));
  await page.evaluate(() => { window.lfg.player.pitch = -0.15; window.lfg.player.yaw = 0; });
  await sleep(1500);
  await page.screenshot({ path: join(out, "1-wearing.png") });
  // The inventory, and a piece's tooltip.
  await page.keyboard.down("KeyE"); await sleep(300); await page.keyboard.up("KeyE");
  await sleep(800);
  const box = await page.evaluate(() => {
    // The one in the inventory window (the HUD's hotbar has no tooltips).
    const slots = [...document.querySelectorAll(".grid .slot.gear, .hotbar-row .slot.gear")].filter((e) => e.getBoundingClientRect().width > 0);
    const r = slots[0]?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  });
  if (box) { await page.mouse.move(box.x, box.y); await sleep(500); }
  const tip = await page.evaluate(() => document.querySelector(".tooltip:not([hidden])")?.textContent ?? "");
  console.log(`  tooltip: ${tip}`);
  check(/Sharkfang|damage/.test(tip), "the tooltip shows the piece's name, stats and lore");
  await page.screenshot({ path: join(out, "2-tooltip.png") });
  check(errors.length === 0, errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
} finally {
  await browser.close();
  try { process.kill(-server.pid, "SIGINT"); } catch {}
  await sleep(500);
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
