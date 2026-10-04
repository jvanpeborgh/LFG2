// Exploring and fighting: find a ruin near spawn and look at it in the evening light, open its
// chest, then land an ordinary and a critical hit on a summoned creature. Screenshots in
// test-results/ruins/.
//   npm run build && node scripts/e2e-ruins.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://localhost:${PORT}`;
const out = process.env.OUT ?? "test-results/ruins";
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), "lfg2-ruins-"));
const server = spawn("npx", ["tsx", "packages/server/src/index.ts"], {
  env: { ...process.env, ANTHROPIC_API_KEY: "", PORT: String(PORT), DATA_DIR: dataDir, SEED: process.env.SEED ?? "3", VIEW_DISTANCE: "4", PUBLIC_URL: BASE },
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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const say = (t) => page.evaluate((x) => window.lfg.send({ t: "chat", text: x }), t);
try {
  await page.goto(`${BASE}/?name=Iris&autoplay`);
  await page.waitForFunction(() => window.lfg && window.lfg.world.meshCount > 30, null, { timeout: 90000, polling: 250 });
  await page.evaluate(() => { window.lfg.ui.toggleHelp(); window.lfg.ui.setSteps(null); });
  await say("/gamemode creative");
  const ruin = await page.evaluate(() => {
    const g = window.lfg, w = g.world, b = g.player.body, chest = g.reg.blocks.find((d) => d.name === "chest").id;
    let best = null;
    for (let x = Math.floor(b.x) - 120; x < b.x + 120; x++) for (let z = Math.floor(b.z) - 120; z < b.z + 120; z++)
      for (let y = 45; y < 110; y++) if (w.getBlock(x, y, z) === chest) { const d = Math.hypot(x - b.x, z - b.z); if (!best || d < best.d) best = { x, y, z, d }; }
    return best;
  });
  console.log(`nearest ruin: ${JSON.stringify(ruin)}`);
  let failed = !ruin;
  if (ruin) {
    await say("/time set 0.42");
    await say("/time set dusk");
    await say(`/tp ${ruin.x + 9.5} ${ruin.y + 5} ${ruin.z + 9.5}`);
    await sleep(2500);
    await page.evaluate((r) => { const g = window.lfg, b = g.player.body; g.player.flying = true; const dx = r.x + 0.5 - b.x, dz = r.z + 0.5 - b.z, dy = r.y - (b.y + 1.62); g.player.yaw = Math.atan2(-dx, -dz); g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz)); }, ruin);
    await sleep(1500);
    await page.screenshot({ path: join(out, "1-ruin.png") });
    // Open the chest (as a click on it would).
    await say(`/tp ${ruin.x + 0.5} ${ruin.y} ${ruin.z + 2.5}`);
    await sleep(1200);
    await page.evaluate((r) => window.lfg.send({ t: "useBlock", x: r.x, y: r.y, z: r.z }), ruin);
    await sleep(1200);
    const chat = await page.evaluate(() => [...document.querySelectorAll(".chat-line")].map((e) => e.textContent).join("\n"));
    console.log(/old cache/.test(chat) ? "✓ the ruin's chest had loot" : "✗ no loot message"); if (!/old cache/.test(chat)) failed = true;
    await page.screenshot({ path: join(out, "2-chest.png") });
  }
  // Damage numbers: hit a summoned pig, once on the ground and once falling (critical).
  await page.evaluate(() => { const g = window.lfg; if (g.ui.windowOpen) g.ui.closeWindow?.(); });
  await page.keyboard.press("Escape");
  await say("/time set noon");
  await say("/gamemode survival");
  await say("/summon a pig");
  await sleep(3500);
  const pig = await page.evaluate(() => { const v = [...window.lfg.entities.views.values()].find((v) => v.type.summon); return v ? { id: v.id, x: v.pos.x, y: v.pos.y, z: v.pos.z } : null; });
  if (pig) {
    await say(`/tp ${pig.x + 2} ${pig.y + 0.2} ${pig.z}`);
    await sleep(800);
    await page.evaluate((p) => { const g = window.lfg, b = g.player.body; const dx = p.x - b.x, dz = p.z - b.z; g.player.yaw = Math.atan2(-dx, -dz); g.player.pitch = -0.2; g.send({ t: "attack", entity: p.id }); }, pig);
    await sleep(500);
    // A falling hit: jump, then strike on the way down.
    await page.evaluate(() => { window.lfg.player.body.vy = 6; });
    await sleep(450);
    await page.evaluate((p) => window.lfg.send({ t: "attack", entity: p.id }), pig);
    await sleep(150);
    await page.screenshot({ path: join(out, "3-hits.png") });
    const nums = await page.evaluate(() => window.lfg.renderer.numbers.length);
    console.log(nums > 0 ? `✓ damage numbers shown (${nums})` : "✗ no damage numbers"); if (!nums) failed = true;
  } else { console.log("✗ no pig"); failed = true; }
  console.log(errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
  process.exitCode = failed || errors.length ? 1 : 0;
} finally {
  await browser.close();
  try { process.kill(-server.pid, "SIGINT"); } catch {}
  await sleep(500);
  rmSync(dataDir, { recursive: true, force: true });
}
