// Coloured light at night: a little wall with a torch, a lantern, a frost lamp, a crystal and neon,
// each washing the stone around it in its own colour. Screenshots in test-results/light/.
//   npm run build && node scripts/light-shots.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://localhost:${PORT}`;
const out = process.env.OUT ?? "test-results/light";
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), "lfg2-light-"));
const server = spawn("npx", ["tsx", "packages/server/src/index.ts"], {
  env: { ...process.env, ANTHROPIC_API_KEY: "", PORT: String(PORT), DATA_DIR: dataDir, SEED: process.env.SEED ?? "3", VIEW_DISTANCE: "3", PUBLIC_URL: BASE },
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
  await page.waitForFunction(() => window.lfg && window.lfg.world.meshCount > 20, null, { timeout: 90000, polling: 250 });
  await page.evaluate(() => { window.lfg.ui.toggleHelp(); window.lfg.ui.setSteps(null); });
  await say("/gamemode creative");
  await say("/time set midnight");
  await say("/weather clear");
  const b = await page.evaluate(() => { const p = window.lfg.player.body; return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }; });
  // A wall 7 blocks north of the player, 15 wide and 4 high, on a stone floor; lights in front of it.
  const z0 = b.z - 7, y0 = b.y + 6;
  const X = (d) => b.x + d, Z = (d) => z0 + d;
  const cmds = [
    `/fill ${X(-8)} ${y0 - 1} ${Z(-2)} ${X(8)} ${y0 - 1} ${Z(8)} stone_bricks`,
    `/fill ${X(-8)} ${y0} ${Z(-1)} ${X(8)} ${y0 + 6} ${Z(8)} air`,
    `/fill ${X(-8)} ${y0} ${Z(-1)} ${X(8)} ${y0 + 4} ${Z(-1)} stone_bricks`,
  ];
  const lights = ["torch", "lantern", "frost_lamp", "crystal", "neon_pink", "neon_green", "neon_blue"];
  lights.forEach((l, i) => cmds.push(`/setblock ${X(-6 + i * 2)} ${y0} ${Z(0)} ${l}`));
  for (const c of cmds) { await say(c); await sleep(150); }
  await sleep(2500);
  await say(`/tp ${b.x + 0.5} ${y0 + 1.5} ${z0 + 7.5}`);
  await sleep(1500);
  await page.evaluate(() => { const g = window.lfg; g.player.flying = true; g.player.yaw = 0; g.player.pitch = -0.25; });
  console.log("at", JSON.stringify(b), "wall z", z0, "y", y0, "player", await page.evaluate(() => { const p = window.lfg.player.body; return [p.x, p.y, p.z].map((v) => v.toFixed(1)).join(" "); }));
  await sleep(3000);
  await page.screenshot({ path: join(out, "1-night-lights.png") });
  console.log("  1-night-lights");
  await say("/time set noon");
  await sleep(2500);
  await page.screenshot({ path: join(out, "2-noon-lights.png") });
  console.log("  2-noon-lights");
  console.log(errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
} finally {
  await browser.close();
  try { process.kill(-server.pid, "SIGINT"); } catch {}
  await sleep(500);
  rmSync(dataDir, { recursive: true, force: true });
}
