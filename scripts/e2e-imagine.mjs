// /imagine end to end, with a real Anthropic API key: a player describes something in detail,
// a stand-in arrives at once, Claude drafts it (render, look, edit, save) and the stand-in morphs into
// it, then a second pass polishes it and it morphs again. Screenshots of each stage.
//   ANTHROPIC_API_KEY=... npm run build && node scripts/e2e-imagine.mjs "an ancient obsidian salamander ..."
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const prompt = process.argv.slice(2).join(" ") || "a mossy stone tortoise as big as a cart, with a tiny shrine and a glowing lantern on its shell";
const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://localhost:${PORT}`;
const out = process.env.OUT ?? "test-results/imagine";
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), "lfg2-imagine-"));
const server = spawn("npx", ["tsx", "packages/server/src/index.ts"], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, SEED: process.env.SEED ?? "3", VIEW_DISTANCE: "3", EVENT_PACING: "fast", PUBLIC_URL: BASE, ADMINS: "Iris" },
  stdio: ["ignore", "pipe", "pipe"], detached: true,
});
let log = "";
server.stdout.on("data", (d) => (log += d)); server.stderr.on("data", (d) => (log += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 80 && !log.includes("listening"); i++) await sleep(250);
if (!log.includes("Claude designs")) { console.log("✗ the server has no Anthropic key (set ANTHROPIC_API_KEY or .env)"); process.kill(-server.pid, "SIGINT"); process.exit(1); }
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const say = (text) => page.evaluate((t) => window.lfg.send({ t: "chat", text: t }), text);
const chat = () => page.evaluate(() => [...document.querySelectorAll(".chat-line")].map((e) => e.textContent).join("\n"));
let ok = false;
try {
  await page.goto(`${BASE}/?name=Iris&autoplay`);
  await page.waitForFunction(() => window.lfg && window.lfg.world.meshCount > 30, null, { timeout: 90000, polling: 250 });
  await page.evaluate(() => window.lfg.ui.toggleHelp());
  await say("/time set noon"); await say("/xp level 30"); await say("/gamemode creative");
  await say("/tp 30 70 30");
  await sleep(1000);
  const t0 = Date.now();
  await say(`/imagine ${prompt}`);
  console.log(`· /imagine ${prompt}`);
  // The timeline: the stand-in arrives, morphs into the draft, then into the polished design.
  const summonNames = () => page.evaluate(() => [...window.lfg.entities.views.values()].filter((v) => v.type.summon && v.voxel).map((v) => v.type.summon.name).join(", "));
  const secs = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  const look = async (name) => {
    await page.evaluate(() => {
      const g = window.lfg, v = [...g.entities.views.values()].find((v) => v.type.summon);
      if (!v) return;
      const r = Math.max(5, v.type.height * 2.6);
      g.player.flying = true;
      g.send({ t: "chat", text: `/tp ${(v.pos.x + r * 0.7).toFixed(1)} ${(v.pos.y + v.type.height * 0.7).toFixed(1)} ${(v.pos.z + r * 0.7).toFixed(1)}` });
      setTimeout(() => { const b = g.player.body; const dx = v.pos.x - b.x, dz = v.pos.z - b.z, dy = v.pos.y + v.type.height / 2 - (b.y + 1.62); g.player.yaw = Math.atan2(-dx, -dz); g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz)); }, 800);
    });
    await sleep(2200);
    await page.screenshot({ path: join(out, `imagine-${name}.png`) });
  };
  let seen = "", stage = 0;
  const polishing = process.env.DESIGNER_POLISH_MODEL !== "";
  for (let i = 0; i < 1200; i++) {
    const c = await chat();
    const now = await summonNames();
    if (now && now !== seen) { console.log(`  ${secs()} in the world: ${now}`); seen = now; await look(["stand-in", "draft", "polished"][Math.min(stage, 2)]); stage++; }
    if (/Couldn't imagine|couldn't be reached/.test(c)) break;
    if (/is finished|keeping the draft/.test(c) || (!polishing && /: \/summon design:/.test(c) && stage >= 2)) { await sleep(3000); const n = await summonNames(); if (n !== seen) { console.log(`  ${secs()} in the world: ${n}`); await look("polished"); } break; }
    await sleep(500);
  }
  const c = await chat();
  console.log(c.split("\n").filter((l) => l.startsWith("✎")).join("\n"));
  const id = c.match(/design:([a-z0-9_-]+)/)?.[1];
  ok = !!id;
  console.log(`${ok ? "✓" : "✗"} done in ${secs()}${id ? ` (design:${id})` : ""}`);
  // Again, in the same words: remembered, so it's instant.
  if (ok) {
    await say("/unsummon");
    for (let i = 0; i < 20 && (await summonNames()); i++) await sleep(250);
    const t1 = Date.now();
    await say(`/imagine ${prompt}`);
    for (let i = 0; i < 40 && !(await summonNames()); i++) await sleep(500);
    console.log(`  asked again: ${(await chat()).split("\n").filter((l) => l.startsWith("✎")).pop()} (${((Date.now() - t1) / 1000).toFixed(1)}s to arrive)`);
  }
  writeFileSync(join(out, "server.log"), log);
} finally {
  await browser.close();
  try { process.kill(-server.pid, "SIGINT"); } catch {}
  await sleep(500);
  rmSync(dataDir, { recursive: true, force: true });
}
process.exit(ok ? 0 : 1);
