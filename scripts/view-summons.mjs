// Render summons through the viewer page and save one image per prompt.
//   npm run build && node scripts/view-summons.mjs "a big cloud" "a flying shark"
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";

const dist = resolve("packages/client/dist");
const out = process.env.OUT ?? "test-results/summons";
mkdirSync(out, { recursive: true });
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((req, res) => {
  const path = join(dist, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!path.startsWith(dist) || !existsSync(path) || statSync(path).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" });
  createReadStream(path).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 920 } });
// STYLE=smooth|lowpoly draws them the way a world with that model style would.
const style = process.env.STYLE ?? "voxel";
const prompts = process.argv.slice(2).length ? process.argv.slice(2) : ["a big cloud", "a flying shark"];
for (const prompt of prompts) {
  const errors = [];
  page.removeAllListeners("pageerror");
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/viewer.html?prompt=${encodeURIComponent(prompt)}&style=${style}`);
  await page.waitForFunction(() => window.viewerReady || document.getElementById("report").textContent, null, { timeout: 20000 });
  const file = join(out, `${prompt.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}${style !== "voxel" ? `-${style}` : ""}.png`);
  await page.screenshot({ path: file });
  const report = await page.evaluate(() => document.getElementById("report").textContent);
  console.log(`\n${file}\n${report}${errors.length ? `\nPAGE ERRORS: ${errors.join("; ")}` : ""}`);
}
await browser.close();
server.close();
