// Starting out and bringing friends, in two browsers: Ana makes an invite-only world from the
// title screen and gets her invite link; Ben opens the link, sees who invited him, joins, and
// arrives next to Ana; Ben's next visit offers "Continue"; someone else can't take Ana's name.
// Screenshots of each screen in test-results/friends/.
//   npm run build && node scripts/e2e-friends.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://localhost:${PORT}`;
const out = process.env.OUT ?? "test-results/friends";
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), "lfg2-friends-"));
const server = spawn("npx", ["tsx", "packages/server/src/index.ts"], {
  env: { ...process.env, ANTHROPIC_API_KEY: "", PORT: String(PORT), DATA_DIR: dataDir, SEED: "11", VIEW_DISTANCE: "2", PUBLIC_URL: BASE, ADMINS: "nobody" },
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
let failed = false;
const check = (ok, what) => { console.log(`${ok ? "✓" : "✗"} ${what}`); if (!ok) failed = true; };
const errors = [];
const newPlayer = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } }); // its own storage: another person
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  return page;
};
const inGame = (page) => page.waitForFunction(() => window.lfg && window.lfg.world.meshCount > 4, null, { timeout: 60000, polling: 250 })
  .catch(async (e) => { throw new Error(`${e.message} (screen says: ${await page.textContent("#status").catch(() => "?")}; in game: ${await page.evaluate(() => !!window.lfg)})`); });
try {
  // ---- Ana makes a world
  const ana = await newPlayer();
  await ana.goto(BASE);
  await ana.fill("#name", "Ana");
  await sleep(600);
  await ana.screenshot({ path: join(out, "1-title.png") });
  await ana.click("#create-box summary");
  await ana.fill("#c-title", "Neon Isles");
  await ana.fill("#c-theme", "glowing neon islands at night");
  await ana.check('input[name="c-access"][value="invite"]');
  await ana.selectOption("#c-time", "dusk");
  await ana.screenshot({ path: join(out, "2-create.png") });
  await ana.click("#create button[type=submit]");
  await inGame(ana);
  check(true, "Ana made Neon Isles and is in it");
  await sleep(1500);
  const steps = await ana.evaluate(() => document.querySelector(".steps")?.textContent ?? "");
  check(/First steps/.test(steps), `first steps shown: ${steps.slice(0, 80)}…`);
  await ana.evaluate(() => window.lfg.ui.toggleHelp());
  await ana.screenshot({ path: join(out, "3-first-steps.png") });
  // Her invite link, from the menu.
  // Esc: the pointer is released and the menu shows (headless Chrome grants the lock, so release it).
  await ana.evaluate(() => document.exitPointerLock());
  await ana.waitForFunction(() => !document.querySelector(".screen.pause").hidden, null, { timeout: 5000 }).catch(() => ana.evaluate(() => window.lfg.ui.showPause(true)));
  await ana.click(".invite-panel > button");
  await ana.waitForFunction(() => document.querySelector(".invite-row input")?.value, null, { timeout: 10000 })
    .catch(async (e) => { throw new Error(`${e.message}; chat: ${await ana.evaluate(() => [...document.querySelectorAll(".chat-line")].map((x) => x.textContent).slice(-4).join(" | "))}; pause shown: ${await ana.evaluate(() => !document.querySelector(".screen.pause").hidden)}`); });
  const link = await ana.evaluate(() => document.querySelector(".invite-row input").value);
  check(/\?join=[a-z0-9]{8}$/.test(link), `invite link: ${link}`);
  await ana.screenshot({ path: join(out, "4-invite-panel.png") });
  await ana.evaluate(() => window.lfg.ui.showPause(false));

  // ---- Ben opens the link
  const ben = await newPlayer();
  await ben.goto(link);
  await ben.waitForFunction(() => /invited you/.test(document.getElementById("invite-text")?.textContent ?? ""), null, { timeout: 10000 });
  await ben.fill("#name", "Ben");
  await sleep(500);
  const label = await ben.textContent("#play");
  check(/Join Ana in Neon Isles/.test(label), `Ben's button: "${label}"`);
  await ben.screenshot({ path: join(out, "5-invited.png") });
  await ben.click("#play");
  await inGame(ben);
  await sleep(2500);
  const gap = await ben.evaluate(() => {
    const g = window.lfg, ana = [...g.entities.views.values()].find((v) => v.name === "Ana");
    return ana ? Math.hypot(ana.pos.x - g.player.body.x, ana.pos.z - g.player.body.z) : 999;
  });
  check(gap < 4, `Ben arrived next to Ana (${gap.toFixed(1)} blocks)`);
  // Ben looks at Ana.
  await ben.evaluate(() => {
    const g = window.lfg, a = [...g.entities.views.values()].find((v) => v.name === "Ana");
    if (!a) return;
    const b = g.player.body, dx = a.pos.x - b.x, dz = a.pos.z - b.z;
    g.player.yaw = Math.atan2(-dx, -dz); g.player.pitch = -0.25;
    g.ui.toggleHelp();
  });
  await sleep(800);
  await ben.screenshot({ path: join(out, "6-next-to-ana.png") });
  const anaChat = await ana.evaluate(() => [...document.querySelectorAll(".chat-line")].map((e) => e.textContent).join("\n"));
  check(/Ben joined, invited by Ana/.test(anaChat), "everyone hears Ben came with Ana's invite");
  check(/right next to you/.test(anaChat), "Ana hears Ben is next to her");
  await ana.screenshot({ path: join(out, "7-ana-sees-ben.png") });

  // ---- Ben comes back later: straight back in
  await ben.goto(BASE);
  await ben.waitForFunction(() => /Continue in/.test(document.getElementById("play").textContent), null, { timeout: 10000 }).catch(() => {});
  const again = await ben.textContent("#play");
  check(/Continue in Neon Isles/.test(again), `Ben's next visit: "${again}"`);
  await ben.click("#worlds-box summary");
  await sleep(300);
  await ben.screenshot({ path: join(out, "8-continue.png") });

  // ---- Friends: Ben sees Ana online on the title screen, and joins her from there
  await ben.waitForFunction(() => /Ana/.test(document.getElementById("friends")?.textContent ?? ""), null, { timeout: 10000 }).catch(() => {});
  const fl = await ben.evaluate(() => document.getElementById("friends")?.textContent ?? "");
  check(/Ana.*in Neon Isles/.test(fl), `Ben's friends: ${fl.slice(0, 70)}`);
  await ben.screenshot({ path: join(out, "8b-friends.png") });
  await ben.click("#friends .friend.online");
  await inGame(ben);
  await sleep(2500);
  const gap2 = await ben.evaluate(() => {
    const g = window.lfg, ana = [...g.entities.views.values()].find((v) => v.name === "Ana");
    return ana ? Math.hypot(ana.pos.x - g.player.body.x, ana.pos.z - g.player.body.z) : 999;
  });
  check(gap2 < 4, `Ben joined Ana from his friends list, next to her (${gap2.toFixed(1)} blocks)`);
  // Ana's menu lists Ben.
  await ana.evaluate(() => document.exitPointerLock());
  await ana.waitForFunction(() => !document.querySelector(".screen.pause").hidden, null, { timeout: 5000 }).catch(() => ana.evaluate(() => window.lfg.ui.showPause(true)));
  await sleep(300);
  const anaFriends = await ana.evaluate(() => document.querySelector(".friends-list")?.textContent ?? "");
  check(/Ben.*here/.test(anaFriends), `Ana's friends list: ${anaFriends.slice(0, 60)}`);
  await ana.screenshot({ path: join(out, "8c-ana-friends.png") });

  // ---- Someone else can't be Ana
  const fake = await newPlayer();
  await fake.goto(`${BASE}/?world=neon-isles`);
  await fake.fill("#name", "Ana");
  await sleep(600);
  await fake.click("#play");
  await fake.waitForFunction(() => /belongs to someone else/.test(document.getElementById("status").textContent), null, { timeout: 10000 }).catch(() => {});
  const refused = await fake.textContent("#status");
  check(/belongs to someone else/.test(refused), "someone else can't play as Ana");
  await fake.screenshot({ path: join(out, "9-name-taken.png") });
  check(!errors.length, errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
} catch (e) {
  console.log(`✗ ${e.message}`);
  failed = true;
} finally {
  await browser.close();
  try { process.kill(-server.pid, "SIGINT"); } catch {}
  await sleep(500);
  rmSync(dataDir, { recursive: true, force: true });
}
console.log(`screenshots in ${out}`);
process.exit(failed ? 1 : 0);
