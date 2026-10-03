// The in-game look: summon a few bestiary creatures in a default world (voxel style) and take
// screenshots of them together, in the world's own light. STYLE=sculpted switches the world's style.
//   npm run build && node scripts/showcase.mjs "a horse" "a fox" "a knight" ...
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const prompts = process.argv.slice(2).length ? process.argv.slice(2) : ["a horse", "a deer", "a fox", "a villager", "a wizard"];
const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://localhost:${PORT}`;
const out = process.env.OUT ?? "test-results/showcase";
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), "lfg2-showcase-"));
const server = spawn("npx", ["tsx", "packages/server/src/index.ts"], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, SEED: process.env.SEED ?? "7", VIEW_DISTANCE: "3", EVENT_PACING: "fast", PUBLIC_URL: BASE, ADMINS: "Iris" },
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
try {
  await page.goto(`${BASE}/?name=Iris&autoplay`);
  await page.waitForFunction(() => window.lfg && window.lfg.world.meshCount > 30, null, { timeout: 90000, polling: 250 });
  await page.evaluate(() => window.lfg.ui.toggleHelp());
  await say("/time set noon");
  await say("/xp level 30");
  await say("/gamemode creative");
  if (process.env.STYLE) await say(`/rule art.modelStyle ${process.env.STYLE}`);
  // Away from spawn (summons stay out of the safe zone), in a clearing: flat ground with nothing
  // standing on it for a dozen blocks around.
  const spot = await page.evaluate(() => {
    const g0 = window.lfg, w = g0.world, b = g0.player.body;
    const grass = g0.reg.blocks.find((d) => d.name === "grass")?.id;
    // Ground is the first block from the top; only grass counts (not water, sand or leaves).
    const plant = new Set(g0.reg.blocks.filter((d) => !d.solid && d.name !== "water").map((d) => d.id));
    const bad = new Set(g0.reg.blocks.filter((d) => /leaves|log|wood|water|ice/.test(d.name)).map((d) => d.id));
    const ground = (x, z) => { for (let y = 120; y > 0; y--) { const id = w.getBlock(x, y, z); if (id && !plant.has(id)) return bad.has(id) ? -1 : y; } return -1; };
    let best = null;
    for (let r = 26; r <= 46; r += 3) for (let a = 0; a < 36; a++) {
      const cx = Math.round(b.x + Math.cos((a / 36) * Math.PI * 2) * r), cz = Math.round(b.z + Math.sin((a / 36) * Math.PI * 2) * r);
      let lo = 999, hi = -1, ok = true;
      for (let dx = -5; dx <= 5 && ok; dx += 1) for (let dz = -5; dz <= 5 && ok; dz += 1) {
        const g = ground(cx + dx, cz + dz);
        if (g < 0) ok = false;
        lo = Math.min(lo, g); hi = Math.max(hi, g);
        if (hi - lo > 3) ok = false;
      }
      if (ok && (!best || hi - lo < best.d)) best = { x: cx, y: hi + 2, z: cz, d: hi - lo };
    }
    if (!best) return { debug: JSON.stringify([[0, 0], [10, 0], [30, 0], [0, 30], [-30, 0]].map(([dx, dz]) => { const x = Math.round(b.x + dx), z = Math.round(b.z + dz); let id = 0, y = 120; for (; y > 0; y--) { id = w.getBlock(x, y, z); if (id && !plant.has(id)) break; } return [dx, dz, y, g0.reg.blocks[id]?.name]; })) + ` at ${Math.round(b.x)} ${Math.round(b.y)} ${Math.round(b.z)}` };
    return best;
  });
  if (spot?.debug) console.log(spot.debug);
  console.log(`clearing: ${spot && !spot.debug ? `${spot.x} ${spot.y} ${spot.z} (height range ${spot.d})` : "none found, using 40 40"}`);
  await say(spot && !spot.debug ? `/tp ${spot.x} ${spot.y} ${spot.z}` : "/tp 40 40 40");
  await sleep(1500);
  await page.evaluate(() => { const g = window.lfg; g.player.creative = true; g.player.flying = false; });
  for (const p of prompts) { await say(`/summon ${p}`); await sleep(400); }
  // Wait for them to arrive.
  for (let i = 0; i < 60; i++) {
    const n = await page.evaluate(() => [...window.lfg.entities.views.values()].filter((v) => v.type.summon && v.voxel).length);
    if (n >= prompts.length) break;
    await sleep(500);
  }
  await sleep(2500);
  // Frame the group from three sides.
  for (const [k, ang] of [[1, 0.6], [2, 2.4], [3, 4.2]]) {
    await page.evaluate((a) => {
      const g = window.lfg;
      const vs = [...g.entities.views.values()].filter((v) => v.type.summon);
      if (!vs.length) return;
      const c = vs.reduce((s, v) => [s[0] + v.pos.x / vs.length, s[1] + v.pos.y / vs.length, s[2] + v.pos.z / vs.length], [0, 0, 0]);
      const spread = Math.max(4, ...vs.map((v) => Math.hypot(v.pos.x - c[0], v.pos.z - c[2]) + v.type.height));
      const r = spread * 1.6 + 3;
      g.player.flying = true;
      g.send({ t: "chat", text: `/tp ${(c[0] + Math.sin(a) * r).toFixed(1)} ${(c[1] + spread * 0.5 + 1).toFixed(1)} ${(c[2] + Math.cos(a) * r).toFixed(1)}` });
      setTimeout(() => {
        const b = g.player.body;
        const dx = c[0] - b.x, dz = c[2] - b.z, dy = c[1] + 0.6 - (b.y + 1.62);
        g.player.yaw = Math.atan2(-dx, -dz); g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      }, 700);
    }, ang);
    await sleep(1600);
    await page.screenshot({ path: join(out, `showcase-${k}.png`) });
  }
  console.log((await page.evaluate(() => [...document.querySelectorAll(".chat-line")].map((e) => e.textContent).join("\n"))).split("\n").slice(-8).join("\n"));
  const names = await page.evaluate(() => [...window.lfg.entities.views.values()].filter((v) => v.type.summon).map((v) => v.type.summon.name));
  console.log(`summoned: ${names.join(", ")}`);
  console.log(errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
} finally {
  await browser.close();
  try { process.kill(-server.pid, "SIGINT"); } catch {}
  await sleep(500);
  rmSync(dataDir, { recursive: true, force: true });
}
console.log(`screenshots in ${out}`);
