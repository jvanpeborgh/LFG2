// Sun shafts and storm clouds: facing a low morning sun through the trees (with the shafts, and
// with them off), and a thunderstorm rolling in. Screenshots in test-results/sky/.
//   npm run build && node scripts/sky-shots.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://localhost:${PORT}`;
const out = "test-results/sky";
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), "lfg2-sky-"));
const server = spawn("npx", ["tsx", "packages/server/src/index.ts"], {
  env: { ...process.env, ANTHROPIC_API_KEY: "", PORT: String(PORT), DATA_DIR: dataDir, SEED: process.env.SEED ?? "12", VIEW_DISTANCE: "4", PUBLIC_URL: BASE },
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
const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const say = (t) => page.evaluate((x) => window.lfg.send({ t: "chat", text: x }), t);
try {
  await page.goto(`${BASE}/?name=Iris&autoplay`);
  await page.waitForFunction(() => window.lfg && window.lfg.world.meshCount > 30, null, { timeout: 90000, polling: 250 });
  await page.evaluate(() => { window.lfg.ui.toggleHelp(); window.lfg.ui.setSteps(null); });
  await say("/gamemode creative");
  await say("/weather clear");
  const day = await page.evaluate(() => window.lfg.dayLength);
  await say(`/time set ${Math.round(day * 0.045)}`);
  await sleep(1500);
  // Up a little, facing the sun (east, +x), looking slightly up.
  await page.evaluate(() => { const g = window.lfg; g.player.flying = true; g.player.body.y += 4; g.player.yaw = -Math.PI / 2; g.player.pitch = 0.12; });
  await sleep(3000);
  console.log(await page.evaluate(() => JSON.stringify({ shafts: window.lfg.renderer.shafts?.uniforms.strength.value })));
  await page.evaluate(() => window.lfg.ui.setSteps(null));
  await page.screenshot({ path: join(out, "1-sun-shafts.png") });
  await page.evaluate(() => { window.lfg.renderer.shafts.enabled = false; });
  await sleep(800);
  await page.screenshot({ path: join(out, "2-no-shafts.png") });
  await page.evaluate(() => { window.lfg.renderer.shafts.enabled = true; });
  await say("/weather thunder");
  await say("/time set noon");
  await page.evaluate(() => { window.lfg.player.pitch = 0.35; });
  for (let i = 0; i < 40 && (await page.evaluate(() => window.lfg.renderer.weather.storm)) < 0.9; i++) await sleep(1000);
  console.log(await page.evaluate(() => JSON.stringify(window.lfg.renderer.weather)));
  await page.screenshot({ path: join(out, "3-storm.png") });
  console.log(errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
} finally {
  await browser.close();
  try { process.kill(-server.pid, "SIGINT"); } catch {}
  await sleep(500);
  rmSync(dataDir, { recursive: true, force: true });
}
