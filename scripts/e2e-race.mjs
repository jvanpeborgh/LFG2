// A kart race in the browser: /race lays a course near you, puts you in a kart on the grid, counts
// down and lets you race; screenshots of the grid, the countdown and the course from above in
// test-results/race/.
//   npm run build && node scripts/e2e-race.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://localhost:${PORT}`;
const out = "test-results/race";
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), "lfg2-race-"));
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
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const say = (t) => page.evaluate((x) => window.lfg.send({ t: "chat", text: x }), t);
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failed++; };
try {
  await page.goto(`${BASE}/?name=Racer&autoplay`);
  await page.waitForFunction(() => window.lfg && window.lfg.world.meshCount > 30, null, { timeout: 90000, polling: 250 });
  await page.evaluate(() => { window.lfg.ui.toggleHelp(); window.lfg.ui.setSteps(null); window.lfg.renderer.setShadows(false); });
  await say("/time set noon");
  await page.mouse.click(480, 270);
  await sleep(500);
  await say("/race a mario kart course, 2 laps");
  for (let i = 0; i < 60 && !(await page.evaluate(() => window.lfg.riding !== null)); i++) await sleep(500);
  check(await page.evaluate(() => window.lfg.player.mount?.mode === "drive"), "in a kart on the grid");
  await page.keyboard.down("KeyV"); await sleep(400); await page.keyboard.up("KeyV");
  await page.evaluate(() => { window.lfg.player.pitch = -0.3; });
  await sleep(1200);
  await page.evaluate(() => window.lfg.ui.setSteps(null));
  await page.screenshot({ path: join(out, "1-grid.png") });
  for (let i = 0; i < 40 && !(await page.evaluate(() => document.querySelector(".race-count.show.go") || document.querySelector(".race .race-time"))); i++) await sleep(250);
  check(await page.evaluate(() => !!document.querySelector(".race .race-time")), "the race HUD shows lap, place and time");
  await page.keyboard.down("KeyW");
  await sleep(3000);
  await page.evaluate(() => window.lfg.ui.setSteps(null));
  await page.screenshot({ path: join(out, "2-racing.png") });
  await page.keyboard.up("KeyW");
  const hud = await page.evaluate(() => document.querySelector(".race")?.textContent ?? "");
  console.log(`  HUD: ${hud}`);
  check(/Lap 1\/2/.test(hud), "on lap 1 of 2");
  // A boost (from a pad or a mushroom) takes the kart past its top speed; a shell spins it out.
  const top = await page.evaluate(() => window.lfg.player.mount.speed);
  await page.evaluate(() => window.lfg.player.kartEffect("boost", 2, 1.6));
  await page.keyboard.down("KeyW");
  let boosted = 0;
  for (let i = 0; i < 6; i++) { boosted = Math.max(boosted, await page.evaluate(() => window.lfg.player.speed)); await sleep(100); }
  await page.keyboard.up("KeyW");
  check(boosted > top * 1.1, `a boost goes past top speed (${boosted.toFixed(1)} > ${top.toFixed(1)})`);
  await page.evaluate(() => window.lfg.player.kartEffect("spin", 1.2));
  await sleep(300);
  check(await page.evaluate(() => Math.abs(window.lfg.player.speed)) < top * 0.5, "a shell spins it out");
  // Item boxes and pads are on the course: find one and look at it close up.
  const spot = await page.evaluate(() => {
    const w = window.lfg.world, reg = window.lfg.reg, b = window.lfg.player.body;
    const box = reg.blockId("item_box");
    let best = null, bd = Infinity;
    for (let dx = -60; dx <= 60; dx++) for (let dz = -60; dz <= 60; dz++) for (let dy = -4; dy <= 4; dy++) {
      const x = Math.floor(b.x) + dx, y = Math.floor(b.y) + dy, z = Math.floor(b.z) + dz;
      if (w.getBlock(x, y, z) === box && dx * dx + dz * dz < bd) { bd = dx * dx + dz * dz; best = [x, y, z]; }
    }
    return best;
  });
  check(!!spot, `an item box on the course${spot ? ` at ${spot.join(", ")}` : ""}`);
  // The course from above.
  await page.keyboard.down("KeyC"); await sleep(800); await page.keyboard.up("KeyC");
  await say("/gamemode creative");
  const c = await page.evaluate(() => { const b = window.lfg.player.body; return [b.x, b.y, b.z]; });
  await page.evaluate(() => { window.lfg.player.flying = true; });
  await say(`/tp ${c[0]} ${c[1] + 34} ${c[2] + 26}`);
  await page.keyboard.down("KeyV"); await sleep(400); await page.keyboard.up("KeyV");
  await page.evaluate(() => { window.lfg.player.pitch = -0.9; window.lfg.player.yaw = 0; window.lfg.player.flying = true; });
  await sleep(3000);
  await page.evaluate(() => window.lfg.ui.setSteps(null));
  await page.screenshot({ path: join(out, "3-course.png") });
  if (spot) {
    await say(`/tp ${spot[0] + 0.5} ${spot[1] + 2} ${spot[2] + 6.5}`);
    await page.evaluate(() => { window.lfg.player.pitch = -0.35; window.lfg.player.yaw = 0; window.lfg.player.flying = true; });
    await sleep(2500);
    await page.evaluate(() => window.lfg.ui.setSteps(null));
    await page.screenshot({ path: join(out, "4-item-boxes.png") });
  }
  await say("/race stop");
  await sleep(1500);
  check(await page.evaluate(() => !document.querySelector(".race.show")), "/race stop ends it and the HUD goes");
  check(errors.length === 0, errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
} finally {
  await browser.close();
  try { process.kill(-server.pid, "SIGINT"); } catch {}
  await sleep(500);
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
