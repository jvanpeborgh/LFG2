// Arcs in the browser: a blood moon (the night turns red), a meteor shower (a meteor streaks down
// and leaves a crater of crystal), a harvest festival (lanterns and fireworks at spawn).
// Screenshots in test-results/arcs/.
//   npm run build && node scripts/e2e-arcs.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://localhost:${PORT}`;
const out = "test-results/arcs";
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), "lfg2-arcs-"));
const server = spawn("npx", ["tsx", "packages/server/src/index.ts"], {
  env: { ...process.env, ANTHROPIC_API_KEY: "", PORT: String(PORT), DATA_DIR: dataDir, SEED: "12", VIEW_DISTANCE: "4", PUBLIC_URL: BASE },
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
  await page.goto(`${BASE}/?name=Watcher&autoplay`);
  await page.waitForFunction(() => window.lfg && window.lfg.world.meshCount > 20, null, { timeout: 90000, polling: 250 });
  await page.evaluate(() => { window.lfg.ui.toggleHelp(); window.lfg.ui.setSteps(null); window.lfg.renderer.setShadows(false); });
  const day = await page.evaluate(() => window.lfg.dayLength);
  const at = (f) => say(`/time set ${Math.round(f * day)}`);
  await at(0.3);
  await sleep(1000);
  // Blood moon.
  await say("/arc a blood moon");
  await sleep(1500);
  check(/Blood Moon.*day 1 of 3/.test(await page.evaluate(() => document.querySelector(".happening.arc")?.textContent ?? "")), "the arc bar shows the blood moon, day 1 of 3");
  await say("/gamemode creative");
  // Up above the trees, to see the sky.
  const pos = await page.evaluate(() => { const b = window.lfg.player.body; return [b.x, b.y, b.z]; });
  await say(`/tp ${pos[0]} ${pos[1] + 30} ${pos[2]}`);
  await page.evaluate(() => { window.lfg.player.flying = true; });
  await at(0.8);
  await page.evaluate(() => { const p = window.lfg.player; p.flying = true; p.pitch = 0.35; p.yaw = Math.PI / 2; });
  await sleep(5000);
  const red = await page.evaluate(() => { const r = window.lfg.renderer, c = r.scene.background; console.log(`blood ${r.blood.toFixed(2)} target ${r.bloodTarget} sky ${c.r.toFixed(3)} ${c.g.toFixed(3)} ${c.b.toFixed(3)}`); return c.r > c.b * 1.5; });
  check(red, "the night sky turns red");
  await page.screenshot({ path: join(out, "blood-moon.png") });
  await say("/arc stop");
  await sleep(1000);
  // Meteor shower.
  await at(0.3);
  await sleep(500);
  await say("/arc a meteor shower");
  await at(0.8);
  await page.evaluate(() => { const p = window.lfg.player; p.pitch = 0.5; });
  let seen = false;
  for (let i = 0; i < 240 && !seen; i++) { seen = await page.evaluate(() => window.lfg.renderer.meteors.length > 0); if (!seen) await sleep(250); }
  check(seen, "a meteor streaks down");
  if (seen) {
    // Face it.
    // Look at it where it is, as it falls.
    await page.evaluate(() => {
      const m = window.lfg.renderer.meteors[0], p = window.lfg.player, b = p.body;
      const at = m.head.position.clone();
      const dx = at.x - b.x, dz = at.z - b.z, dy = at.y - (b.y + 1.6);
      p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    });
    await sleep(250);
    await page.screenshot({ path: join(out, "meteor.png") });
  }
  await sleep(3000);
  await say("/arc stop");
  await sleep(1000);
  // Festival, at dusk at spawn.
  await at(0.3);
  await say("/arc a harvest festival");
  await sleep(1000);
  await at(0.6);
  // Fireworks over the spawn: look up at the next one.
  let fw = null;
  for (let i = 0; i < 40 && !fw; i++) {
    fw = await page.evaluate(() => { const s = window.lfg.renderer.sparks; if (!s) return null; const i = (s.next - 1 + s.life.length) % s.life.length; return s.life[i] > 1 ? [s.pos[i * 3], s.pos[i * 3 + 1], s.pos[i * 3 + 2]] : null; });
    if (!fw) await sleep(250);
  }
  check(!!fw, "fireworks burst over the spawn");
  if (fw) await page.evaluate((f) => { const p = window.lfg.player, b = p.body; const dx = f[0] - b.x, dz = f[2] - b.z; p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(f[1] - b.y - 1.6, Math.hypot(dx, dz)) - 0.1; }, fw);
  await sleep(600);
  await page.screenshot({ path: join(out, "festival.png") });
  await say("/arc stop");
  await sleep(1000);
  check(await page.evaluate(() => !document.querySelector(".happening.arc.show")), "/arc stop ends it and the bar goes");
  check(errors.length === 0, errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
} finally {
  await browser.close();
  try { process.kill(-server.pid, "SIGINT"); } catch {}
  await sleep(500);
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
