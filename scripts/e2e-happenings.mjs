// Happenings in the browser: low gravity makes your jump about three times as high, the HUD shows
// it with a countdown, and /happen stop puts gravity back. Screenshot in test-results/happenings/.
//   npm run build && node scripts/e2e-happenings.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://localhost:${PORT}`;
const out = "test-results/happenings";
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), "lfg2-happen-"));
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
const say = (t) => page.evaluate((x) => window.lfg.send({ t: "chat", text: x }), t);
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failed++; };
// Jump in place (simulated input, the same physics): how high do the feet go?
const jumpHeight = () => page.evaluate(() => {
  const g = window.lfg, p = g.player, b = p.body, y0 = b.y;
  let top = y0;
  for (let i = 0; i < 240; i++) { p.update(1 / 60, { forward: 0, strafe: 0, jump: i < 2, sprint: false, down: false }, g.world, g.table); top = Math.max(top, b.y); }
  return top - y0;
});
try {
  await page.goto(`${BASE}/?name=Hopper&autoplay`);
  await page.waitForFunction(() => window.lfg && window.lfg.world.meshCount > 20, null, { timeout: 90000, polling: 250 });
  await page.evaluate(() => { window.lfg.ui.toggleHelp(); window.lfg.ui.setSteps(null); });
  await sleep(1500);
  const normal = await jumpHeight();
  await say("/happen low gravity for 3 minutes");
  await page.waitForFunction(() => document.querySelector(".happening.show"), null, { timeout: 10000 });
  await sleep(500);
  const low = await jumpHeight();
  console.log(`  jump: ${normal.toFixed(2)} blocks normally, ${low.toFixed(2)} in low gravity`);
  check(low > normal * 2.2, "low gravity: you jump far higher");
  const hud = await page.evaluate(() => document.querySelector(".happening")?.textContent ?? "");
  check(/Low Gravity.*\d:\d\d left/.test(hud), `the HUD shows it with a countdown (${hud})`);
  await page.screenshot({ path: join(out, "low-gravity.png") });
  await say("/happen stop");
  await sleep(1500);
  const back = await jumpHeight();
  check(Math.abs(back - normal) < 0.15, `gravity is back (jump ${back.toFixed(2)})`);
  check(await page.evaluate(() => !document.querySelector(".happening.show")), "the HUD goes");
  check(errors.length === 0, errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
} finally {
  await browser.close();
  try { process.kill(-server.pid, "SIGINT"); } catch {}
  await sleep(500);
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
