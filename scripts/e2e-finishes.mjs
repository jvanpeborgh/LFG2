// Block finishes in the browser: blocks of iron and gold, ice, glass and crystal in low sun (the
// highlights), then ores in the dark (their flecks glint and glow). test-results/finishes/.
//   npm run build && node scripts/e2e-finishes.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://localhost:${PORT}`;
const out = "test-results/finishes";
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), "lfg2-finish-"));
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
const page = await browser.newPage({ viewport: { width: 800, height: 480 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (process.env.DEBUG) console.log("  [page]", m.text()); });
const say = (t) => page.evaluate((x) => window.lfg.send({ t: "chat", text: x }), t);
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failed++; };
// Jump in place (simulated input, the same physics): how high do the feet go?
try {
  await page.goto(`${BASE}/?name=Shiner&autoplay`);
  await page.waitForFunction(() => window.lfg && window.lfg.world.meshCount > 20, null, { timeout: 90000, polling: 250 });
  await page.evaluate(() => { window.lfg.ui.toggleHelp(); window.lfg.ui.setSteps(null); });
  await say("/gamemode creative");
  const [x0, y0, z0] = await page.evaluate(() => { const b = window.lfg.player.body; return [Math.floor(b.x), Math.floor(b.y) + 12, Math.floor(b.z)]; });
  // A stone stage in the air, clear above.
  await say(`/fill ${x0 - 8} ${y0} ${z0 - 8} ${x0 + 14} ${y0} ${z0 + 8} stone`);
  await say(`/fill ${x0 - 8} ${y0 + 1} ${z0 - 8} ${x0 + 14} ${y0 + 8} ${z0 + 8} air`);
  const row = ["iron_block", "gold_block", "ice", "glass", "crystal", "diamond_ore", "gold_ore", "iron_ore"];
  for (let i = 0; i < row.length; i++) {
    await say(`/setblock ${x0 + 4} ${y0 + 1} ${z0 - 7 + i * 2} ${row[i]}`);
    await say(`/setblock ${x0 + 5} ${y0 + 1} ${z0 - 7 + i * 2} ${row[i]}`);
  }
  // Morning: the sun low in the east (+x); look east, across the blocks towards it.
  const day = await page.evaluate(() => window.lfg.dayLength);
  await say(`/time set ${Math.round(0.07 * day)}`);
  await say(`/tp ${x0 - 2} ${y0 + 3.5} ${z0}`);
  await page.evaluate(() => { const p = window.lfg.player; p.flying = true; p.yaw = -Math.PI / 2; p.pitch = -0.38; });
  await sleep(12000); // (the chat fades)
  await page.evaluate(() => window.lfg.ui.setSteps(null));
  await page.screenshot({ path: join(out, "1-morning.png") });
  // Night, no torch: the ores still show their flecks.
  await say(`/time set ${Math.round(0.75 * day)}`);
  await sleep(4000);
  await page.screenshot({ path: join(out, "2-night.png") });
  check(errors.length === 0, errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
} finally {
  await browser.close();
  try { process.kill(-server.pid, "SIGINT"); } catch {}
  await sleep(500);
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
