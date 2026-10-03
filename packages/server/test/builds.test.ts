import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { DEFAULT_STANDARDS, PROTOCOL_VERSION, VANILLA_CONTENT, buildRegistry, type WorldEventNotice } from "@lfg/shared";
import { Game } from "../src/game";
import { VANILLA_MODULES } from "../src/modules";
import { TestClient } from "./helpers";

const reg = buildRegistry([VANILLA_CONTENT.id], DEFAULT_STANDARDS);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const std = DEFAULT_STANDARDS;

describe("epic builds: raised into the land, temporary unless adopted", () => {
  let dir: string;
  let game: Game;
  let http: Server;
  let url: string;
  let a: TestClient, b: TestClient;

  const run = async (seconds: number) => {
    for (let t = 0; t < seconds; t += 0.05) {
      game.step(0.05);
      if (Math.round(t * 20) % 10 === 0) await sleep(1);
    }
    await sleep(30);
  };
  const settle = async () => { for (let i = 0; i < 60 && game.events.pending > 0; i++) await run(0.5); };
  const connect = async (name: string) => {
    const c = new TestClient(url);
    await c.open();
    c.send({ t: "hello", name, protocol: PROTOCOL_VERSION, fingerprint: reg.fingerprint() });
    await c.waitFor("welcome");
    return c;
  };
  const say = async (c: TestClient, text: string) => {
    const n = c.messages.length;
    c.send({ t: "chat", text });
    // Wait for the reply (slow when every test file runs at once), then a little more for the rest of it.
    const replied = () => c.messages.slice(n).some((m) => m.t === "chat");
    for (let i = 0; i < 100 && !replied(); i++) await sleep(30);
    await sleep(150);
    return c.messages.slice(n).filter((m) => m.t === "chat").map((m) => (m as { text: string }).text).join("\n");
  };
  const allChat = (c: TestClient) => c.messages.filter((m) => m.t === "chat").map((m) => (m as { text: string }).text).join("\n");
  const lastEvent = (c: TestClient, re: RegExp) =>
    [...c.messages].reverse().find((m) => m.t === "worldEvent" && re.test((m as { event: WorldEventNotice }).event.title)) as { event: WorldEventNotice } | undefined;
  const player = (name: string) => game.players.get(name.toLowerCase())!;
  const villagers = () => [...game.entities.all.values()].filter((e) => e.type.summon?.name === "Villager");

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "lfg2-builds-"));
    game = new Game({
      modules: VANILLA_MODULES, dataDir: dir, worldName: "t", seed: 42, viewDistance: 2, log: () => {}, randomSeed: 11,
      eventTiming: { gatherSeconds: { minor: 0.5, major: 0.5, epic: 0.5 }, watchSeconds: 1, spacingSeconds: { minor: 0, major: 0, epic: 0 } },
    });
    await game.init();
    http = createServer();
    new WebSocketServer({ server: http, path: "/ws" }).on("connection", (s) => game.handleConnection(s));
    await new Promise<void>((r) => http.listen(0, r));
    const addr = http.address();
    url = `ws://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/ws`;
    a = await connect("Builder");
    b = await connect("Visitor");
    // Out east of spawn on open land, looking east.
    const [sx, , sz] = game.world.meta.spawn;
    await game.world.ensureArea(Math.floor(sx) + 100, Math.floor(sz), 3);
    const p = player("Builder");
    const y = game.world.surfaceY(Math.floor(sx) + 60, Math.floor(sz)) + 1;
    game.teleport(p, sx + 60, y, sz);
    p.entity.yaw = -Math.PI / 2;
    await sleep(300);
  }, 60000);

  afterAll(async () => {
    a.ws.close(); b.ws.close();
    await game.stop();
    http.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("scales an epic build to your tier (a level 4 asking for a village gets a house)", async () => {
    expect(await say(a, "/summon a city")).toMatch(/City is tier 5: it needs level 17/);
    await say(a, "/xp level 4");
    const reply = await say(a, "/summon a village");
    expect(reply).toMatch(/Building House \(tier 2/);
    expect(reply).toMatch(/Village is tier 4: it needs level 12, or a ritual/);
    await run(1.5); await settle(); await run(3);
    expect(lastEvent(a, /House/)?.event.phase).toBe("arrival");
    expect(await say(a, "/build list")).toMatch(/House by Builder .* standing/);
  }, 60000);

  it("raises a village from the ground, with villagers, and keeps players out of the walls", async () => {
    await say(a, "/xp level 12");
    await say(a, "/aether fill");
    await say(a, "/aether shards 5");
    expect(await say(a, "/summon a village")).toMatch(/Building Village \(tier 4: 60 aether \+ 3 shards\)/);
    await run(1.5);
    const ev = lastEvent(a, /^Village/)!;
    expect(ev.event.phase, ev.event.detail).toBe("arrival");
    expect(allChat(a)).toMatch(/🏗 Village rises .* It stays 72 h unless 1 other player adopt/);
    await run(4); // it rises, a little each tick
    expect(await say(a, "/build list")).toMatch(/Village by Builder .* standing/);
    expect(villagers().length).toBe(6);
    // Real blocks: houses (planks), glass windows, a well.
    let planks = 0, glass = 0;
    const p = player("Builder");
    for (let x = -70; x <= 70; x++) for (let z = -70; z <= 70; z++) for (let y = 40; y < 90; y++) {
      const id = game.world.getBlock(Math.floor(p.entity.x) + x, y, Math.floor(p.entity.z) + z);
      if (id === reg.blockId("planks")) planks++;
      if (id === reg.blockId("glass")) glass++;
    }
    expect(planks).toBeGreaterThan(300);
    expect(glass).toBeGreaterThan(20);
    // Nobody stuck inside a block.
    for (const q of [player("Builder"), player("Visitor")]) {
      const at = [Math.floor(q.entity.x), Math.floor(q.entity.y), Math.floor(q.entity.z)];
      expect(game.table.solid[game.world.getBlock(at[0], at[1], at[2])]).toBeFalsy();
    }
    // Its state is saved with the world.
    await run(11);
    expect(existsSync(join(dir, "t", "storage", "vanilla_builds", "builds.json"))).toBe(true);
  }, 60000);

  it("one epic build per player per day, and never over player work", async () => {
    await say(a, "/aether fill");
    expect(await say(a, "/summon a castle")).toMatch(/One epic build per player per day/);
    await say(b, "/xp level 12");
    await say(b, "/aether shards 5");
    // Bob has been building all around here: a castle has to go elsewhere (or nowhere).
    const q = player("Visitor"), p = player("Builder");
    game.teleport(q, p.entity.x, p.entity.y + 1, p.entity.z);
    q.entity.yaw = -Math.PI / 2;
    const api = game.makeApi("test");
    for (let x = -100; x <= 100; x += 8) for (let z = -100; z <= 100; z += 8) api.emit("block:broken", { player: q, x: Math.floor(q.entity.x) + x, y: 60, z: Math.floor(q.entity.z) + z, block: 1 });
    await say(b, "/summon a castle");
    await run(1.5); await settle();
    const ev = lastEvent(b, /Castle/)!;
    expect(ev.event.phase).toBe("fizzle");
    expect(ev.event.detail).toMatch(/players have built everywhere close by|other builds are in the way/);
    // The fizzle refunded most of it.
    expect((q.data.progress as { aether: number }).aether).toBeGreaterThan(100 - std.progression.aether.costByTier[3] * (1 - std.progression.aether.fizzleRefund) - 1);
  }, 60000);

  it("is adopted when another player spends time there, and the builder gets XP", async () => {
    const vb = await say(a, "/build list");
    const village = vb.split("\n").find((l) => l.startsWith("Village"))!;
    const [, cx, cz] = village.match(/at \((-?\d+), (-?\d+)\)/)!.map(Number);
    const q = player("Visitor");
    game.teleport(q, cx + 0.5, game.world.surfaceY(cx, cz) + 1, cz + 0.5);
    const xp0 = (player("Builder").data.progress as { xp: number }).xp;
    for (let i = 0; i < 14; i++) { game.teleport(q, cx + 0.5, game.world.surfaceY(cx, cz) + 1, cz + 0.5); await run(5); }
    expect(allChat(a)).toMatch(/🏛 Village has been adopted by Visitor: it stays for good/);
    expect((player("Builder").data.progress as { xp: number }).xp - xp0).toBeGreaterThanOrEqual(std.progression.xp.adopted);
    expect(await say(a, "/build list")).toMatch(/Village .* adopted: stays for good/);
  }, 120000);

  it("fades back into the land exactly as it was, keeping what players changed", async () => {
    const list = await say(a, "/build list");
    const house = list.split("\n").find((l) => l.startsWith("House"))!;
    const id = house.match(/id (\w+)/)![1];
    const [, hx, hz] = house.match(/at \((-?\d+), (-?\d+)\)/)!.map(Number);
    // Something a player put inside the house stays.
    const ys = game.world.surfaceY(hx, hz);
    const keep: [number, number, number] = [hx, ys + 1, hz];
    game.world.setBlockTracked(keep[0], keep[1], keep[2], reg.blockId("tnt"));
    expect(await say(a, `/build expire ${id}`)).toMatch(/Fading/);
    await run(2);
    expect(allChat(a)).toMatch(/🏚 House fades back into the land/);
    expect(await say(a, "/build list")).not.toMatch(/House/);
    expect(game.world.getBlock(keep[0], keep[1], keep[2])).toBe(reg.blockId("tnt"));
    let left = 0;
    for (let x = hx - 8; x <= hx + 8; x++) for (let z = hz - 8; z <= hz + 8; z++) for (let y = ys - 4; y < ys + 14; y++) if (game.world.getBlock(x, y, z) === reg.blockId("planks")) left++;
    expect(left).toBe(0);
  }, 60000);
});
