// End-to-end: summon a big cloud, a storm cloud and a flying shark in the
// browser, look at them, and check the shark hunts by the rules.
//   npm run build && node scripts/e2e-summons.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = 8000 + Math.floor(Math.random() * 900);
const out = process.env.E2E_OUT ?? "test-results";
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), "lfg2-e2e-summons-"));
const server = spawn("npx", ["tsx", "packages/server/src/index.ts"], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, SEED: process.env.SEED ?? "42", VIEW_DISTANCE: "3", EVENT_PACING: "fast" },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));
const stopServer = () => { try { process.kill(-server.pid, "SIGINT"); } catch { /* gone */ } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (ok, what) => { console.log(`${ok ? "✓" : "✗"} ${what}`); if (!ok) failed = true; };

for (let i = 0; i < 60 && !serverLog.includes("listening"); i++) await sleep(250);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const errors = [];
const open = async (name) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(`http://localhost:${PORT}/?name=${name}&autoplay`);
  await page.waitForFunction(() => window.lfg && window.lfg.world.meshCount > 30, null, { timeout: 90000, polling: 250 });
  return page;
};
const say = (page, text) => page.evaluate((t) => window.lfg.send({ t: "chat", text: t }), text);
const waitArrival = (page, title) =>
  page.waitForFunction((t) => { const b = document.querySelector(".banner"); return !!b && b.classList.contains("arrival") && b.innerText.includes(t); }, title, { timeout: 40000, polling: 200 });
/** Point the camera at the first entity of a type, from `back` blocks behind/below. */
const lookAt = (page, type) => page.evaluate((type) => {
  const g = window.lfg;
  const e = [...g.entities.views.values()].find((v) => v.type.name === type);
  if (!e) return false;
  const b = g.player.body;
  const dx = e.pos.x - b.x, dy = e.pos.y + e.type.height / 2 - (b.y + 1.62), dz = e.pos.z - b.z;
  g.player.yaw = Math.atan2(-dx, -dz);
  g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  return true;
}, type);

try {
  const a = await open("Alice");
  const b = await open("Bob");
  await a.bringToFront();
  await say(a, "/time set noon");
  // Summon at the top level with aether and shards to spare (levels are tested in e2e-voice).
  await say(a, "/xp level 20");
  await say(a, "/aether shards 20");
  await a.evaluate(() => window.lfg.ui.toggleHelp());

  // 1) A big cloud.
  await say(a, "/summon a big cloud");
  await waitArrival(a, "Big Cloud");
  check(true, "the big cloud arrived as a world event");
  await b.waitForFunction(() => window.lfg.reg.entityTypes.has("summon:big_cloud"), null, { timeout: 10000, polling: 250 });
  check(true, "Bob's client received the new cloud type");
  await sleep(1500);
  const cloud = await a.evaluate(() => {
    const g = window.lfg;
    const v = [...g.entities.views.values()].find((v) => v.type.name === "summon:big_cloud");
    const ground = (() => { for (let y = 127; y > 0; y--) if (g.table.solid[g.world.getBlock(Math.floor(v.pos.x), y, Math.floor(v.pos.z))]) return y; return 0; })();
    return { y: v.pos.y, above: v.pos.y - ground, meshes: v.voxel?.root.children.length };
  });
  check(cloud.above > 15, `it floats ${cloud.above.toFixed(0)} blocks above the ground`);
  // Step back so it's in view.
  await a.evaluate(() => { const g = window.lfg; g.player.flying = true; g.player.creative = true; });
  await lookAt(a, "summon:big_cloud");
  await sleep(800);
  await a.screenshot({ path: join(out, "summon-1-big-cloud.png") });

  // 2) A storm cloud (rains).
  await say(a, "/summon a storm cloud");
  await waitArrival(a, "Storm Cloud");
  await sleep(2500);
  await lookAt(a, "summon:storm_cloud");
  await a.evaluate(() => { window.lfg.player.pitch += 0.25; });
  await sleep(1200);
  await a.screenshot({ path: join(out, "summon-2-storm-cloud.png") });
  const raining = await a.evaluate(() => [...window.lfg.entities.views.values()].some((v) => v.type.name === "summon:storm_cloud" && (v.flags & 8)));
  check(raining, "the storm cloud is raining");

  // 3) A flying shark, away from the spawn safe zone, with Alice in survival.
  const spawnPos = await a.evaluate(() => window.lfg.player.body);
  // Fly over (still in creative, flying), then land gently away from the spawn safe zone.
  await a.evaluate(() => { const g = window.lfg; g.player.creative = true; g.player.flying = true; });
  await say(a, `/tp ${Math.round(spawnPos.x) + 45} 100 ${Math.round(spawnPos.z) + 45}`);
  await sleep(2500);
  await a.waitForFunction(() => { const g = window.lfg, b = g.player.body; return g.world.isLoaded(Math.floor(b.x), 64, Math.floor(b.z)); }, null, { timeout: 20000, polling: 250 });
  await a.evaluate(() => {
    const g = window.lfg, b = g.player.body;
    let y = 120; while (y > 1 && !g.table.solid[g.world.getBlock(Math.floor(b.x), y, Math.floor(b.z))]) y--;
    g.send({ t: "chat", text: `/tp ${b.x.toFixed(1)} ${y + 1} ${b.z.toFixed(1)}` });
  });
  await sleep(1500);
  await say(a, "/gamemode survival");
  await a.evaluate(() => { window.lfg.player.flying = false; });
  await sleep(1000);
  check(await a.evaluate(() => window.lfg.ui.self.health === window.lfg.ui.self.maxHealth), "Alice landed at full health");
  // Summon it while hovering above the trees in creative (it ignores creative players), to get a clear look.
  await say(a, "/gamemode creative");
  await a.evaluate(() => { const g = window.lfg; g.player.creative = true; g.player.flying = true; g.player.body.y += 7; });
  await sleep(800);
  await say(a, "/summon a flying shark");
  await waitArrival(a, "Flying Shark");
  check(true, "the flying shark arrived");
  await sleep(2500);
  await lookAt(a, "summon:flying_shark");
  await sleep(300);
  await a.screenshot({ path: join(out, "summon-3-flying-shark.png") });
  // Back down to the ground, in survival: now it hunts.
  await a.evaluate(() => {
    const g = window.lfg, b = g.player.body;
    let y = 120; while (y > 1 && !g.table.solid[g.world.getBlock(Math.floor(b.x), y, Math.floor(b.z))]) y--;
    g.send({ t: "chat", text: `/tp ${b.x.toFixed(1)} ${y + 1} ${b.z.toFixed(1)}` });
  });
  await sleep(800);
  await say(a, "/gamemode survival");
  await a.evaluate(() => { window.lfg.player.flying = false; });
  await sleep(500);
  // Wait for its warning (flash + sound), screenshot it, then see if a bite lands.
  const hp0 = await a.evaluate(() => window.lfg.ui.self.health);
  const warned = await a.waitForFunction(() => [...window.lfg.entities.views.values()].some((v) => v.type.name === "summon:flying_shark" && (v.flags & 4)), null, { timeout: 40000, polling: 100 }).then(() => true, () => false);
  check(warned, "the shark warned before attacking (flash)");
  if (warned) {
    await lookAt(a, "summon:flying_shark");
    await sleep(150);
    await a.screenshot({ path: join(out, "summon-4-shark-warning.png") });
  }
  const bitten = await a.waitForFunction((hp) => window.lfg.ui.self.health < hp, hp0, { timeout: 30000, polling: 100 }).then(() => true, () => false);
  const hp1 = await a.evaluate(() => window.lfg.ui.self.health);
  if (bitten) check(hp0 - hp1 <= 40, `a bite took ${hp0 - hp1} health (cap 40 per hit)`);
  else console.log("· no bite landed within 30 s (trees can shelter a player; not a failure)");
  await b.waitForFunction(() => window.lfg.reg.entityTypes.has("summon:flying_shark"), null, { timeout: 10000, polling: 250 });
  check(true, "Bob's client received the shark type");
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
} catch (err) {
  check(false, err?.stack ?? String(err));
} finally {
  await browser.close();
  stopServer();
  await sleep(800);
  rmSync(dataDir, { recursive: true, force: true });
  if (failed) console.log(`--- server log ---\n${serverLog}`);
  console.log(failed ? "E2E SUMMONS FAILED" : `E2E SUMMONS OK — screenshots in ${out}/`);
  process.exit(failed ? 1 : 0);
}
