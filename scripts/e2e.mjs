// End-to-end smoke test: start the server (serving the built client), open two
// browser players in headless Chromium, check the world renders and players
// can see each other, and save screenshots.
//
//   npm run build && npm run e2e
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = 8000 + Math.floor(Math.random() * 900);
const out = process.env.E2E_OUT ?? "test-results";
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), "lfg2-e2e-"));

const server = spawn("npx", ["tsx", "packages/server/src/index.ts"], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, SEED: process.env.SEED ?? "42", VIEW_DISTANCE: "3" },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true, // own process group, so we can stop npx and the server together
});
const stopServer = () => { try { process.kill(-server.pid, "SIGINT"); } catch { /* already gone */ } };
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = async (msg) => {
  console.error(`E2E FAILED: ${msg}\n--- server log ---\n${serverLog}`);
  stopServer();
  process.exit(1);
};

for (let i = 0; i < 60; i++) {
  if (serverLog.includes("listening")) break;
  await sleep(250);
}
if (!serverLog.includes("listening")) await fail("server did not start");

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const errors = [];
const open = async (name) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${name} console: ${m.text()}`); });
  await page.goto(`http://localhost:${PORT}/?name=${name}&autoplay`);
  return page;
};

try {
  const a = await open("Alice");
  await a.waitForFunction(() => !!window.lfg, null, { timeout: 15000, polling: 250 });
  // Wait for terrain meshes to appear around the player.
  await a.waitForFunction(() => window.lfg.world.meshCount > 40, null, { timeout: 60000, polling: 250 });
  await sleep(1500);
  await a.screenshot({ path: join(out, "01-spawn.png") });

  const b = await open("Bob");
  await b.waitForFunction(() => !!window.lfg, null, { timeout: 15000, polling: 250 });
  // Alice should get Bob as an entity.
  await a.waitForFunction(() => [...window.lfg.entities.boxes()].some((e) => e.kind === "player"), null, { timeout: 15000, polling: 250 });

  // Look around: noon, then turn and look down a bit, toggle third person, show debug.
  await a.evaluate(() => {
    const g = window.lfg;
    g.send({ t: "chat", text: "/time set noon" });
    g.player.yaw = Math.PI * 0.75;
    g.player.pitch = -0.25;
  });
  await sleep(1200);
  await a.screenshot({ path: join(out, "02-landscape.png") });

  // Sunset view with debug overlay.
  await a.evaluate(() => {
    window.lfg.send({ t: "chat", text: "/time set sunset" });
    window.lfg.ui.toggleDebug();
  });
  await sleep(1500);
  await a.screenshot({ path: join(out, "03-sunset-debug.png") });

  // Inventory with creative palette.
  await a.evaluate(() => {
    const g = window.lfg;
    g.ui.toggleDebug();
    g.send({ t: "chat", text: "/gamemode creative" });
    g.send({ t: "chat", text: "/give crafting_table 1" });
    g.send({ t: "chat", text: "/give diamond_pickaxe 1" });
    g.send({ t: "chat", text: "/give torch 16" });
  });
  await sleep(600);
  await a.evaluate(() => window.lfg.openInventory());
  await sleep(500);
  await a.screenshot({ path: join(out, "04-inventory.png") });
  await a.evaluate(() => window.lfg.closeWindow());

  // Mine the block under our feet and place it back, through the real input path.
  const below = await a.evaluate(() => {
    const g = window.lfg;
    const b = g.player.body;
    return { x: Math.floor(b.x), y: Math.floor(b.y) - 1, z: Math.floor(b.z), id: g.world.getBlock(Math.floor(b.x), Math.floor(b.y) - 1, Math.floor(b.z)) };
  });
  // Background tabs get throttled frames; the game loop needs to run for input to be handled.
  await a.bringToFront();
  await a.evaluate(() => {
    const g = window.lfg;
    g.locked = true;
    g.player.pitch = -Math.PI / 2 + 0.01;
    g.mouse.left = true;
  });
  await a.waitForFunction(({ x, y, z }) => window.lfg.world.getBlock(x, y, z) === 0, below, { timeout: 10000, polling: 250 })
    .catch(async () => fail(`digging in creative didn't remove the block: ${JSON.stringify(await a.evaluate(() => {
      const g = window.lfg;
      return { target: g.target, dig: g.dig, locked: g.locked, mouse: g.mouse, mode: g.self.gameMode, dead: g.self.dead, win: g.ui.windowOpen, chat: g.ui.chatOpen, pos: [g.player.body.x, g.player.body.y, g.player.body.z] };
    }))}`));
  await a.evaluate(() => { window.lfg.mouse.left = false; window.lfg.cancelDig(); });
  // Bob should have seen it disappear too.
  await b.waitForFunction(({ x, y, z }) => window.lfg.world.getBlock(x, y, z) === 0, below, { timeout: 5000, polling: 250 });
  console.log("dig OK: block removed for both players");

  // Night: torches around us, mobs nearby, view from a little above.
  await a.evaluate(() => {
    const g = window.lfg;
    g.mouse.left = false;
    g.send({ t: "chat", text: "/time set midnight" });
    const b = g.player.body;
    const x = Math.floor(b.x), z = Math.floor(b.z);
    const ground = (xx, zz) => { for (let y = 120; y > 0; y--) if (g.table.solid[g.world.getBlock(xx, y, zz)]) return y; return 0; };
    for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4], [6, 6], [-6, -6]]) {
      const y = ground(x + dx, z + dz);
      g.send({ t: "creativeSet", slot: 2, item: g.reg.item("torch").id, count: 64 });
      g.send({ t: "select", slot: 2 });
      g.send({ t: "place", x: x + dx, y, z: z + dz, nx: 0, ny: 1, nz: 0, yaw: 0 });
    }
    g.send({ t: "chat", text: "/summon pig 3" });
    g.send({ t: "chat", text: "/summon creeper 1" });
    g.player.flying = true;
    g.player.body.y += 6;
    g.player.pitch = -0.6;
    g.locked = false;
  });
  await sleep(3000);
  await a.screenshot({ path: join(out, "05-night-torches.png") });
  await b.bringToFront();
  await b.screenshot({ path: join(out, "05b-bob-view.png") });
  await a.bringToFront();
  const torches = await a.evaluate(() => {
    const g = window.lfg; const t = g.reg.blockId("torch"); let n = 0;
    const b = g.player.body;
    for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) for (let y = 0; y < 128; y++) if (g.world.getBlock(Math.floor(b.x) + x, y, Math.floor(b.z) + z) === t) n++;
    return n;
  });
  console.log(`torches placed: ${torches}`);
  if (torches < 3) await fail("torches were not placed");

  // Overview from high up at noon.
  await a.evaluate(() => {
    const g = window.lfg;
    g.send({ t: "chat", text: "/time set noon" });
    g.player.flying = true;
    const b = g.player.body;
    g.send({ t: "chat", text: `/tp ${b.x} ${b.y + 30} ${b.z}` });
    g.player.pitch = -0.45;
    g.player.yaw = 0.6;
  });
  await sleep(4000);
  await a.screenshot({ path: join(out, "06-overview.png") });

  const stats = await a.evaluate(() => ({
    meshes: window.lfg.world.meshCount,
    chunks: window.lfg.world.chunks.size,
    entities: window.lfg.entities.count,
    fps: Math.round(window.lfg.fps),
  }));
  console.log("client stats:", stats);
  if (stats.meshes < 40) await fail("too few chunk meshes");
  if (errors.length) await fail(`page errors:\n${errors.join("\n")}`);
  console.log(`E2E OK — screenshots in ${out}/`);
} catch (err) {
  await fail(err?.stack ?? String(err));
} finally {
  await browser.close();
  stopServer();
  await sleep(1000);
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(0);
}
