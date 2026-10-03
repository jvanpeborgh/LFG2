// Idle life in game: a herd grazes, sits and sniffs by day and sleeps at night; a dog follows its
// summoner; a wolf roars when it spots a player. Screenshots of each pose.
//   npm run build && node scripts/e2e-actions.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://localhost:${PORT}`;
const out = process.env.OUT ?? "test-results/actions";
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), "lfg2-actions-"));
const server = spawn("npx", ["tsx", "packages/server/src/index.ts"], {
  env: { ...process.env, ANTHROPIC_API_KEY: "", PORT: String(PORT), DATA_DIR: dataDir, SEED: process.env.SEED ?? "11", VIEW_DISTANCE: "3", EVENT_PACING: "fast", PUBLIC_URL: BASE, ADMINS: "Iris" },
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
const say = (text) => page.evaluate((t) => window.lfg.send({ t: "chat", text: t }), text);
let failed = false;
try {
  await page.goto(`${BASE}/?name=Iris&autoplay`);
  await page.waitForFunction(() => window.lfg && window.lfg.world.meshCount > 30, null, { timeout: 90000, polling: 250 });
  await page.evaluate(() => window.lfg.ui.toggleHelp());
  await say("/time set noon"); await say("/xp level 30");
  // A clearing away from spawn (the safe zone).
  const spot = await page.evaluate(() => {
    const g0 = window.lfg, w = g0.world, b = g0.player.body;
    const plant = new Set(g0.reg.blocks.filter((d) => !d.solid && d.name !== "water").map((d) => d.id));
    const bad = new Set(g0.reg.blocks.filter((d) => /leaves|log|wood|water|ice/.test(d.name)).map((d) => d.id));
    const ground = (x, z) => { for (let y = 120; y > 0; y--) { const id = w.getBlock(x, y, z); if (id && !plant.has(id)) return bad.has(id) ? -1 : y; } return -1; };
    let best = null;
    for (let r = 30; r <= 46; r += 4) for (let a = 0; a < 24; a++) {
      const cx = Math.round(b.x + Math.cos((a / 24) * Math.PI * 2) * r), cz = Math.round(b.z + Math.sin((a / 24) * Math.PI * 2) * r);
      let lo = 999, hi = -1, ok = true;
      for (let dx = -6; dx <= 6 && ok; dx++) for (let dz = -6; dz <= 6 && ok; dz++) { const g = ground(cx + dx, cz + dz); if (g < 0) ok = false; lo = Math.min(lo, g); hi = Math.max(hi, g); if (hi - lo > 2) ok = false; }
      if (ok && (!best || hi - lo < best.d)) best = { x: cx, y: hi + 1, z: cz, d: hi - lo };
    }
    return best;
  });
  if (!spot) throw new Error("no clearing");
  const look = () => page.evaluate(() => {
    const g = window.lfg, vs = [...g.entities.views.values()].filter((v) => v.type.summon);
    if (!vs.length) return;
    const c = vs.reduce((s, v) => [s[0] + v.pos.x / vs.length, s[1] + v.pos.y / vs.length, s[2] + v.pos.z / vs.length], [0, 0, 0]);
    const b = g.player.body, dx = c[0] - b.x, dz = c[2] - b.z, dy = c[1] + 0.5 - (b.y + 1.62);
    g.player.yaw = Math.atan2(-dx, -dz); g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  });
  const actions = () => page.evaluate(() => [...window.lfg.entities.views.values()].filter((v) => v.type.summon).map((v) => v.action ?? null));
  const waitFor = async (want, ms, name) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      await look();
      const a = await actions();
      if (a.includes(want)) { await sleep(400); await look(); await page.screenshot({ path: join(out, `${name}.png`) }); console.log(`✓ ${name}: ${a.join(", ")}`); return true; }
      await sleep(250);
    }
    console.log(`✗ ${name}: never saw ${want}`); failed = true; return false;
  };
  await say("/gamemode creative");
  await say(`/tp ${spot.x + 0.5} ${spot.y + 0.2} ${spot.z + 0.5}`);
  await sleep(1200);
  await say("/summon three cows");
  await sleep(2500);
  // Step back so the herd is in frame.
  await say(`/tp ${spot.x + 7.5} ${spot.y + 2} ${spot.z + 7.5}`);
  await sleep(800);
  await waitFor("graze", 90000, "1-graze");
  await waitFor("sit", 60000, "2-sit");
  await say("/time set midnight");
  await waitFor("sleep", 40000, "3-sleep");
  await say("/time set noon");
  await say("/unsummon");
  // A dog that follows: walk off and check it keeps up.
  await say("/summon a dog");
  await sleep(2500);
  console.log(`  ${await say("/follow") ?? ""}`);
  await say("/follow");
  await say(`/tp ${spot.x + 0.5} ${spot.y + 3} ${spot.z + 30.5}`);
  await sleep(4000);
  const gap = await page.evaluate(() => { const g = window.lfg, v = [...g.entities.views.values()].find((v) => v.type.summon); return v ? Math.hypot(v.pos.x - g.player.body.x, v.pos.z - g.player.body.z) : 999; });
  console.log(`${gap < 10 ? "✓" : "✗"} the dog followed (${gap.toFixed(1)} blocks away after a 30-block jump)`);
  if (gap >= 10) failed = true;
  await say("/unsummon");
  // A wolf that roars on spotting a player in survival.
  await say(`/tp ${spot.x + 0.5} ${spot.y + 0.2} ${spot.z + 0.5}`);
  await sleep(1000);
  await say("/summon an angry wolf");
  await sleep(2500);
  await say(`/tp ${spot.x + 0.5} ${spot.y + 0.2} ${spot.z + 8.5}`);
  await say("/gamemode survival");
  await waitFor("roar", 15000, "4-roar");
  console.log(errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
  if (errors.length) failed = true;
} finally {
  await browser.close();
  try { process.kill(-server.pid, "SIGINT"); } catch {}
  await sleep(500);
  rmSync(dataDir, { recursive: true, force: true });
}
console.log(`screenshots in ${out}`);
process.exit(failed ? 1 : 0);
