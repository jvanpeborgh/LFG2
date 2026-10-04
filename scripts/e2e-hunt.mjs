// A hunt in the browser: /hunt lets a boss loose far off; the HUD gives a clue; near it, its tracks
// show on the ground. Screenshots in test-results/hunt/.
//   npm run build && node scripts/e2e-hunt.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://localhost:${PORT}`;
const out = "test-results/hunt";
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), "lfg2-hunt-"));
const server = spawn("npx", ["tsx", "packages/server/src/index.ts"], {
  env: { ...process.env, ANTHROPIC_API_KEY: "", PORT: String(PORT), DATA_DIR: dataDir, SEED: "12", VIEW_DISTANCE: "5", PUBLIC_URL: BASE },
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
  await page.goto(`${BASE}/?name=Hunter&autoplay`);
  await page.waitForFunction(() => window.lfg && window.lfg.world.meshCount > 20, null, { timeout: 90000, polling: 250 });
  await page.evaluate(() => { window.lfg.ui.toggleHelp(); window.lfg.ui.setSteps(null); window.lfg.renderer.setShadows(false); });
  await say("/time set noon");
  await sleep(1500);
  await say("/hunt an angry wolf");
  for (let i = 0; i < 40 && !(await page.evaluate(() => document.querySelector(".scenario.hunt.show"))); i++) await sleep(250);
  const hud = await page.evaluate(() => document.querySelector(".scenario.hunt")?.textContent ?? "");
  console.log(`  HUD: ${hud}`);
  check(/Hunt: the .*Wolf/i.test(hud) && /north|south|east|west/.test(hud), "the hunt HUD names the quarry and gives a clue");
  await page.screenshot({ path: join(out, "1-hud.png") });
  // Let it roam a while, then go to it (as if we'd followed the trail).
  await sleep(15000);
  await say("/hunt where");
  await sleep(800);
  const where = await page.evaluate(() => [...document.querySelectorAll(".chat-line")].map((d) => d.textContent).reverse().find((t) => / is at -?\d+ -?\d+ -?\d+/.test(t ?? "")) ?? "");
  const m = / is at (-?\d+) (-?\d+) (-?\d+)/.exec(where);
  const at = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  check(!!at, `the quarry is out there${at ? ` (at ${at.map((v) => v.toFixed(0)).join(", ")})` : ""}`);
  if (at) {
    await say("/gamemode creative");
    await say(`/tp ${at[0] + 7} ${at[1] + 4} ${at[2] + 7}`);
    await sleep(4000);
    // Face it where it is now (it's in view range).
    await page.evaluate(() => {
      const p = window.lfg.player, b = p.body;
      const v = [...window.lfg.entities.views.values()].find((x) => /wolf/i.test(`${x.type.name} ${x.type.displayName ?? ""}`));
      p.flying = true;
      if (v) { const dx = v.pos.x - b.x, dz = v.pos.z - b.z; p.yaw = Math.atan2(-dx, -dz); p.pitch = -Math.atan2(b.y + 1.6 - v.pos.y, Math.hypot(dx, dz)); }
    });
    await sleep(1500);
    const n = await page.evaluate(() => window.lfg.renderer.tracks?.count ?? 0);
    check(n > 2, `its tracks show on the ground (${n} prints)`);
    const clue = await page.evaluate(() => document.querySelector(".hunt-clue")?.textContent ?? "");
    check(/Fresh tracks/.test(clue), `on its trail, the clue is exact (${clue})`);
    await page.evaluate(() => window.lfg.ui.setSteps(null));
    await page.screenshot({ path: join(out, "2-near.png") });
    // Looking down at the trail: from above the newest print, back along the way it came.
    const pr = await page.evaluate(() => {
      const t = window.lfg.renderer.tracks, n = t.count, m = new window.lfg.renderer.camera.matrix.constructor();
      const at = (i) => { t.getMatrixAt(i, m); return [m.elements[12], m.elements[13], m.elements[14]]; };
      return [at(Math.max(0, n - 6)), at(n - 1)];
    });
    const [a, b] = pr;
    const dx = a[0] - b[0], dz = a[2] - b[2];
    await say(`/tp ${b[0] + 0.5 - dx * 0.4} ${b[1] + 7} ${b[2] + 0.5 - dz * 0.4}`);
    await page.evaluate(([dx, dz]) => { const p = window.lfg.player; p.flying = true; p.yaw = Math.atan2(-dx, -dz); p.pitch = -0.7; }, [dx, dz]);
    await sleep(3000);
    await page.screenshot({ path: join(out, "2-tracks.png") });
  }
  await say("/hunt stop");
  await sleep(1500);
  check(await page.evaluate(() => !document.querySelector(".scenario.hunt.show")), "/hunt stop ends it and the HUD goes");
  check(errors.length === 0, errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
} finally {
  await browser.close();
  try { process.kill(-server.pid, "SIGINT"); } catch {}
  await sleep(500);
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
