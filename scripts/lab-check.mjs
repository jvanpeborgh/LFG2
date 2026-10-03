// Open the built Creature Lab (packages/client/dist-lab, from `LAB=1 vite build`) in a browser,
// let the meadow run, click a creature, and take screenshots (test-results/lab/).
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";
const dist = resolve("packages/client/dist-lab"), out = resolve("test-results/lab");
mkdirSync(out, { recursive: true });
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer((req, res) => {
  const path = join(dist, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!existsSync(path) || statSync(path).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" }); createReadStream(path).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
for (const [w, h, name] of [[1400, 860, "desktop"], [400, 860, "phone"]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`http://localhost:${server.address().port}/lab.html`);
  await sleep(8000);
  await page.screenshot({ path: join(out, `${name}.png`) });
  if (name === "desktop") {
    await page.click('[data-pick="Cow"]');
    await sleep(500);
    await page.click('[data-show="bite"], [data-action="graze"]').catch(() => {});
    await page.fill("#prompt", "a fire-breathing dragon"); await page.click("button[type=submit]");
    await sleep(1500);
    await page.click('[data-pick="Dragon"], [data-pick="Fire Breathing Dragon"]').catch(() => {});
    await sleep(300);
    await page.click('[data-show="breath"]').catch(() => {});
    await sleep(1600);
    await page.screenshot({ path: join(out, "dragon-breath.png") });
    await page.click("#night"); await sleep(6000);
    await page.screenshot({ path: join(out, "night.png") });
    console.log(await page.evaluate(() => document.getElementById("status").textContent));
  }
  await page.close();
}
console.log(errors.length ? `errors: ${[...new Set(errors)].join(" | ")}` : "no errors");
await browser.close(); server.close();
