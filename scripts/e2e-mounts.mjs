// Mounts end to end: summon a horse to ride, aim at it and right-click to climb on, gallop (faster
// than running), get off with C; then a dragon to ride: fly up and away. Screenshots (third
// person) in test-results/mounts/.
//   npm run build && node scripts/e2e-mounts.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://localhost:${PORT}`;
const out = "test-results/mounts";
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), "lfg2-mounts-"));
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
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const say = (t) => page.evaluate((x) => window.lfg.send({ t: "chat", text: x }), t);
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failed++; };
const lastChat = () => page.evaluate(() => [...document.querySelectorAll(".chat-line, .chat div")].map((d) => d.textContent).slice(-3).join(" | "));
const summon = async (what) => {
  await say("/aether fill"); await say("/aether shards 20");
  await say(`/summon ${what}`);
  for (let i = 0; i < 60; i++) {
    const id = await page.evaluate(() => { const v = [...window.lfg.entities.views.values()].find((v) => v.type.summon); return v ? v.id : null; });
    if (id !== null) return id;
    await sleep(500);
  }
  return null;
};
// Look at an entity and right-click it (the real way to climb on).
const climb = async (id) => {
  const v = await page.evaluate((id) => { const v = window.lfg.entities.views.get(id); return v && { x: v.pos.x, y: v.pos.y, z: v.pos.z, h: v.type.height }; }, id);
  if (!v) return false;
  // A spot nearby in the open, with a clear look at it.
  const spot = await page.evaluate((v) => {
    const w = window.lfg.world;
    for (const r of [2.2, 3, 4]) for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, x = v.x + Math.cos(a) * r, z = v.z + Math.sin(a) * r;
      for (const dy of [0, 1, 2, 3]) {
        const y = Math.floor(v.y) + dy;
        if ([0, 1, 2].every((h) => !w.getBlock(Math.floor(x), y + h, Math.floor(z)))) return { x, y, z };
      }
    }
    return null;
  }, v);
  if (!spot) return false;
  await page.evaluate(() => { window.lfg.player.flying = true; });
  await say(`/tp ${spot.x} ${spot.y} ${spot.z}`);
  await sleep(900);
  // Keep the crosshair on it (it may wander), and right-click once it's there.
  for (let i = 0; i < 30; i++) {
    const on = await page.evaluate((id) => {
      const g = window.lfg, b = g.player.body, v = g.entities.views.get(id);
      if (!v) return false;
      g.player.flying = true;
      g.player.yaw = Math.atan2(-(v.pos.x - b.x), -(v.pos.z - b.z));
      g.player.pitch = Math.atan2(v.pos.y + v.type.height * 0.5 - g.player.eyeY, Math.hypot(v.pos.x - b.x, v.pos.z - b.z));
      return g.target?.kind === "entity" && g.target.entity === id;
    }, id);
    if (on) break;
    await sleep(150);
  }
  // Hold the button until a frame has seen it (the software renderer here is slow).
  await page.mouse.down({ button: "right" });
  for (let i = 0; i < 20 && !(await page.evaluate(() => window.lfg.riding !== null)); i++) await sleep(200);
  await page.mouse.up({ button: "right" });
  for (let i = 0; i < 20; i++) {
    if (await page.evaluate(() => !!window.lfg.player.mount)) {
      if (!(await page.evaluate(() => window.lfg.locked))) { console.log("  (pointer unlocked after right-click; locking again)"); await page.mouse.click(400, 250); await sleep(400); }
      return true;
    }
    await sleep(250);
  }
  return false;
};
try {
  await page.goto(`${BASE}/?name=Rider&autoplay`);
  await page.waitForFunction(() => window.lfg && window.lfg.world.meshCount > 30, null, { timeout: 90000, polling: 250 });
  await page.evaluate(() => { window.lfg.ui.toggleHelp(); window.lfg.ui.setSteps(null); });
  await page.mouse.click(400, 250); // lock the pointer
  await sleep(500);
  await say("/gamemode creative");
  await say("/time set noon");
  // A flat stone arena in the open air above spawn, so terrain doesn't get in the way.
  const base = await page.evaluate(() => { const b = window.lfg.player.body; return { x: Math.floor(b.x), y: Math.floor(b.y) + 14, z: Math.floor(b.z) }; });
  await say(`/fill ${base.x - 20} ${base.y - 1} ${base.z - 20} ${base.x + 20} ${base.y - 1} ${base.z + 20} stone`);
  await say(`/fill ${base.x - 20} ${base.y} ${base.z - 20} ${base.x + 20} ${base.y + 10} ${base.z + 20} air`);
  await sleep(800);
  await say(`/tp ${base.x + 0.5} ${base.y + 0.5} ${base.z + 0.5}`);
  await sleep(1500);
  const horse = await summon(process.env.HORSE ?? "a horse to ride");
  check(horse !== null, "a horse to ride arrived");
  // How far you run on foot in the same time (same slow frames), to compare the horse with.
  const run = async (ms) => {
    await page.evaluate(() => { window.lfg.player.flying = false; window.lfg.player.pitch = 0; });
    await page.keyboard.down("ShiftLeft"); await page.keyboard.down("KeyW");
    let top = 0;
    for (let t = 0; t < ms; t += 250) { await sleep(250); top = Math.max(top, await page.evaluate(() => { const b = window.lfg.player.body; return Math.hypot(b.vx, b.vz); })); }
    await page.keyboard.up("KeyW"); await page.keyboard.up("ShiftLeft");
    return top;
  };
  await say("/gamemode survival");
  await sleep(500);
  const onFoot = await run(3000);
  await say("/gamemode creative");
  await sleep(1500);
  check(await climb(horse), `climbed on with a right-click (${await lastChat()})`);
  await page.evaluate(() => { window.lfg.player.yaw = Math.PI; });
  const gone = await run(3000);
  console.log(`  top speed sprinting on foot: ${onFoot.toFixed(1)} blocks/s; galloping: ${gone.toFixed(1)} blocks/s`);
  check(gone > onFoot * 1.4, "the horse is faster than running");
  // The horse stays under its rider (on the server too).
  await sleep(800);
  const gap = await page.evaluate((id) => { const g = window.lfg, v = g.entities.views.get(id), b = g.player.body; return Math.hypot(v.target.x - b.x, v.target.z - b.z); }, horse);
  check(gap < 1.5, `the horse is under you (server has it ${gap.toFixed(2)} blocks away)`);
  await page.keyboard.down("KeyV"); await sleep(400); await page.keyboard.up("KeyV"); // third person
  await sleep(1200);
  await page.evaluate(() => { window.lfg.player.pitch = -0.45; window.lfg.ui.setSteps(null); });
  await sleep(1500);
  await page.screenshot({ path: join(out, "1-horse.png") });
  if (!(await page.evaluate(() => window.lfg.locked))) { await page.mouse.click(400, 250); await sleep(400); }
  await page.keyboard.down("KeyC");
  for (let i = 0; i < 20 && (await page.evaluate(() => window.lfg.riding !== null)); i++) await sleep(200);
  await page.keyboard.up("KeyC");
  check(await page.evaluate(() => window.lfg.riding === null && !window.lfg.player.mount), "C gets you off");
  await say("/unsummon");
  await sleep(800);

  await sleep(1500);
  const dragon = await summon("a dragon to ride");
  check(dragon !== null, `a dragon to ride arrived (${await lastChat()})`);
  await sleep(1500);
  check(await climb(dragon), `climbed onto the dragon (${await lastChat()})`);
  const y0 = await page.evaluate(() => window.lfg.player.body.y);
  await page.evaluate(() => { window.lfg.player.pitch = 0.5; });
  await page.keyboard.down("KeyW");
  for (let i = 0; i < 40 && (await page.evaluate((y0) => window.lfg.player.body.y - y0, y0)) < 5; i++) await sleep(300);
  await page.keyboard.up("KeyW");
  const y1 = await page.evaluate(() => window.lfg.player.body.y);
  check(y1 - y0 > 4, `the dragon flies where you look (climbed ${(y1 - y0).toFixed(1)} blocks)`);
  await page.evaluate(() => { window.lfg.player.pitch = -0.35; window.lfg.ui.setSteps(null); });
  await sleep(1500);
  await page.screenshot({ path: join(out, "2-dragon.png") });
  check(errors.length === 0, errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
} finally {
  await browser.close();
  try { process.kill(-server.pid, "SIGINT"); } catch {}
  await sleep(500);
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
