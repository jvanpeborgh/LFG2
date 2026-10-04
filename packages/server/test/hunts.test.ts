import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { DEFAULT_STANDARDS, PROTOCOL_VERSION, VANILLA_CONTENT, buildRegistry, type ServerMessage } from "@lfg/shared";
import { Game } from "../src/game";
import type { SummonService } from "../src/modules/vanilla/summons";
import { VANILLA_MODULES } from "../src/modules";
import { TestClient } from "./helpers";

const reg = buildRegistry([VANILLA_CONTENT.id], DEFAULT_STANDARDS);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type HuntMsg = Extract<ServerMessage, { t: "hunt" }>;


describe("hunts", () => {
  let dir: string, game: Game, http: Server, c: TestClient;
  const run = async (seconds: number) => {
    for (let t = 0; t < seconds; t += 0.05) { game.step(0.05); if (Math.round(t * 20) % 10 === 0) await sleep(1); }
    await sleep(20);
  };
  const lastHunt = () => [...c.messages].reverse().find((m) => m.t === "hunt") as HuntMsg | undefined;
  const player = () => game.players.get("hunter")!;
  const say = async (text: string) => {
    const n = c.messages.length;
    c.send({ t: "chat", text });
    for (let i = 0; i < 100 && !c.messages.slice(n).some((m) => m.t === "chat"); i++) { await sleep(10); await run(0.05); }
    return c.messages.slice(n).filter((m) => m.t === "chat").map((m) => (m as { text: string }).text).join("\n");
  };
  const summons = () => game.kernel.services.get("summons")!.value as SummonService;
  const isQuarry = (id: number) => !!summons().info(id)?.owner?.startsWith("hunt:");
  const quarry = () => [...game.entities.all.values()].find((e) => !e.removed && isQuarry(e.id));

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "lfg2-hunts-"));
    game = new Game({ modules: VANILLA_MODULES, dataDir: dir, worldName: "t", seed: 12, viewDistance: 4, log: () => {}, randomSeed: 3 });
    await game.init();
    http = createServer();
    new WebSocketServer({ server: http, path: "/ws" }).on("connection", (s) => game.handleConnection(s));
    await new Promise<void>((r) => http.listen(0, r));
    const addr = http.address();
    c = new TestClient(`ws://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/ws`);
    await c.open();
    c.send({ t: "hello", name: "Hunter", protocol: PROTOCOL_VERSION, fingerprint: reg.fingerprint() });
    await c.waitFor("welcome");
    await run(2);
  }, 30000);

  afterAll(async () => {
    c.ws.close();
    await game.stop();
    http.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("lets a boss loose far off; it roams and leaves tracks; bring it down for gear and XP", async () => {
    expect(await say("/hunt an angry wolf")).toMatch(/The hunt is on: the .*Wolf/i);
    const e = quarry()!;
    expect(e).toBeDefined();
    const p = player();
    expect(Math.hypot(e.x - p.entity.x, e.z - p.entity.z)).toBeGreaterThan(30);
    // It roams, leaving tracks; the HUD gives a clue.
    const x0 = e.x, z0 = e.z;
    await run(20);
    const h = lastHunt()!;
    expect(h.phase).toBe("on");
    expect(h.title).toMatch(/Wolf/i);
    expect(h.clue).toMatch(/north|south|east|west/);
    expect(h.left).toBeGreaterThan(800);
    expect(Math.hypot(e.x - x0, e.z - z0)).toBeGreaterThan(12);
    // Walk up to it: its tracks show, and the clue turns exact.
    game.teleport(p, e.x + 3, e.y, e.z);
    await run(1.5);
    expect(lastHunt()!.tracks.length).toBeGreaterThan(0);
    expect(lastHunt()!.clue).toMatch(/Fresh tracks/);
    const xp0 = (p.data.progress as { xp: number }).xp;
    // Bring it down.
    game.damage(e, 100000, { kind: "melee", attacker: p.entity });
    await run(1);
    expect(lastHunt()!.phase).toBe("over");
    const said = JSON.stringify(c.messages.slice(-60));
    expect(said).toMatch(/brought down the .*Wolf/i);
    expect(said).toMatch(/found .*\((common|uncommon|rare|epic|legendary)\)/);
    expect((p.data.progress as { xp: number }).xp).toBeGreaterThan(xp0);
  }, 60000);

  it("gets away when time runs out, or when it's called off", async () => {
    expect(await say("/hunt an angry wolf for 3 minutes")).toMatch(/The hunt is on/);
    expect(await say("/hunt a bear")).toMatch(/A hunt is on already/);
    expect(await say("/hunt stop")).toMatch(/Stopped/);
    expect(lastHunt()!.phase).toBe("over");
    expect(quarry()).toBeUndefined();
  }, 60000);
});
