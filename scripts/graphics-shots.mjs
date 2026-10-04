// The world's look at different times of day: a view over water and land at noon, sunset, dusk and
// night (and in rain, when WEATHER=rain). Screenshots in test-results/graphics/.
//   npm run build && node scripts/graphics-shots.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://localhost:${PORT}`;
const out = process.env.OUT ?? "test-results/graphics";
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), "lfg2-gfx-"));
const server = spawn("npx", ["tsx", "packages/server/src/index.ts"], {
  env: { ...process.env, ANTHROPIC_API_KEY: "", PORT: String(PORT), DATA_DIR: dataDir, SEED: process.env.SEED ?? "3", VIEW_DISTANCE: "4", PUBLIC_URL: BASE },
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
const say = (t) => page.evaluate((x) => window.lfg.send({ t: "chat", text: x }), t);
try {
  await page.goto(`${BASE}/?name=Iris&autoplay`);
  await page.waitForFunction(() => window.lfg && window.lfg.world.meshCount > 30, null, { timeout: 90000, polling: 250 });
  await page.evaluate(() => { window.lfg.ui.toggleHelp(); window.lfg.ui.setSteps(null); });
  await say("/gamemode creative");
  // A shore: water within view, land behind.
  const spot = await page.evaluate(() => {
    const g = window.lfg, w = g.world, b = g.player.body;
    const water = g.reg.blocks.find((d) => d.name === "water").id;
    for (let r = 4; r < 60; r += 2) for (let a = 0; a < 24; a++) {
      const x = Math.round(b.x + Math.cos(a / 24 * 6.283) * r), z = Math.round(b.z + Math.sin(a / 24 * 6.283) * r);
      for (let y = 70; y > 40; y--) {
        const id = w.getBlock(x, y, z);
        if (!id) continue;
        if (id !== water) break;
        // Stand on land a few blocks back from this water.
        for (let k = 3; k < 14; k++) {
          const lx = Math.round(x - Math.cos(a / 24 * 6.283) * k), lz = Math.round(z - Math.sin(a / 24 * 6.283) * k);
          for (let ly = 75; ly > 40; ly--) { const t = w.getBlock(lx, ly, lz); if (t) { if (t !== water) return { x, y, z, lx: lx + 0.5, ly: ly + 1, lz: lz + 0.5 }; break; } }
        }
        break;
      }
    }
    return null;
  });
  console.log(`water at ${JSON.stringify(spot)}`);
  const look = async (name, time) => {
    await say(`/time set ${time}`);
    if (spot) await say(`/tp ${spot.lx} ${spot.ly + 4} ${spot.lz}`);
    await sleep(1500);
    await page.evaluate((s) => {
      const g = window.lfg; g.player.flying = true;
      if (s) { const b = g.player.body; const dx = s.x - b.x, dz = s.z - b.z; g.player.yaw = Math.atan2(-dx, -dz); g.player.pitch = -0.12; }
    }, spot);
    await sleep(2500);
    if (process.env.DEBUG) console.log(JSON.stringify(await page.evaluate(() => { const r = window.lfg.renderer; return { daylight: r.solidMat.uniforms.daylight.value, nv: r.solidMat.uniforms.nightVision.value, under: r.skyDome.visible, y: window.lfg.player.body.y, time: window.lfg.time }; })));
    await page.screenshot({ path: join(out, `${name}.png`) });
    console.log(`  ${name}`);
  };
  if (process.env.WEATHER) { await say(`/weather ${process.env.WEATHER}`); await sleep(1500); }
  await look("1-noon", "noon");
  await look("2-sunset", "dusk");
  await look("3-dusk", "night");
  await look("4-night", "midnight");
  console.log(errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
} finally {
  await browser.close();
  try { process.kill(-server.pid, "SIGINT"); } catch {}
  await sleep(500);
  rmSync(dataDir, { recursive: true, force: true });
}
