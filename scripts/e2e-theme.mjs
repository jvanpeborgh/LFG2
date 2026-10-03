// Simulation: a player's chat asks for "a cyberpunk sci-fi samurai inspired world"
// with a reference image, through the MCP server. The world is created with its
// theme; we look at it next to the base world (same seed, same spot), summon
// things that fit, raise a village, and start a raid in the world's theme.
//   npm run build && node scripts/e2e-theme.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { chromium } from "playwright-core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://localhost:${PORT}`;
const out = process.env.E2E_OUT ?? "test-results";
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), "lfg2-e2e-theme-"));
const server = spawn("npx", ["tsx", "packages/server/src/index.ts"], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, SEED: "42", VIEW_DISTANCE: "3", EVENT_PACING: "fast", PUBLIC_URL: BASE },
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

// A stand-in reference image: a neon street at night (dark navy, magenta and cyan signs, vermilion, gold).
const ref = new PNG({ width: 64, height: 64 });
for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
  const i = (y * 64 + x) * 4;
  const c = y < 32 ? [12, 14, 32] : x < 20 ? [255, 40, 160] : x < 36 ? [20, 230, 240] : x < 52 ? [200, 40, 40] : [214, 168, 58];
  ref.data.set([...c, 255], i);
}
const refImage = PNG.sync.write(ref).toString("base64");

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const errors = [];
const open = async (name, world) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(`${BASE}/?name=${name}${world ? `&world=${world}` : ""}&autoplay`);
  await page.waitForFunction(() => window.lfg && window.lfg.world.meshCount > 30, null, { timeout: 90000, polling: 250 });
  await page.evaluate(() => window.lfg.ui.toggleHelp());
  return page;
};
const say = (page, text) => page.evaluate((t) => window.lfg.send({ t: "chat", text: t }), text);
const chat = (page) => page.evaluate(() => [...document.querySelectorAll(".chat-line")].map((e) => e.textContent).join("\n"));
const arrival = (page, title, timeout = 60000) =>
  page.waitForFunction((t) => { const b = document.querySelector(".banner"); return !!b && b.classList.contains("arrival") && b.innerText.includes(t); }, title, { timeout, polling: 200 });
/** The same view in any world: hovering over spawn, looking along the coast. */
const viewpoint = async (page) => {
  await page.evaluate(() => { const g = window.lfg; g.player.creative = true; g.player.flying = true; });
  await say(page, "/gamemode creative");
  const sp = await page.evaluate(() => window.lfg.player.body);
  await say(page, `/tp ${(sp.x + 6).toFixed(1)} ${(sp.y + 14).toFixed(1)} ${(sp.z + 30).toFixed(1)}`);
  await sleep(2500);
  await page.evaluate(() => { const g = window.lfg; g.player.yaw = Math.PI * 0.62; g.player.pitch = -0.32; });
  await sleep(2500);
};
const mcp = new Client({ name: "e2e-theme-chat", version: "1.0.0" });
const call = async (name, args = {}) => {
  const r = await mcp.callTool({ name, arguments: args });
  const t = r.content[0].text;
  try { return { error: !!r.isError, data: JSON.parse(t) }; } catch { return { error: !!r.isError, data: t }; }
};

try {
  // The base world, for comparison.
  const a = await open("Kenji");
  await say(a, "/time set noon");
  await viewpoint(a);
  await a.screenshot({ path: join(out, "theme-0-base-world.png") });

  // The chat: link, preview the theme, create the world.
  await say(a, "/link");
  await sleep(500);
  const code = (await chat(a)).match(/link code: ([A-Z0-9]{3}-[A-Z0-9]{3})/)?.[1];
  await mcp.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`)));
  check((await call("link_player", { code })).data.player === "Kenji", "the chat linked to Kenji");
  const prompt = "a cyberpunk sci-fi samurai inspired world: neon-lit pagodas, cherry blossoms, rain-soaked streets";
  const preview = await call("preview_theme", { theme: prompt, reference_images: [{ data: refImage, mime_type: "image/png" }] });
  console.log(`· preview: ${preview.data.theme.title}; reference colours ${preview.data.theme.referenceColors.join(" ")}; ${preview.data.ruleChanges} rule changes; materials ${JSON.stringify(preview.data.theme.materials)}`);
  check(preview.data.theme.referenceColors.length >= 3, "colours were taken from the reference image");
  const created = await call("create_world", {
    name: "neo-kyoto", title: "Neo-Kyoto", description: "Neon pagodas under a violet sky", seed: 42,
    theme: prompt, reference_images: [{ data: refImage, mime_type: "image/png" }],
  });
  check(created.data.created?.name === "neo-kyoto" && created.data.theme?.title === "Cyberpunk Sci-fi Samurai", `created ${created.data.created?.title}: ${created.data.setup?.join(", ")}`);

  // Kenji (its creator) walks in: at night first, as the theme starts it.
  const k = await open("Kenji2", "neo-kyoto").catch(() => null);
  if (k) await k.close();
  await a.close();
  const w = await open("Kenji", "neo-kyoto");
  await viewpoint(w);
  await w.screenshot({ path: join(out, "theme-1-neo-kyoto-night.png") });
  await say(w, "/time set noon");
  await sleep(2500);
  await w.screenshot({ path: join(out, "theme-2-neo-kyoto-day.png") });

  // Things that fit: summons and a village in the world's style.
  await say(w, "/xp level 20");
  await say(w, "/aether shards 30");
  await say(w, "/gamemode survival");
  await w.evaluate(() => { window.lfg.player.creative = false; });
  for (const s of ["a samurai", "a cyborg"]) {
    await say(w, "/aether fill");
    await say(w, `/summon ${s}`);
    await arrival(w, s === "a samurai" ? "Samurai" : "Cyborg");
  }
  await sleep(2000);
  await w.evaluate(() => {
    const g = window.lfg, b = g.player.body;
    const v = [...g.entities.views.values()].find((v) => v.type.summon?.name === "Samurai");
    if (!v) return;
    const dx = v.pos.x - b.x, dz = v.pos.z - b.z, dy = v.pos.y + 1 - (b.y + 1.62);
    g.player.yaw = Math.atan2(-dx, -dz); g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  });
  await sleep(400);
  await w.screenshot({ path: join(out, "theme-3-samurai.png") });
  check(true, "summoned a samurai and a cyborg");
  // A village takes the world's style: eaves roofs, neon strips.
  const sp = await w.evaluate(() => window.lfg.player.body);
  await say(w, `/tp ${Math.round(sp.x) + 70} 90 ${Math.round(sp.z)}`);
  await sleep(3000);
  await w.evaluate(() => { const g = window.lfg, b = g.player.body; let y = 120; while (y > 1 && !g.table.solid[g.world.getBlock(Math.floor(b.x), y, Math.floor(b.z))]) y--; g.send({ t: "chat", text: `/tp ${b.x.toFixed(1)} ${y + 1} ${b.z.toFixed(1)}` }); g.player.yaw = -Math.PI / 2; });
  await sleep(1500);
  await say(w, "/aether fill");
  await say(w, "/summon a village");
  await arrival(w, "Village");
  await sleep(6000);
  const vm = (await chat(w)).match(/Village rises \d+ blocks \S+ \((-?\d+), (-?\d+)\)/);
  check(!!vm, "the village rose");
  if (vm) {
    const [vx, vz] = [Number(vm[1]), Number(vm[2])];
    await w.evaluate(([x, z]) => {
      const g = window.lfg; let y = 120; while (y > 1 && !g.table.solid[g.world.getBlock(x, y, z)]) y--;
      g.player.creative = true; g.player.flying = true;
      const px = x + 26, pz = z + 26, py = y + 16;
      g.send({ t: "chat", text: `/tp ${px} ${py} ${pz}` });
      g.player.yaw = Math.atan2(-(x - px), -(z - pz)); g.player.pitch = -Math.atan2(16, 37);
    }, [vx, vz]);
    await say(w, "/gamemode creative");
    await sleep(4000);
    await say(w, "/time set dusk");
    await sleep(2500);
    await w.screenshot({ path: join(out, "theme-4-village.png") });
  }
  // A raid with no theme of its own takes the world's: ninjas.
  const raid = await w.evaluate(() => new Promise((res) => {
    const g = window.lfg; const n = document.querySelectorAll(".chat-line").length;
    g.send({ t: "chat", text: "/cost enemies come from the sea in waves, with bosses" });
    setTimeout(() => res([...document.querySelectorAll(".chat-line")].slice(n).map((e) => e.textContent).join("\n")), 600);
  }));
  check(/Ninja Raid/.test(raid), `a raid here is a ${raid.match(/(\w+ Raid)/)?.[1]}`);
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join("; ")}` : ""}`);
} catch (err) {
  check(false, err?.stack ?? String(err));
} finally {
  await mcp.close().catch(() => {});
  await browser.close();
  try { process.kill(-server.pid, "SIGINT"); } catch { /* gone */ }
  await sleep(800);
  rmSync(dataDir, { recursive: true, force: true });
  if (failed) console.log(`--- server log (tail) ---\n${serverLog.slice(-4000)}`);
  console.log(failed ? "E2E THEME FAILED" : `E2E THEME OK — screenshots in ${out}/`);
  process.exit(failed ? 1 : 0);
}
