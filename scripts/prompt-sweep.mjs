// The "any prompt" test: for each prompt, do what an agent's first try does through the MCP
// server (interpret_prompt → check_design with the prompt → render_design), and summarise:
// which skill and mood it got, the critique score, errors, and a contact sheet of the renders.
//   npm run build && node scripts/prompt-sweep.mjs "a giant snail" "a phoenix" ...   (or no args: the default set)
//   STYLE=voxel|smooth|lowpoly|sculpted to preview a style; POSES=0.05,0.15,0.25,0.35 for filmstrips of the motion.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const DEFAULT = [
  "a giant snail", "a unicorn", "a phoenix", "an octopus", "a crocodile", "a mushroom creature", "a treant", "a fire elemental",
  "a robot crab", "a jellyfish", "a penguin", "a frog", "a spider", "a turtle", "a bee", "a snake",
];
const prompts = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;
const out = process.env.OUT ?? "test-results/sweep";
mkdirSync(out, { recursive: true });
const PORT = 8000 + Math.floor(Math.random() * 900);
const BASE = `http://localhost:${PORT}`;
const dataDir = mkdtempSync(join(tmpdir(), "lfg2-sweep-"));
const server = spawn("npx", ["tsx", "packages/server/src/index.ts"], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, SEED: "42", VIEW_DISTANCE: "3", PUBLIC_URL: BASE }, stdio: ["ignore", "pipe", "pipe"], detached: true });
let log = "";
server.stdout.on("data", (d) => (log += d)); server.stderr.on("data", (d) => (log += d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 80 && !log.includes("listening"); i++) await sleep(250);
const mcp = new Client({ name: "prompt-sweep", version: "1.0.0" });
await mcp.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`)));
const call = async (name, args) => {
  const r = await mcp.callTool({ name, arguments: args });
  const t = r.content.find((c) => c.type === "text")?.text ?? "";
  let data; try { data = JSON.parse(t); } catch { data = t; }
  return { error: !!r.isError, data, image: r.content.find((c) => c.type === "image") };
};
const rows = [], images = [];
try {
  for (const prompt of prompts) {
    const slug = prompt.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    const ip = await call("interpret_prompt", { prompt });
    if (ip.error) { rows.push(`✗ ${prompt}: ${String(ip.data).slice(0, 140)}`); continue; }
    const design = ip.data.start;
    // POSES=0.1,0.2,0.3 renders a filmstrip of each (moving, at those times) to check how it moves.
    const poses = process.env.POSES ? process.env.POSES.split(",").map(Number) : [undefined];
    let r;
    for (const pose of poses) {
      r = await call("render_design", { design, prompt, ...(process.env.STYLE ? { style: process.env.STYLE } : {}), ...(pose !== undefined ? { pose } : {}) });
      if (r.image) { const f = join(out, `${slug}${pose !== undefined ? `-t${pose}` : ""}.jpg`); writeFileSync(f, Buffer.from(r.image.data, "base64")); images.push(f); }
    }
    writeFileSync(join(out, `${slug}.json`), JSON.stringify(design, null, 2));
    const d = r.data;
    const errs = [...(d.issues ?? []).filter((i) => i.level === "error").map((i) => i.message), ...(d.errors ?? [])];
    rows.push(`${errs.length ? "✗" : "✓"} ${prompt} → ${ip.data.brief.skill}/${ip.data.brief.mood} · "${design.name}" · score ${d.critique?.score ?? "?"}${errs.length ? ` · ERRORS: ${errs.join("; ")}` : ""}${d.critique?.issues?.length ? ` · ${d.critique.issues.map((i) => i.message).join("; ")}` : ""}`);
  }
} finally {
  await mcp.close().catch(() => {});
  try { process.kill(-server.pid, "SIGINT"); } catch {}
  await sleep(500);
  rmSync(dataDir, { recursive: true, force: true });
}
console.log(rows.join("\n"));
if (images.length) {
  const { execFileSync } = await import("node:child_process");
  console.log(execFileSync("node", ["scripts/contact-sheet.mjs", `${out}-sheet.jpg`, ...images]).toString().trim());
}
