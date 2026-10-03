// An agent designs creatures through the MCP server and a player summons them:
// guide → check (a broken design comes back with paths and hints) → fix → render → save,
// then /summon design:<id> in game, a scroll that holds a design, and a live rule change
// that redraws everything in the smooth style.
//   npm run build && node scripts/e2e-designs.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://localhost:${PORT}`;
const out = process.env.E2E_OUT ?? "test-results";
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), "lfg2-e2e-designs-"));
const server = spawn("npx", ["tsx", "packages/server/src/index.ts"], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, SEED: "42", VIEW_DISTANCE: "3", EVENT_PACING: "fast", PUBLIC_URL: BASE, ADMINS: "Iris" },
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
const mcp = new Client({ name: "e2e-designs-chat", version: "1.0.0" });
const call = async (name, args = {}) => {
  const r = await mcp.callTool({ name, arguments: args });
  const t = r.content.find((c) => c.type === "text")?.text ?? "";
  let data; try { data = JSON.parse(t); } catch { data = t; }
  return { error: !!r.isError, data, image: r.content.find((c) => c.type === "image") };
};
/** Triangles drawn for the summon called `name` in the player's client. */
const drawnTriangles = (name) => page.evaluate((n) => {
  const v = [...window.lfg.entities.views.values()].find((v) => v.type.summon?.name === n);
  if (!v?.voxel) return 0;
  let t = 0;
  // Count what's drawn now: for a LOD, only its current level.
  v.voxel.root.traverse((o) => { if (o.isMesh && o.visible && (!o.parent?.isLOD || o.parent.getCurrentLevel() === o.parent.levels.findIndex((l) => l.object === o))) t += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; });
  return t;
}, name);
/** Frame the summon called `name`: stand a few blocks from it, a little above, and look at it. */
const lookAt = async (name) => {
  const ok = await page.evaluate((n) => {
    const g = window.lfg, b = g.player.body;
    const v = [...g.entities.views.values()].find((v) => v.type.summon?.name === n);
    if (!v) return false;
    g.player.creative = true; g.player.flying = true;
    const dx = b.x - v.pos.x, dz = b.z - v.pos.z, d = Math.hypot(dx, dz) || 1;
    const r = Math.max(5, v.type.height * 2.4);
    g.send({ t: "chat", text: `/tp ${(v.pos.x + (dx / d) * r).toFixed(1)} ${(v.pos.y + v.type.height * 0.6).toFixed(1)} ${(v.pos.z + (dz / d) * r).toFixed(1)}` });
    return true;
  }, name);
  if (!ok) return false;
  await sleep(700);
  return page.evaluate((n) => {
    const g = window.lfg, b = g.player.body;
    const v = [...g.entities.views.values()].find((v) => v.type.summon?.name === n);
    if (!v) return false;
    const dx = v.pos.x - b.x, dz = v.pos.z - b.z, dy = v.pos.y + v.type.height / 2 - (b.y + 1.62);
    g.player.yaw = Math.atan2(-dx, -dz); g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    return true;
  }, name);
};

try {
  await page.goto(`${BASE}/?name=Iris&autoplay`);
  await page.waitForFunction(() => window.lfg && window.lfg.world.meshCount > 30, null, { timeout: 90000, polling: 250 });
  await page.evaluate(() => window.lfg.ui.toggleHelp());
  await say("/time set noon");
  await say("/link");
  await sleep(500);
  const code = (await chat()).match(/link code: ([A-Z0-9]{3}-[A-Z0-9]{3})/)?.[1];
  await mcp.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`)));
  check((await call("link_player", { code })).data.player === "Iris", "the chat linked to Iris");

  // 1) The guide: format, primitives, this world's palette, an example.
  const guide = (await call("get_design_guide")).data;
  check(guide.shape?.primitives?.includes("capsule") && guide.palette?.green3 && guide.example?.shape, "get_design_guide: primitives, palette and a working example");

  // 2) A first draft with the usual slips: it comes back with paths and hints, nothing spent.
  const golem = JSON.parse(readFileSync("scripts/designs/moss-golem.json", "utf8"));
  const draft = structuredClone(golem);
  draft.shape.parts[0].shapes[0].type = "cube";
  draft.colors.accent = "moss";
  draft.shape.parts[2].anim = "arm";
  const first = (await call("check_design", { design: draft })).data;
  const paths = first.issues.map((i) => i.path);
  console.log(`· draft issues:\n${first.issues.map((i) => `    ${i.path}: ${i.message} → ${i.hint}`).join("\n")}`);
  check(!first.ok && paths.includes("parts[0].shapes[0].type") && paths.includes("colors.accent") && paths.includes("parts[2].anim"), "check_design points at each mistake");
  check(first.issues.find((i) => i.path === "parts[0].shapes[0].type").hint.includes("box"), 'and says what to use instead ("cube" → box)');
  // 3) Fixed: it passes, playtest included.
  const fixed = (await call("check_design", { design: golem })).data;
  check(fixed.ok && fixed.playtest?.ok, `the fixed design passes (tier ${fixed.tier}, ${fixed.triangles}; playtest ${fixed.playtest?.ok ? "ok" : "failed"})`);
  // 4) Render it the way players will see it, in the world's style and in another.
  for (const style of [undefined, "smooth"]) {
    const r = await call("render_design", { design: golem, ...(style ? { style } : {}) });
    if (r.image) writeFileSync(join(out, `designs-render-golem${style ? `-${style}` : ""}.jpg`), Buffer.from(r.image.data, "base64"));
    check(!r.error && !!r.image && r.data.drawn?.style === (style ?? "voxel"), `render_design returns an image (${r.data.drawn?.style}, ${r.data.drawn?.triangles} triangles)`);
  }
  // 5) Save both designs to the world.
  const moth = JSON.parse(readFileSync("scripts/designs/lantern-moth.json", "utf8"));
  for (const d of [golem, moth]) {
    const s = await call("save_design", { design: d });
    check(!s.error && s.data.saved, `saved "${s.data.name}" as design:${s.data.saved} (tier ${s.data.tier})`);
  }
  check((await call("list_designs")).data.length === 2, "list_designs shows both");

  // 6) In game: summon the golem by its id, away from spawn.
  await say("/xp level 20");
  await say("/aether shards 30");
  const sp = await page.evaluate(() => window.lfg.player.body);
  await say(`/tp ${Math.round(sp.x) + 50} 90 ${Math.round(sp.z) + 20}`);
  await sleep(3000);
  await page.evaluate(() => { const g = window.lfg, b = g.player.body; let y = 120; while (y > 1 && !g.table.solid[g.world.getBlock(Math.floor(b.x), y, Math.floor(b.z))]) y--; g.send({ t: "chat", text: `/tp ${b.x.toFixed(1)} ${y + 1} ${b.z.toFixed(1)}` }); });
  await sleep(1500);
  await say("/gamemode creative"); // it's hostile; the camera just watches
  await page.evaluate(() => { window.lfg.player.creative = true; });
  await say("/aether fill");
  await say("/summon design:moss_golem");
  await arrival("Moss Golem");
  await sleep(2500);
  check(await lookAt("Moss Golem"), "the Moss Golem arrived in the player's world");
  await sleep(400);
  await page.screenshot({ path: join(out, "designs-1-golem-voxel.png") });
  const voxelTris = await drawnTriangles("Moss Golem");

  // 7) A scroll can hold a design: inscribe from the chat, cast from the chat.
  await say("/aether fill");
  const ins = await call("inscribe_scroll", { name: "moth", prompt: "design:lantern_moth" });
  check(!ins.error && ins.data.scroll?.title === "Lantern Moth", "a scroll holds design:lantern_moth");
  await say("/aether fill");
  const cast = await call("cast_scroll", { name: "moth" });
  check(/Summoning Lantern Moth/.test(cast.data.result ?? ""), `cast from the chat: ${cast.data.result?.split("\n")[0]}`);
  await arrival("Lantern Moth");
  await sleep(1500);

  // 8) The world switches to the smooth style: what's already there is redrawn.
  await say("/rule set art.modelStyle smooth");
  await page.waitForFunction(() => window.lfg.std.art.modelStyle === "smooth", null, { timeout: 30000, polling: 200 });
  await sleep(1000);
  const smoothTris = await drawnTriangles("Moss Golem");
  check(smoothTris > 0 && smoothTris !== voxelTris, `the golem was redrawn smooth (${voxelTris} → ${smoothTris} triangles)`);
  await lookAt("Moss Golem");
  await sleep(400);
  await page.screenshot({ path: join(out, "designs-2-golem-smooth.png") });
  await lookAt("Lantern Moth");
  await sleep(400);
  await page.screenshot({ path: join(out, "designs-3-moth-smooth.png") });

  // 9) The art director: words → a brief and a starting design from the skills, critiqued against the brief.
  //    "sculpted" in the prompt makes this summon sculpted for everyone (the world allows prompt styles).
  const words = "a sculpted cute pink dragon";
  const ip = await call("interpret_prompt", { prompt: words });
  check(!ip.error && ip.data.brief?.skill === "winged-creature" && ip.data.brief?.mood === "cute" && ip.data.start?.style === "sculpted", `interpret_prompt: ${ip.data.brief?.skill}, ${ip.data.brief?.mood}, ${ip.data.start?.style}; must read: ${ip.data.brief?.mustRead?.join(", ")}`);
  const dragon = { ...ip.data.start, id: "cute_dragon", length: 3 };
  const crit = (await call("check_design", { design: dragon, prompt: words })).data;
  check(crit.ok && crit.critique?.score >= 80, `the starting design passes, critique score ${crit.critique?.score} (${crit.critique?.passed?.length} checks passed)`);
  const asMean = (await call("check_design", { design: dragon, prompt: "a menacing dragon" })).data;
  check(asMean.critique?.score < crit.critique?.score, `the same design scores lower as a menacing dragon (${asMean.critique?.score}): ${asMean.critique?.issues?.map((i) => i.message).join("; ")}`);
  const skills = (await call("get_design_skill")).data;
  check(Array.isArray(skills) && skills.length >= 5, `get_design_skill lists ${skills.length} skills`);
  const sculptedRender = await call("render_design", { design: dragon, prompt: words });
  if (sculptedRender.image) writeFileSync(join(out, "designs-render-dragon-sculpted.jpg"), Buffer.from(sculptedRender.image.data, "base64"));
  check(sculptedRender.data.drawn?.style === "sculpted" && !!sculptedRender.data.drawn?.closeUp, `rendered in its own style (sculpted, ${sculptedRender.data.drawn?.closeUp?.triangles} triangles up close) in a smooth world`);
  check(!(await call("save_design", { design: dragon })).error, "saved the dragon");
  await say("/aether fill");
  await say("/summon design:cute_dragon");
  await arrival("Cute Pink Dragon");
  await sleep(1500);
  await lookAt("Cute Pink Dragon");
  await sleep(600);
  const dragonTris = await drawnTriangles("Cute Pink Dragon");
  check(dragonTris > 8000, `the dragon is drawn sculpted in a smooth world (${dragonTris} triangles up close)`);
  await page.screenshot({ path: join(out, "designs-4-dragon-sculpted.png") });

  // 10) A prompt in game can ask for a style too; the golem next to it stays in the world's style.
  await say("/aether fill");
  await say("/summon a low-poly wolf");
  await arrival("Wolf");
  await sleep(1500);
  const lowpoly = await page.evaluate(() => {
    const v = [...window.lfg.entities.views.values()].find((v) => v.type.summon?.style === "lowpoly");
    return v ? v.voxel.materials[0].flatShading : null;
  });
  check(lowpoly === true, "/summon a low-poly wolf: drawn low-poly (flat facets) for everyone");
  const golemStill = await drawnTriangles("Moss Golem");
  check(golemStill === smoothTris, `the golem stays in the world's style (${golemStill} triangles)`);
  await lookAt("Wolf");
  await sleep(500);
  await page.screenshot({ path: join(out, "designs-5-lowpoly-wolf.png") });
  await say("/time set night");
  await sleep(2500);
  await lookAt("Lantern Moth");
  await sleep(500);
  await page.screenshot({ path: join(out, "designs-6-moth-night.png") });
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
  console.log(failed ? "E2E DESIGNS FAILED" : `E2E DESIGNS OK — screenshots in ${out}/`);
  process.exit(failed ? 1 : 0);
}
