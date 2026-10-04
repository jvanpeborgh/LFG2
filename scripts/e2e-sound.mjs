// The soundscape end to end: walking makes footsteps from the block underfoot, the probe hears an
// open hillside as open and a stone room as an enclosed, echoing cave, and nothing throws.
//   npm run build && node scripts/e2e-sound.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://localhost:${PORT}`;
const dataDir = mkdtempSync(join(tmpdir(), "lfg2-sound-"));
const server = spawn("npx", ["tsx", "packages/server/src/index.ts"], {
  env: { ...process.env, ANTHROPIC_API_KEY: "", PORT: String(PORT), DATA_DIR: dataDir, SEED: "3", VIEW_DISTANCE: "3", PUBLIC_URL: BASE },
  stdio: ["ignore", "pipe", "pipe"], detached: true,
});
let log = "";
server.stdout.on("data", (d) => (log += d)); server.stderr.on("data", (d) => (log += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 80 && !log.includes("listening"); i++) await sleep(250);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const say = (t) => page.evaluate((x) => window.lfg.send({ t: "chat", text: x }), t);
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failed++; };
try {
  await page.goto(`${BASE}/?name=Iris&autoplay`);
  await page.waitForFunction(() => window.lfg && window.lfg.world.meshCount > 20, null, { timeout: 90000, polling: 250 });
  await page.evaluate(() => {
    const g = window.lfg;
    g.audio.unlock();
    window.steps = [];
    window.path = 0;
    let last = [g.player.body.x, g.player.body.z];
    setInterval(() => { const b = g.player.body; window.path += Math.hypot(b.x - last[0], b.z - last[1]); last = [b.x, b.z]; }, 50);
    const step = g.audio.step.bind(g.audio);
    g.audio.step = (m, ...rest) => { window.steps.push(m); step(m, ...rest); };
  });
  await page.mouse.click(480, 270); // lock the pointer so keys move us
  await sleep(500);
  // Walk in a square, so a wall or the sea doesn't stop us.
  for (const yaw of [0, 1.57, 3.14, 4.71]) {
    await page.evaluate((y) => { window.lfg.player.yaw = y; }, yaw);
    await page.keyboard.down("KeyW");
    await sleep(1200);
    await page.keyboard.up("KeyW");
  }

  const { steps, path } = await page.evaluate(() => ({ steps: window.steps, path: window.path }));
  check(steps.length >= 2 && steps.length >= path / 2.6, `walking makes footsteps (${steps.length} over ${path.toFixed(1)} blocks: ${[...new Set(steps)].join(", ")})`);
  const open = await page.evaluate(() => ({ ...window.lfg.audio.env }));
  check(open.enclosed < 0.35 && open.cave < 0.3, `outside sounds open (enclosed ${open.enclosed.toFixed(2)}, cave ${open.cave.toFixed(2)})`);
  // Wall ourselves into a stone room.
  await page.evaluate(() => document.exitPointerLock());
  await say("/gamemode creative");
  const b = await page.evaluate(() => { const p = window.lfg.player.body; return { x: Math.floor(p.x), y: Math.floor(p.y) + 30, z: Math.floor(p.z) }; });
  await say(`/fill ${b.x - 4} ${b.y - 1} ${b.z - 4} ${b.x + 4} ${b.y + 4} ${b.z + 4} stone`);
  await sleep(300);
  await say(`/fill ${b.x - 3} ${b.y} ${b.z - 3} ${b.x + 3} ${b.y + 3} ${b.z + 3} air`);
  await sleep(300);
  await say(`/tp ${b.x + 0.5} ${b.y} ${b.z + 0.5}`);
  await sleep(2500);
  const room = await page.evaluate(() => ({ ...window.lfg.audio.env }));
  check(room.enclosed > 0.7 && room.roof && room.cave > 0.7, `a stone room sounds like a cave (enclosed ${room.enclosed.toFixed(2)}, cave ${room.cave.toFixed(2)}, room ${room.room.toFixed(1)})`);
  check(errors.length === 0, errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
} finally {
  await browser.close();
  try { process.kill(-server.pid, "SIGINT"); } catch {}
  await sleep(500);
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
