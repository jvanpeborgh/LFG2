// A living meadow, as a timelapse: a herd, eagles, a fox and rabbits get on with their lives; then
// a wolf turns up and the prey scatters; then night falls. One frame every few seconds from a fixed
// camera, put together as a contact sheet, with what each creature was doing.
//   npm run build && node scripts/e2e-life.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://localhost:${PORT}`;
const out = process.env.OUT ?? "test-results/life";
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), "lfg2-life-"));
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
  await say("/gamemode creative");
  // A busy meadow needs more than one player's usual 6 summons.
  await say("/rule set summons.maxActivePerPlayer 16");
  await sleep(2500);
  await say("/time set 0.12");
  await say(`/tp ${spot.x + 0.5} ${spot.y + 0.2} ${spot.z + 0.5}`);
  await sleep(1200);
  const count = (re) => page.evaluate((src) => [...window.lfg.entities.views.values()].filter((v) => v.type.summon && new RegExp(src).test(v.type.summon.name)).length, re);
  const arrive = async (re, n, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms && (await count(re)) < n) await sleep(500); return count(re); };
  for (const p of ["four cows", "two eagles", "a fox", "three rabbits"]) { await say(`/summon ${p}`); await sleep(500); }
  console.log(`  arrived: ${await arrive(".", 8)} creatures`);
  // A fixed camera, up and back, looking at the meadow.
  const cam = [spot.x + 12.5, spot.y + 7, spot.z + 12.5];
  const aim = () => page.evaluate(([cx, cy, cz, tx, ty, tz]) => {
    const g = window.lfg; g.player.flying = true;
    const b = g.player.body; b.x = cx; b.y = cy; b.z = cz; b.vx = b.vy = b.vz = 0;
    const dx = tx - cx, dz = tz - cz, dy = ty - (cy + 1.62);
    g.player.yaw = Math.atan2(-dx, -dz); g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }, [...cam, spot.x + 0.5, spot.y + 0.5, spot.z + 0.5]);
  await say(`/tp ${cam[0]} ${cam[1]} ${cam[2]}`);
  await sleep(1000);
  const frames = [];
  const doing = () => page.evaluate(() => [...window.lfg.entities.views.values()].filter((v) => v.type.summon).map((v) => `${v.type.summon.name.replace(/^(Angry |Tiny |Big )/, "")}${v.action ? ` ${v.action}` : (v.flags & 2) ? " moving" : ""}`));
  const tally = {};
  const shot = async (label) => {
    await aim(); await sleep(150);
    const f = `frame-${frames.length + 1}.png`;
    await page.screenshot({ path: join(out, f), clip: { x: 0, y: 0, width: 1280, height: 600 } });
    const d = await doing();
    for (const x of d) { const a = x.split(" ").slice(1).join(" ") || "standing"; tally[a] = (tally[a] ?? 0) + 1; }
    frames.push({ f, label, d });
    console.log(`  ${label}: ${d.join(" · ")}`);
  };
  for (let i = 0; i < 6; i++) { await shot(`day +${i * 5}s`); for (let k = 0; k < 10; k++) { await aim(); await sleep(500); } }
  await say(`/tp ${spot.x + 0.5} ${spot.y + 0.2} ${spot.z + 0.5}`);
  await sleep(300);
  await say("/summon an angry wolf");
  console.log(`  wolf arrived: ${(await arrive("Wolf", 1, 30000)) > 0}`);
  for (let i = 0; i < 3; i++) { await shot(`wolf +${i * 3}s`); for (let k = 0; k < 6; k++) { await aim(); await sleep(500); } }
  await say("/unsummon"); await sleep(300);
  for (const p of ["four cows", "two eagles", "a fox"]) { await say(`/summon ${p}`); await sleep(400); }
  await arrive(".", 5, 40000);
  await say("/time set midnight");
  for (let k = 0; k < 24; k++) { await aim(); await sleep(500); }
  for (let i = 0; i < 3; i++) { await shot(`night +${i * 5}s`); for (let k = 0; k < 10; k++) { await aim(); await sleep(500); } }
  console.log(`tally: ${JSON.stringify(tally)}`);
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#1d2330;font:600 18px system-ui;color:#fff}div{display:grid;grid-template-columns:repeat(3,640px);gap:6px;padding:6px}figure{margin:0;position:relative}img{display:block;width:640px}figcaption{position:absolute;left:8px;top:8px;background:#000b;padding:4px 10px;border-radius:6px;max-width:600px}small{display:block;font-weight:400;font-size:13px}</style><div>${frames.map((x) => `<figure><img src="data:image/png;base64,${readFileSync(join(out, x.f)).toString("base64")}"><figcaption>${x.label}<small>${x.d.join(" · ")}</small></figcaption></figure>`).join("")}</div>`;
  writeFileSync(join(out, "timelapse.html"), html);
  await page.setViewportSize({ width: 3 * 640 + 24, height: Math.ceil(frames.length / 3) * 306 + 12 });
  await page.goto(`file://${join(process.cwd(), out, "timelapse.html")}`);
  await page.screenshot({ path: join(out, "timelapse.png") });
  for (const want of ["perch", "graze"]) if (!tally[want]) { console.log(`✗ never saw ${want}`); failed = true; }
  if (!tally.sleep) { console.log("✗ nothing slept at night"); failed = true; }
  console.log(errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
  if (errors.length) failed = true;
} finally {
  await browser.close();
  try { process.kill(-server.pid, "SIGINT"); } catch {}
  await sleep(500);
  rmSync(dataDir, { recursive: true, force: true });
}
console.log(`timelapse in ${out}/timelapse.png`);
process.exit(failed ? 1 : 0);
