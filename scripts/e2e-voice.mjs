// End-to-end: voice summons and levels in the browser.
// A fake microphone (Chromium's test device) records a clip, the game server
// sends it to a stand-in transcription service (OpenAI-compatible), and what
// comes back is turned into a command, shown, and sent. Also checks the
// level/aether HUD, the tier scale-down, and a ritual joined by a second player.
//   npm run build && node scripts/e2e-voice.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const out = process.env.E2E_OUT ?? "test-results";
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = (ok, what) => { console.log(`${ok ? "✓" : "✗"} ${what}`); if (!ok) failed = true; };

// The stand-in transcription service: answers with the next line of the script, and records what it got.
const script = ["Summon a red dragon, please.", "Start a ritual to summon a red dragon."];
const uploads = [];
const mock = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    uploads.push({ bytes: body.length, type: /Content-Type: (audio\/[\w-]+)/.exec(body.toString("latin1"))?.[1] });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ text: script[Math.min(uploads.length - 1, script.length - 1)] }));
  });
});
await new Promise((r) => mock.listen(0, r));
const mockUrl = `http://127.0.0.1:${mock.address().port}/v1/audio/transcriptions`;

const PORT = 8000 + Math.floor(Math.random() * 900);
const dataDir = mkdtempSync(join(tmpdir(), "lfg2-e2e-voice-"));
const server = spawn("npx", ["tsx", "packages/server/src/index.ts"], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, SEED: "42", VIEW_DISTANCE: "3", EVENT_PACING: "fast", TRANSCRIBE_URL: mockUrl, TRANSCRIBE_API_KEY: "test" },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));
for (let i = 0; i < 60 && !serverLog.includes("listening"); i++) await sleep(250);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: [
    "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
    // A fake microphone (a test tone) and no permission prompt.
    "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
  ],
});
const errors = [];
const open = async (name) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, permissions: ["microphone"] });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(`http://localhost:${PORT}/?name=${name}&autoplay`);
  await page.waitForFunction(() => window.lfg && window.lfg.world.meshCount > 30, null, { timeout: 90000, polling: 250 });
  await page.evaluate(() => window.lfg.ui.toggleHelp());
  return page;
};
const say = (page, text) => page.evaluate((t) => window.lfg.send({ t: "chat", text: t }), text);
const chatText = (page) => page.evaluate(() => [...document.querySelectorAll(".chat-line")].map((e) => e.textContent).join("\n"));

try {
  const a = await open("Alice");
  const b = await open("Bob");
  await a.bringToFront();
  await say(a, "/time set noon");

  // The level / aether HUD.
  await a.waitForFunction(() => document.querySelector(".level")?.textContent === "1", null, { timeout: 10000, polling: 200 });
  check(true, "the HUD shows level 1");
  check(await a.evaluate(() => !document.querySelector(".mic").hidden), "the mic button is shown (server transcription available)");

  // 1) Hold the mic button, "speak", release: the clip goes to the server and comes back as a command.
  const mic = await a.$(".mic");
  const box = await mic.boundingBox();
  await a.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await a.mouse.down();
  await a.waitForFunction(() => document.querySelector(".voice.listening"), null, { timeout: 5000, polling: 100 });
  check(true, "holding the mic button starts listening");
  await sleep(1500);
  await a.screenshot({ path: join(out, "voice-1-listening.png") });
  await a.mouse.up();
  await a.waitForFunction(() => document.querySelector(".voice.pending"), null, { timeout: 15000, polling: 100 });
  const pending = await a.evaluate(() => document.querySelector(".voice").innerText);
  check(/red dragon/.test(pending) && pending.includes("/summon a red dragon"), `heard and understood: ${pending.replace(/\n/g, " ")}`);
  check(uploads.length === 1 && uploads[0].bytes > 1000, `the server forwarded a ${uploads[0]?.bytes}-byte ${uploads[0]?.type} clip`);
  await a.screenshot({ path: join(out, "voice-2-heard.png") });
  // It sends itself after 2 s. At level 1 a red dragon (tier 3) is scaled down, with a note.
  await a.waitForFunction(() => { const b = document.querySelector(".banner"); return !!b && b.classList.contains("arrival") && b.innerText.includes("Young Red Dragon"); }, null, { timeout: 30000, polling: 200 });
  check(/needs level 8, or a ritual/.test(await chatText(a)), "a level 1 gets a Young Red Dragon, and is told what the real one needs");
  const aether = await a.evaluate(() => window.lfg.ui.progress.aether);
  check(aether <= 96, `casting cost aether (${aether}/100 left)`);
  await sleep(800);
  await a.screenshot({ path: join(out, "voice-3-scaled.png") });

  // 2) A ritual by voice: Alice (level 6) speaks with the B key, Bob joins with J.
  await say(a, "/xp level 6");
  await say(a, "/aether shards 2");
  await say(a, "/unsummon");
  await a.waitForFunction(() => document.querySelector(".level")?.textContent === "6", null, { timeout: 10000, polling: 200 });
  await sleep(400);
  const toast = await a.evaluate(() => document.querySelector(".toast").textContent);
  check(/Level 6!.*Notable summons unlocked/.test(toast), `level up toast: ${toast}`);
  // Bob comes to stand next to Alice.
  const pos = await a.evaluate(() => window.lfg.player.body);
  await say(b, `/tp ${(pos.x + 1).toFixed(1)} ${(pos.y + 0.5).toFixed(1)} ${pos.z.toFixed(1)}`);
  await sleep(1500);
  await a.evaluate(() => { window.lfg.locked = true; }); // as if the game had the pointer (headless can't lock it)
  await a.keyboard.down("KeyB");
  await sleep(1500);
  await a.keyboard.up("KeyB");
  await a.waitForFunction(() => document.querySelector(".voice.pending"), null, { timeout: 15000, polling: 100 });
  check((await a.evaluate(() => document.querySelector(".voice").innerText)).includes("/ritual a red dragon"), "holding B: “start a ritual to summon a red dragon” → /ritual a red dragon");
  await a.keyboard.press("Enter"); // send now
  await b.bringToFront();
  await b.waitForFunction(() => document.querySelector(".ritual.show"), null, { timeout: 10000, polling: 200 });
  const prompt = await b.evaluate(() => document.querySelector(".ritual").innerText);
  check(/Alice's ritual: Red Dragon \(tier 3\)/.test(prompt) && /press J to join/.test(prompt), `Bob sees the ritual: ${prompt.replace(/\n/g, " · ")}`);
  await b.evaluate(() => { const g = window.lfg, p = g.player.body, at = g.ui.ritualHud.at; const dx = at[0] - p.x, dz = at[2] - p.z; g.player.yaw = Math.atan2(-dx, -dz) + 0.9; g.player.pitch = -0.6; });
  await sleep(600);
  await b.screenshot({ path: join(out, "voice-4-ritual.png") });
  await b.evaluate(() => { window.lfg.locked = true; });
  await b.keyboard.press("KeyJ");
  await b.waitForFunction(() => { const b = document.querySelector(".banner"); return !!b && b.classList.contains("arrival") && /Red Dragon/.test(b.innerText) && !/Young/.test(b.innerText); }, null, { timeout: 30000, polling: 200 });
  check(true, "Bob pressed J, the ritual completed and the full Red Dragon arrived");
  const by = await b.evaluate(() => document.querySelector(".banner-by").textContent);
  check(/Alice \+ Bob/.test(by), `cast together: ${by}`);
  const bobAether = await b.evaluate(() => window.lfg.ui.progress.aether);
  check(bobAether < 100, `Bob paid his share (${bobAether}/100 left)`);
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
} catch (err) {
  check(false, err?.stack ?? String(err));
} finally {
  await browser.close();
  try { process.kill(-server.pid, "SIGINT"); } catch { /* gone */ }
  mock.close();
  await sleep(800);
  rmSync(dataDir, { recursive: true, force: true });
  if (failed) console.log(`--- server log (tail) ---\n${serverLog.slice(-4000)}`);
  console.log(failed ? "E2E VOICE FAILED" : `E2E VOICE OK — screenshots in ${out}/`);
  process.exit(failed ? 1 : 0);
}
