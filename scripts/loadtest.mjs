// Load test: N bot players join, walk around and chat; reports server tick time.
//   PORT=8080 BOTS=30 SECONDS=30 node scripts/loadtest.mjs   (against a running server)
import { WebSocket } from "ws";

const PORT = process.env.PORT ?? 8080;
const BOTS = Number(process.env.BOTS ?? 30);
const SECONDS = Number(process.env.SECONDS ?? 30);
// The server reports which content fingerprint it expects.
const { fingerprint } = await (await fetch(`http://localhost:${PORT}/health`)).json();
let bytes = 0;
const bots = [];

for (let i = 0; i < BOTS; i++) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const bot = { ws, pos: null, angle: Math.random() * Math.PI * 2 };
  ws.on("open", () => ws.send(JSON.stringify({ t: "hello", name: `bot${i}`, protocol: 1, fingerprint })));
  ws.on("message", (data, bin) => {
    bytes += data.length ?? data.byteLength;
    if (bin) return;
    const m = JSON.parse(data.toString());
    if (m.t === "welcome") bot.pos = [...m.position];
    if (m.t === "teleport") bot.pos = [m.x, m.y, m.z];
    if (m.t === "reject") console.log("rejected:", m.reason);
  });
  bots.push(bot);
  await new Promise((r) => setTimeout(r, 50));
}

const start = Date.now();
const timer = setInterval(() => {
  for (const b of bots) {
    if (!b.pos || b.ws.readyState !== 1) continue;
    b.angle += (Math.random() - 0.5) * 0.3;
    b.pos[0] += Math.cos(b.angle) * 0.2;
    b.pos[2] += Math.sin(b.angle) * 0.2;
    b.ws.send(JSON.stringify({ t: "move", x: b.pos[0], y: b.pos[1], z: b.pos[2], yaw: b.angle, pitch: 0, flying: false, sprinting: false, onGround: true }));
    if (Math.random() < 0.002) b.ws.send(JSON.stringify({ t: "chat", text: "hello from a bot" }));
  }
}, 50);

const samples = [];
const poll = setInterval(async () => {
  const h = await (await fetch(`http://localhost:${PORT}/health`)).json();
  samples.push(h);
}, 2000);

await new Promise((r) => setTimeout(r, SECONDS * 1000));
clearInterval(timer);
clearInterval(poll);
const last = samples.at(-1);
const worst = Math.max(...samples.map((s) => s.avgTickMs));
console.log(JSON.stringify({ bots: BOTS, seconds: (Date.now() - start) / 1000, server: last, worstAvgTickMs: worst, mbReceivedByBots: +(bytes / 1e6).toFixed(1) }));
for (const b of bots) b.ws.close();
process.exit(0);
