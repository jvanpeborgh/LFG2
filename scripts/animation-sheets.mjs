// Contact sheets of how summons move: walk cycles, idle actions, attack warnings and strikes,
// from the model viewer (side view). Images in test-results/animation/.
//   npm run build && node scripts/animation-sheets.mjs
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { chromium } from "playwright-core";
const dist = resolve("packages/client/dist"), out = resolve("test-results/animation");
mkdirSync(join(out, "frames"), { recursive: true });
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
const server = createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const path = u.startsWith("/out/") ? join(out, u.slice(5)) : join(dist, u);
  if (!existsSync(path) || statSync(path).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" }); createReadStream(path).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 920 } });
const sheets = {
  "walk-cycle": [["a horse", "t=0.05", "step 1"], ["a horse", "t=0.25", "step 2"], ["a horse", "t=0.45", "step 3"], ["a horse", "t=0.65", "step 4"], ["a knight", "t=0.1", "knight step 1"], ["a knight", "t=0.3", "knight step 2"], ["a knight", "t=0.5", "knight step 3"], ["a knight", "t=0.7", "knight step 4"]],
  "idle-actions": [["a cow", "", "standing"], ["a cow", "action=graze", "graze"], ["a cow", "action=sniff", "sniff"], ["a dog", "action=sit", "dog sits"], ["a cow", "action=sleep", "sleep"], ["an angry wolf", "action=roar", "roar (spotted you)"], ["a knight", "action=sit", "knight sits"], ["a knight", "action=sleep", "knight sleeps"]],
  "attacks": [["a red dragon", "attack=breath", "breath: warning"], ["a red dragon", "attack=breath&active=1", "breath: fire"], ["a skeleton archer", "attack=shot", "shot: drawing"], ["a skeleton archer", "attack=shot&active=1", "shot: release"], ["an angry charging bull", "attack=charge", "charge: warning"], ["an angry charging bull", "attack=charge&active=1", "charge: rushing"], ["an angry stomping bear", "attack=stomp", "stomp: rearing up"], ["an angry stomping bear", "attack=stomp&active=1", "stomp: slam"]],
};
for (const [sheet, list] of Object.entries(sheets)) {
  const cells = [];
  for (const [i, [prompt, pose, label]] of list.entries()) {
    await page.goto(`http://localhost:${port}/viewer.html?prompt=${encodeURIComponent(prompt)}&style=voxel${pose ? `&${pose}` : ""}`);
    await page.waitForFunction(() => window.viewerReady || document.getElementById("report").textContent, null, { timeout: 20000 });
    const f = `frames/${sheet}-${i}.png`;
    // The side view shows poses best.
    await page.screenshot({ path: join(out, f), clip: { x: 426, y: 0, width: 427, height: 400 } });
    cells.push(`<figure><img src="/out/${f}"><figcaption>${label}</figcaption></figure>`);
  }
  writeFileSync(join(out, `${sheet}.html`), `<!doctype html><style>body{margin:0;background:#1d2330;font:600 20px system-ui;color:#fff}div{display:grid;grid-template-columns:repeat(4,427px);gap:6px;padding:6px}figure{margin:0;position:relative}img{display:block}figcaption{position:absolute;left:8px;bottom:8px;background:#000a;padding:4px 10px;border-radius:6px}</style><div>${cells.join("")}</div>`);
  await page.setViewportSize({ width: 4 * 427 + 30, height: 2 * 406 + 12 });
  await page.goto(`http://localhost:${port}/out/${sheet}.html`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: join(out, `${sheet}.png`) });
  await page.setViewportSize({ width: 1280, height: 920 });
  console.log(`${sheet}.png`);
}
await browser.close(); server.close();
