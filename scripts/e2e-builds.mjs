// End-to-end: epic builds and powers in the browser. A village rises, a city
// is raised on a mountainside, and a player takes on the power of a wizard.
//   npm run build && node scripts/e2e-builds.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = 8000 + Math.floor(Math.random() * 900);
const out = process.env.E2E_OUT ?? "test-results";
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), "lfg2-e2e-builds-"));
const server = spawn("npx", ["tsx", "packages/server/src/index.ts"], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, SEED: process.env.SEED ?? "42", VIEW_DISTANCE: "4", EVENT_PACING: "fast" },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (ok, what) => { console.log(`${ok ? "✓" : "✗"} ${what}`); if (!ok) failed = true; };
for (let i = 0; i < 60 && !serverLog.includes("listening"); i++) await sleep(250);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => errors.push(e.message));
const say = (text) => page.evaluate((t) => window.lfg.send({ t: "chat", text: t }), text);
const chat = () => page.evaluate(() => [...document.querySelectorAll(".chat-line")].map((e) => e.textContent).join("\n"));
const arrival = (title, timeout = 60000) =>
  page.waitForFunction((t) => { const b = document.querySelector(".banner"); return !!b && b.classList.contains("arrival") && b.innerText.includes(t); }, title, { timeout, polling: 200 });
/** Fly to a viewpoint looking at (x, y, z) from `back` blocks away, `up` blocks higher, along direction `ang`. */
const view = async (x, y, z, back, up, ang) => {
  await page.evaluate(([x, y, z, back, up, ang]) => {
    const g = window.lfg, p = g.player;
    p.creative = true; p.flying = true;
    const px = x + Math.cos(ang) * back, pz = z + Math.sin(ang) * back, py = y + up;
    g.send({ t: "chat", text: `/tp ${px.toFixed(1)} ${py.toFixed(1)} ${pz.toFixed(1)}` });
    p.yaw = Math.atan2(-(x - px), -(z - pz));
    p.pitch = -Math.atan2(up, back);
  }, [x, y, z, back, up, ang]);
  await sleep(2500);
  await page.waitForFunction(() => window.lfg.world.pendingMeshes === undefined || window.lfg.world.pendingMeshes === 0, null, { timeout: 15000, polling: 250 }).catch(() => {});
  await sleep(1500);
};

try {
  await page.goto(`http://localhost:${PORT}/?name=Builder&autoplay`);
  await page.waitForFunction(() => window.lfg && window.lfg.world.meshCount > 30, null, { timeout: 90000, polling: 250 });
  await page.evaluate(() => window.lfg.ui.toggleHelp());
  await say("/time set noon");
  await say("/xp level 20");
  await say("/aether shards 30");
  await say("/gamemode creative");
  // East of spawn, on the open land, looking east.
  const sp = await page.evaluate(() => window.lfg.player.body);
  await say(`/tp ${Math.round(sp.x) + 70} 90 ${Math.round(sp.z)}`);
  await page.evaluate(() => { const g = window.lfg; g.player.creative = true; g.player.flying = true; g.player.yaw = -Math.PI / 2; g.player.pitch = -0.3; });
  await sleep(4000);

  // A village.
  await say("/summon a village");
  await arrival("Village");
  check(true, "the village arrived as a world event");
  await sleep(5000);
  const vText = await chat();
  const vm = vText.match(/Village rises \d+ blocks \S+ \((-?\d+), (-?\d+)\)/);
  check(!!vm, `announced where: ${vm?.[0]}`);
  const [vx, vz] = [Number(vm[1]), Number(vm[2])];
  const vy = await page.evaluate(([x, z]) => { const g = window.lfg; let y = 120; while (y > 1 && !g.table.solid[g.world.getBlock(x, y, z)]) y--; return y; }, [vx, vz]);
  await view(vx, vy, vz, 34, 22, Math.PI * 0.75);
  await page.screenshot({ path: join(out, "build-1-village.png") });
  const villagers = await page.evaluate(() => [...window.lfg.entities.views.values()].filter((v) => v.type.summon?.name === "Villager").length);
  check(villagers >= 4, `${villagers} villagers walking about`);

  // A city on a mountainside (tier 5), raised by someone else (one epic build per player per day).
  const mayor = await browser.newPage({ viewport: { width: 640, height: 360 } });
  mayor.on("pageerror", (e) => errors.push(`Mayor: ${e.message}`));
  await mayor.goto(`http://localhost:${PORT}/?name=Mayor&autoplay`);
  await mayor.waitForFunction(() => window.lfg && window.lfg.world.meshCount > 10, null, { timeout: 90000, polling: 250 });
  const me = await page.evaluate(() => window.lfg.player.body);
  await mayor.evaluate(([x, y, z]) => { const g = window.lfg; g.send({ t: "chat", text: "/xp level 20" }); g.send({ t: "chat", text: "/aether shards 30" }); g.send({ t: "chat", text: "/gamemode creative" }); g.send({ t: "chat", text: `/tp ${x} ${y} ${z}` }); }, [me.x.toFixed(1), me.y.toFixed(1), me.z.toFixed(1)]);
  await sleep(3000);
  await mayor.evaluate(() => window.lfg.send({ t: "chat", text: "/summon a city with a whole civilization on the mountainside" }));
  await page.bringToFront();
  const res = await Promise.race([
    arrival("City", 90000).then(() => "arrived"),
    page.waitForFunction(() => { const b = document.querySelector(".banner"); return !!b && b.classList.contains("fizzle") && b.innerText.includes("City"); }, null, { timeout: 90000, polling: 200 }).then(() => "fizzled"),
  ]);
  if (res === "fizzled") {
    console.log(`· the city fizzled: ${await page.evaluate(() => document.querySelector(".banner").innerText)}`);
  } else {
    check(true, "the mountain city arrived");
    await sleep(8000);
    const cm = (await chat()).match(/City rises \d+ blocks \S+ \((-?\d+), (-?\d+)\)/);
    const [cx, cz] = [Number(cm[1]), Number(cm[2])];
    const cy = await page.evaluate(([x, z]) => { const g = window.lfg; let y = 120; while (y > 1 && !g.table.solid[g.world.getBlock(x, y, z)]) y--; return y; }, [cx, cz]);
    await view(cx, cy, cz, 95, 60, Math.PI * 0.3);
    await page.screenshot({ path: join(out, "build-2-city.png") });
    await view(cx, cy, cz, 30, 12, Math.PI * 0.6);
    await page.screenshot({ path: join(out, "build-3-city-street.png") });
  }

  // The power of a wizard.
  await say("/gamemode survival");
  await page.evaluate(() => { window.lfg.player.creative = false; });
  await say("/aether fill");
  await say("/summon the power of a wizard");
  await page.waitForFunction(() => document.querySelector(".buffs.show"), null, { timeout: 10000, polling: 200 });
  const buffs = await page.evaluate(() => document.querySelector(".buffs").innerText);
  check(/Wizard/.test(buffs) && /Fire bolt/.test(buffs), `the wizard's spells: ${buffs.replace(/\n/g, " · ")}`);
  await page.evaluate(() => { window.lfg.locked = true; window.lfg.player.pitch = -0.05; });
  await page.keyboard.press("KeyR");
  await sleep(150);
  await page.screenshot({ path: join(out, "build-4-wizard.png") });
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
} catch (err) {
  check(false, err?.stack ?? String(err));
} finally {
  await browser.close();
  try { process.kill(-server.pid, "SIGINT"); } catch { /* gone */ }
  await sleep(800);
  rmSync(dataDir, { recursive: true, force: true });
  if (failed) console.log(`--- server log (tail) ---\n${serverLog.slice(-4000)}`);
  console.log(failed ? "E2E BUILDS FAILED" : `E2E BUILDS OK — screenshots in ${out}/`);
  process.exit(failed ? 1 : 0);
}
