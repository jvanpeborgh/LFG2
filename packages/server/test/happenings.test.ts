import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { DEFAULT_STANDARDS, PROTOCOL_VERSION, VANILLA_CONTENT, buildRegistry } from "@lfg/shared";
import { Game } from "../src/game";
import { VANILLA_MODULES } from "../src/modules";
import { TestClient } from "./helpers";

const reg = buildRegistry([VANILLA_CONTENT.id], DEFAULT_STANDARDS);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("happenings", () => {
  let dir: string, game: Game, http: Server, url: string;
  const clients: TestClient[] = [];
  const run = async (seconds: number) => { for (let t = 0; t < seconds; t += 0.05) { game.step(0.05); if (Math.round(t * 20) % 10 === 0) await sleep(1); } await sleep(20); };
  const connect = async (name: string) => {
    const c = new TestClient(url);
    await c.open();
    c.send({ t: "hello", name, protocol: PROTOCOL_VERSION, fingerprint: reg.fingerprint() });
    await c.waitFor("welcome");
    clients.push(c);
    return c;
  };
  const say = async (c: TestClient, text: string) => {
    const n = c.messages.length;
    c.send({ t: "chat", text });
    for (let i = 0; i < 100 && !c.messages.slice(n).some((m) => m.t === "chat"); i++) { await sleep(10); await run(0.05); }
    return c.messages.slice(n).filter((m) => m.t === "chat").map((m) => (m as { text: string }).text).join("\n");
  };
  const gravity = () => game.std.balance.player.gravity;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "lfg2-happen-"));
    game = new Game({ modules: VANILLA_MODULES, dataDir: dir, worldName: "t", seed: 5, viewDistance: 2, log: () => {}, randomSeed: 3, admins: ["ada"] });
    await game.init();
    http = createServer();
    new WebSocketServer({ server: http, path: "/ws" }).on("connection", (s) => game.handleConnection(s));
    await new Promise<void>((r) => http.listen(0, r));
    const addr = http.address();
    url = `ws://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/ws`;
  }, 30000);
  afterAll(async () => {
    for (const c of clients) c.ws.close();
    await game.stop();
    http.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("low gravity: rules change for everyone, the HUD counts down, and it all goes back", async () => {
    const a = await connect("Ada");
    const g0 = gravity(), jump0 = game.std.balance.player.jumpBlocks;
    expect(await say(a, "/happen low gravity for 2 minutes")).toMatch(/Low Gravity for 2 min/);
    expect(gravity()).toBeCloseTo(g0 * 0.35, 1);
    expect(game.std.balance.player.jumpBlocks).toBeGreaterThan(jump0 * 2);
    // Clients get the new rules and the HUD.
    await a.waitFor("rules", (m) => m.changes.some(([p]) => p === "balance.player.gravity"));
    await run(1.2);
    const hud = [...a.messages].reverse().find((m) => m.t === "happening") as { title: string; left: number };
    expect(hud.title).toBe("Low Gravity");
    expect(hud.left).toBeGreaterThan(100);
    // Another one can't start on top.
    expect(await say(a, "/happen ice world")).toMatch(/Low Gravity is on/);
    expect(await say(a, "/happen stop")).toMatch(/Stopped/);
    expect(gravity()).toBe(g0);
    expect(game.std.balance.player.jumpBlocks).toBe(jump0);
  }, 30000);

  it("peace day: nobody gets hurt; the floor is lava: natural ground burns, built ground doesn't", async () => {
    const a = clients[0];
    const p = game.players.get("ada")!;
    await say(a, "/happen peace day");
    const h0 = p.entity.health;
    game.kernel.emit("entity:damage", { entity: p.entity, amount: 20, source: { kind: "melee" }, cancelled: false });
    expect(game.kernel.emit("entity:damage", { entity: p.entity, amount: 20, source: { kind: "melee" }, cancelled: false }).cancelled).toBe(true);
    expect(p.entity.health).toBe(h0);
    await say(a, "/happen stop");
    // The floor is lava: stand on grass (natural): it burns after a moment.
    await say(a, "/happen the floor is lava");
    const b = p.entity.body;
    const x = Math.floor(b.x), z = Math.floor(b.z), y = Math.floor(b.y);
    game.world.setBlockTracked(x, y - 1, z, reg.blockId("grass"));
    p.entity.health = 100;
    b.onGround = true;
    for (let i = 0; i < 6; i++) { b.onGround = true; await run(0.5); }
    expect(p.entity.health).toBeLessThan(100);
    // On planks: safe.
    game.world.setBlockTracked(x, y - 1, z, reg.blockId("planks"));
    p.entity.health = 100;
    for (let i = 0; i < 6; i++) { b.onGround = true; await run(0.5); }
    expect(p.entity.health).toBe(100);
    await say(a, "/happen stop");
  }, 30000);

  it("with others online, it's put to a vote", async () => {
    const a = clients[0];
    const b = await connect("Bo");
    const g0 = gravity();
    // Bo isn't an admin (Ada, first here, is): Bo's idea goes to a vote.
    expect(await say(b, "/happen speed world")).toMatch(/vote/);
    expect(await say(a, "/vote no")).toMatch(/yes 1, no 1/);
    await run(22);
    expect(game.std.balance.player.walkSpeed).toBe(DEFAULT_STANDARDS.balance.player.walkSpeed); // tied: not this time
    await say(b, "/happen speed world");
    await say(a, "/vote yes");
    await run(22);
    expect(game.std.balance.player.walkSpeed).toBeGreaterThan(DEFAULT_STANDARDS.balance.player.walkSpeed * 1.5);
    await say(a, "/happen stop");
    expect(game.std.balance.player.walkSpeed).toBe(DEFAULT_STANDARDS.balance.player.walkSpeed);
    expect(gravity()).toBe(g0);
  }, 60000);

  it("/summon says it straight: \"/summon low gravity\" is a happening, \"a fast horse\" is a horse", async () => {
    const svc = game.kernel.services.get("caster:happenings")!.value as { plan(p: unknown, t: string): unknown };
    expect(svc.plan(null, "low gravity")).toBeTruthy();
    expect(svc.plan(null, "make it low gravity for 5 minutes")).toBeTruthy();
    expect(svc.plan(null, "a fast horse")).toBeNull();
    expect(svc.plan(null, "an ice dragon")).toBeNull();
  });
});
