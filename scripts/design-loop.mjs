// The design loop as an agent runs it, through the MCP server: read the guide, check a design,
// render it, and (with SAVE=1) save it. Designs are JSON files; renders go to test-results/designs.
//   npm run build && node scripts/design-loop.mjs scripts/designs/lantern-moth.json [more.json] [STYLE=smooth]
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://localhost:${PORT}`;
const out = process.env.OUT ?? "test-results/designs";
mkdirSync(out, { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), "lfg2-designs-"));
const server = spawn("npx", ["tsx", "packages/server/src/index.ts"], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, SEED: "42", VIEW_DISTANCE: "3", PUBLIC_URL: BASE }, stdio: ["ignore", "pipe", "pipe"], detached: true });
let log = "";
server.stdout.on("data", (d) => (log += d)); server.stderr.on("data", (d) => (log += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 80 && !log.includes("listening"); i++) await sleep(250);
const mcp = new Client({ name: "design-loop", version: "1.0.0" });
await mcp.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`)));
try {
  for (const file of process.argv.slice(2)) {
    const design = JSON.parse(readFileSync(file, "utf8"));
    const name = basename(file, ".json");
    const r = await mcp.callTool({ name: "render_design", arguments: { design, ...(process.env.STYLE ? { style: process.env.STYLE } : {}) } });
    const img = r.content.find((c) => c.type === "image");
    const txt = r.content.find((c) => c.type === "text")?.text ?? "";
    if (img) writeFileSync(join(out, `${name}${process.env.STYLE ? `-${process.env.STYLE}` : ""}.jpg`), Buffer.from(img.data, "base64"));
    let j; try { j = JSON.parse(txt); } catch { j = { raw: txt }; }
    console.log(`── ${name}: ${r.isError ? "ERROR" : j.ok ? "ok" : "not ok"}`);
    for (const i of j.issues ?? []) console.log(`   ${i.level} ${i.path}: ${i.message} → ${i.hint}`);
    for (const e of j.errors ?? []) console.log(`   error: ${e}`);
    for (const w of j.warnings ?? []) console.log(`   warning: ${w}`);
    if (j.playtest) console.log(`   playtest: ${typeof j.playtest === "string" ? j.playtest : `${j.playtest.ok ? "ok" : "FAILED"} ${[...j.playtest.errors, ...j.playtest.warnings].join("; ")}`}`);
    if (j.size) console.log(`   ${j.size.join(" × ")} blocks · tier ${j.tier} · ${j.triangles} · ${JSON.stringify(j.stats)}`);
    if (j.raw) console.log(`   ${j.raw.slice(0, 1500)}`);
  }
} finally {
  await mcp.close().catch(() => {});
  try { process.kill(-server.pid, "SIGINT"); } catch {}
  await sleep(600);
  rmSync(dataDir, { recursive: true, force: true });
}
