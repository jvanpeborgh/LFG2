// End-to-end: a pirate raid in the browser. Ships sail in, raiders come ashore in
// waves, a boss with a slam you step out of, and a reward at the end.
//   npm run build && node scripts/e2e-scenario.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = 8000 + Math.floor(Math.random() * 900);
const out = process.env.E2E_OUT ?? "test-results";
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), "lfg2-e2e-scenario-"));
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
const hudText = (page) => page.evaluate(() => document.querySelector(".scenario.show")?.innerText ?? "");
/** Face the nearest entity whose summon body matches, from where the player stands. */
const face = (page, body, lift = 0, boss = false) => page.evaluate(([body, lift, boss]) => {
  const g = window.lfg, b = g.player.body;
  const vs = [...g.entities.views.values()].filter((v) => v.type.summon?.body === body && (!boss || v.type.summon.role === "boss"));
  if (!vs.length) return false;
  vs.sort((p, q) => Math.hypot(p.pos.x - b.x, p.pos.z - b.z) - Math.hypot(q.pos.x - b.x, q.pos.z - b.z));
  const e = vs[0];
  const dx = e.pos.x - b.x, dy = e.pos.y + e.type.height / 2 + lift - (b.y + 1.62), dz = e.pos.z - b.z;
  g.player.yaw = Math.atan2(-dx, -dz);
  g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  return true;
}, [body, lift, boss]);

try {
  const a = await open("Alice");
  const b = await open("Bob");
  await a.bringToFront();
  await say(a, "/time set noon");
  await a.evaluate(() => window.lfg.ui.toggleHelp());
  // Fast regeneration for this test (a live rule change), so Alice can hold the beach alone.
  await say(a, "/rule set balance.player.regenDelaySeconds 1");
  await say(a, "/rule set balance.player.regenPerSecond 40");
  await say(a, "/give diamond_sword");
  // Go to the shore south-west of spawn (seed 42), outside the spawn safe zone, and land gently.
  const spawnPos = await a.evaluate(() => window.lfg.player.body);
  await say(a, `/tp ${Math.round(spawnPos.x) + 8} 100 ${Math.round(spawnPos.z) + 56}`);
  await sleep(2500);
  await a.waitForFunction(() => { const g = window.lfg, b = g.player.body; return g.world.isLoaded(Math.floor(b.x), 50, Math.floor(b.z)); }, null, { timeout: 20000, polling: 250 });
  await a.evaluate(() => {
    const g = window.lfg, b = g.player.body;
    let y = 120; while (y > 1 && !g.table.solid[g.world.getBlock(Math.floor(b.x), y, Math.floor(b.z))]) y--;
    g.send({ t: "chat", text: `/tp ${b.x.toFixed(1)} ${y + 1} ${b.z.toFixed(1)}` });
  });
  await sleep(1500);
  await say(a, "/gamemode survival");
  await a.evaluate(() => { window.lfg.player.flying = false; window.lfg.player.creative = false; });
  await sleep(6000); // let the rule changes arrive

  await say(a, "/event a swarm of pirate ships raid the nearest coast in 3 waves, with a boss");
  await a.waitForFunction(() => { const b = document.querySelector(".banner"); return !!b && b.classList.contains("arrival") && b.innerText.includes("Pirate Raid"); }, null, { timeout: 60000, polling: 200 });
  check(true, "the pirate raid arrived as a world event");
  await a.waitForFunction(() => document.querySelector(".scenario.show"), null, { timeout: 10000, polling: 200 });
  check(/Ships approaching/.test(await hudText(a)), `HUD: ${(await hudText(a)).replace(/\n/g, " ")}`);
  check(await b.waitForFunction(() => document.querySelector(".scenario.show"), null, { timeout: 10000, polling: 250 }).then(() => true, () => false), "Bob sees the raid HUD too");
  // Bob comes along to watch, flying in creative (the raiders leave creative players alone).
  await b.evaluate(() => window.lfg.ui.toggleHelp());
  await say(b, "/gamemode creative");
  await b.evaluate(() => {
    const g = window.lfg, at = g.ui.scenarioHud.at;
    g.player.creative = true; g.player.flying = true;
    g.send({ t: "chat", text: `/tp ${at[0].toFixed(1)} ${at[1] + 10} ${at[2].toFixed(1)}` });
  });
  // Walk to the beach the HUD points at, and watch the ships come in.
  await a.evaluate(() => {
    const g = window.lfg, at = g.ui.scenarioHud.at;
    g.send({ t: "chat", text: `/tp ${at[0].toFixed(1)} ${at[1] + 0.2} ${at[2].toFixed(1)}` });
  });
  await sleep(4000);
  await face(a, "ship", 1);
  await sleep(300);
  await a.screenshot({ path: join(out, "scenario-1-ships.png") });
  const shipCount = await a.evaluate(() => [...window.lfg.entities.views.values()].filter((v) => v.type.summon?.body === "ship").length);
  check(shipCount === 3, `${shipCount} ships in view`);

  await a.waitForFunction(() => /Wave 1/.test(document.querySelector(".scenario")?.innerText ?? ""), null, { timeout: 90000, polling: 250 });
  check(true, "the ships anchored and wave 1 began");
  await sleep(5000);
  await face(a, "biped");
  await sleep(300);
  await a.screenshot({ path: join(out, "scenario-2-raiders.png") });

  // Hold the beach: swing at raiders in reach; step out of slam rings.
  let shotBoss = false, shotSlam = false, slamDodged = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    const s = await a.evaluate(() => {
      const g = window.lfg, b = g.player.body;
      const foes = [...g.entities.views.values()].filter((v) => v.type.summon?.body === "biped");
      const ring = g.renderer.rings[0];
      const hud = document.querySelector(".scenario")?.innerText ?? "";
      const boss = !!document.querySelector(".boss");
      if (ring && !ring.dodged) {
        // Step out of the ring (away from its centre) like a player would.
        ring.dodged = true;
        const cx = ring.group.position.x, cz = ring.group.position.z;
        const dx = b.x - cx, dz = b.z - cz, d = Math.hypot(dx, dz) || 1;
        return { ring: true, cx, cz, r: ring.radius, dx: dx / d, dz: dz / d, hud, boss };
      }
      const near = foes.filter((v) => Math.hypot(v.pos.x - b.x, v.pos.z - b.z) < 3.2).sort((p, q) => Math.hypot(p.pos.x - b.x, p.pos.z - b.z) - Math.hypot(q.pos.x - b.x, q.pos.z - b.z))[0];
      if (near) g.send({ t: "attack", entity: near.id });
      return { ring: false, hud, boss, foes: foes.length };
    });
    if (s.ring) {
      await a.evaluate(([cx, cz, r, dx, dz]) => { const b = window.lfg.player.body; b.x = cx + dx * (r + 2); b.z = cz + dz * (r + 2); }, [s.cx, s.cz, s.r, s.dx, s.dz]);
      slamDodged++;
      if (!shotSlam) {
        // Just outside the ring, looking at it: the boss winding up and the ring filling.
        await a.evaluate(([cx, cz]) => {
          const g = window.lfg, p = g.player.body;
          const dx = cx - p.x, dz = cz - p.z;
          g.player.yaw = Math.atan2(-dx, -dz);
          g.player.pitch = -Math.atan2(1.2, Math.hypot(dx, dz));
        }, [s.cx, s.cz]);
        await sleep(200);
        await a.screenshot({ path: join(out, "scenario-4-slam.png") });
        shotSlam = true;
      }
    }
    if (s.boss && !shotBoss) {
      await sleep(2500);
      await face(a, "biped", 0, true);
      await sleep(250);
      await a.screenshot({ path: join(out, "scenario-3-boss.png") });
      shotBoss = true;
    }
    if (/Victory/.test(s.hud)) break;
    await sleep(250);
  }
  const final = await hudText(a);
  check(/Victory/.test(final), `the raid was beaten: ${final.replace(/\n/g, " ")}`);
  check(shotBoss, "a boss came with its health bar");
  check(slamDodged > 0, `boss slams were telegraphed with a ring (${slamDodged}) and stepped out of`);
  // The reward chest on the beach.
  await sleep(1500);
  const chest = await a.evaluate(() => {
    const g = window.lfg, b = g.player.body, id = g.reg.blockId("chest");
    for (let dx = -12; dx <= 12; dx++) for (let dz = -12; dz <= 12; dz++) for (let dy = -4; dy <= 4; dy++) if (g.world.getBlock(Math.floor(b.x) + dx, Math.floor(b.y) + dy, Math.floor(b.z) + dz) === id) return true;
    return false;
  });
  check(chest, "a reward chest appeared on the beach");
  await a.evaluate(() => { const g = window.lfg; g.player.pitch = -0.2; });
  await a.screenshot({ path: join(out, "scenario-5-victory.png") });
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
} catch (err) {
  check(false, err?.stack ?? String(err));
} finally {
  await browser.close();
  stopServer();
  await sleep(800);
  rmSync(dataDir, { recursive: true, force: true });
  if (failed) console.log(`--- server log (tail) ---\n${serverLog.slice(-6000)}`);
  console.log(failed ? "E2E SCENARIO FAILED" : `E2E SCENARIO OK — screenshots in ${out}/`);
  process.exit(failed ? 1 : 0);
}
