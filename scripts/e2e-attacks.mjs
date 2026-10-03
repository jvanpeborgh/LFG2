// Attacks in game: a player in survival stands in a clearing while creatures with breath, shots,
// charges and stomps come for them. Screenshots of each warning and attack, and what the player took.
//   npm run build && node scripts/e2e-attacks.mjs ["a fire-breathing dragon" ...]
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const prompts = process.argv.slice(2).length ? process.argv.slice(2) : ["an angry fire-breathing wolf", "an angry skeleton archer", "an angry charging bull", "an angry stomping bear"];
const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://localhost:${PORT}`;
const out = process.env.OUT ?? "test-results/attacks";
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), "lfg2-attacks-"));
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
  for (const [k, prompt] of prompts.entries()) {
    await say("/gamemode creative"); await say("/unsummon");
    await say(`/tp ${spot.x + 0.5} ${spot.y + 0.2} ${spot.z + 0.5}`);
    await sleep(1200);
    await page.evaluate(() => { const g = window.lfg; g.player.flying = false; });
    await say(`/summon ${prompt}`);
    // Wait for it to arrive, then turn to face it and become huntable.
    let seen = false;
    for (let i = 0; i < 40 && !seen; i++) { seen = await page.evaluate(() => [...window.lfg.entities.views.values()].some((v) => v.type.summon && v.voxel)); await sleep(300); }
    await say("/gamemode survival");
    const shots = { warn: false, active: false };
    const t0 = Date.now();
    let health0 = await page.evaluate(() => window.lfg.ui.self?.health ?? 20);
    while (Date.now() - t0 < 14000 && !(shots.warn && shots.active)) {
      const st = await page.evaluate(() => {
        const g = window.lfg, v = [...g.entities.views.values()].find((v) => v.type.summon);
        if (!v) return null;
        const b = g.player.body, dx = v.pos.x - b.x, dz = v.pos.z - b.z, dy = v.pos.y + v.type.height / 2 - (b.y + 1.62);
        // Look at it from a step back and to the side so both are in frame.
        g.player.yaw = Math.atan2(-dx, -dz) + 0.25; g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
        const kind = (v.flags >> 7) & 7;
        return { kind, active: (v.flags & 64) !== 0, warn: (v.flags & 4) !== 0, name: v.type.summon.name, abilities: v.type.summon.abilities };
      });
      if (st?.kind && st.warn && !st.active && !shots.warn) { await sleep(250); await page.screenshot({ path: join(out, `${k + 1}-warn.png`) }); shots.warn = true; console.log(`  ${st.name} (${st.abilities.join(", ")}): warning`); }
      if (st?.kind && st.active && !shots.active) { await sleep(120); await page.screenshot({ path: join(out, `${k + 1}-attack.png`) }); shots.active = true; console.log(`  ${st.name}: attack`); }
      await sleep(60);
    }
    await sleep(1500);
    const health1 = await page.evaluate(() => window.lfg.ui.self?.health ?? 20);
    const ok = shots.warn && shots.active;
    if (!ok) failed = true;
    console.log(`${ok ? "✓" : "✗"} ${prompt}: warned ${shots.warn}, attacked ${shots.active}, health ${health0} → ${health1}`);
  }
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
