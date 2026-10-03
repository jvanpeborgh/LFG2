import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import {
  DEFAULT_STANDARDS, PROTOCOL_VERSION, VANILLA_CONTENT, buildRegistry, castCost, type ProgressHud, type WorldEventNotice,
} from "@lfg/shared";
import { Game } from "../src/game";
import { VANILLA_MODULES } from "../src/modules";
import { TestClient } from "./helpers";

const reg = buildRegistry([VANILLA_CONTENT.id], DEFAULT_STANDARDS);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const std = DEFAULT_STANDARDS;

describe("progression: levels gate what you can summon", () => {
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
  const settle = async () => { while (game.events.pending > 0) await run(0.5); };
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
    await sleep(150);
    return c.messages.slice(n).filter((m) => m.t === "chat").map((m) => (m as { text: string }).text).join("\n");
  };
  const progress = (c: TestClient) => ([...c.messages].reverse().find((m) => m.t === "progress") as { progress: ProgressHud }).progress;
  const lastEvent = (c: TestClient, re: RegExp) =>
    [...c.messages].reverse().find((m) => m.t === "worldEvent" && re.test((m as { event: WorldEventNotice }).event.title)) as { event: WorldEventNotice } | undefined;
  const player = (name: string) => game.players.get(name.toLowerCase())!;
  const state = (name: string) => player(name).data.progress as { xp: number; aether: number; shards: number };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "lfg2-progression-"));
    game = new Game({
      modules: VANILLA_MODULES, dataDir: dir, worldName: "t", seed: 42, viewDistance: 2, log: () => {}, randomSeed: 5,
      eventTiming: { gatherSeconds: { minor: 0.5, major: 0.5, epic: 0.5 }, watchSeconds: 1, spacingSeconds: { minor: 0, major: 0, epic: 0 } },
    });
    await game.init();
    http = createServer();
    new WebSocketServer({ server: http, path: "/ws" }).on("connection", (s) => game.handleConnection(s));
    await new Promise<void>((r) => http.listen(0, r));
    const addr = http.address();
    url = `ws://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/ws`;
    a = await connect("Alice");
    b = await connect("Bob");
    await sleep(300);
  }, 30000);

  afterAll(async () => {
    a.ws.close(); b.ws.close();
    await game.stop();
    http.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("starts everyone at level 1 with a full bar of aether", async () => {
    const p = await a.waitFor("progress");
    expect(p.progress).toMatchObject({ level: 1, xp: 0, next: 100, aether: 100, aetherMax: 100, shards: 0, tier: 1, nextTierLevel: 4 });
  });

  it("scales a summon above your tier down, says what it needs, and charges the smaller tier", async () => {
    const before = state("Alice").aether;
    const reply = await say(a, "/summon a red dragon");
    expect(reply).toMatch(/Summoning Young Red Dragon/);
    expect(reply).toMatch(/is tier 3 .*needs level 8, or a ritual: \/ritual a red dragon/);
    expect(before - state("Alice").aether).toBeCloseTo(castCost(1, std).aether, 0);
    await run(1.5);
    expect(lastEvent(a, /Young Red Dragon/)?.event.phase).toBe("arrival");
    const dragon = [...game.entities.all.values()].find((e) => e.type.summon?.name === "Young Red Dragon")!;
    expect(dragon.type.summon!.temperament).toBe("passive"); // tier 1 things are harmless
    expect(dragon.type.summon!.length).toBeLessThanOrEqual(2);
    await settle();
  }, 30000);

  it("refuses when you can't pay, and refunds most of it when a summon fizzles", async () => {
    state("Alice").aether = 3;
    expect(await say(a, "/summon a pig")).toMatch(/not enough aether \(3\/5\)/);
    state("Alice").aether = 50;
    // Going over the per-player summon limit fizzles it during the checks, after paying.
    await say(a, "/summon five pigs");
    await say(a, "/summon five cows");
    const paid = state("Alice").aether;
    await run(1.5); await settle();
    expect(lastEvent(a, /Cow/)?.event.phase).toBe("fizzle");
    // 75% of what it cost comes back.
    expect(state("Alice").aether - paid).toBeGreaterThan(castCost(1, std).aether * std.progression.aether.fizzleRefund - 0.5);
    await say(a, "/unsummon");
  }, 30000);

  it("levels up with XP, announces new tiers, and keeps it across sessions", async () => {
    const reply = await say(a, "/xp give 1000");
    expect(reply).toMatch(/reached level 5: Notable \(tier 2\) summons unlocked/);
    expect(progress(a)).toMatchObject({ level: 5, tier: 2, nextTierLevel: 8 });
    a.ws.close();
    await sleep(200);
    a = await connect("Alice");
    expect((await a.waitFor("progress")).progress.level).toBe(5);
  }, 30000);

  it("caps XP from normal play per minute", async () => {
    const x0 = state("Bob").xp;
    const bob = player("Bob");
    for (let i = 0; i < 20; i++) game.makeApi("test").emit("block:broken", { player: bob, x: 0, y: 0, z: 0, block: 1 });
    expect(state("Bob").xp - x0).toBe(std.progression.xp.playMaxPerMinute);
  });

  it("casts above your tier as a ritual: helpers join the circle, the cost is shared", async () => {
    await say(a, "/xp level 6");
    await say(a, "/aether fill");
    await say(b, "/aether fill");
    await say(a, "/aether shards 2");
    // Away from spawn so the dragon can hunt, Bob standing next to Alice.
    const pa = player("Alice"), pb = player("Bob");
    game.teleport(pb, pa.entity.x + 1, pa.entity.y, pa.entity.z);
    await sleep(50);
    // A leader too low for the tier can't start it.
    expect(await say(b, "/ritual a red dragon")).toMatch(/one tier above its leader's, so it needs a leader of level 4\+/);
    const start = await say(a, "/ritual a red dragon");
    expect(start).toMatch(/begins a ritual to summon Red Dragon \(tier 3\)\. 1 helper needed/);
    expect((await b.waitFor("ritual", (m) => !!m.ritual)).ritual).toMatchObject({ by: "Alice", needed: 1, joined: [] });
    const xpBob = state("Bob").xp;
    const joined = await say(b, "/join");
    expect(joined).toMatch(/The ritual is complete: Alice, Bob summon Red Dragon/);
    const cost = castCost(3, std);
    expect(state("Alice").aether).toBeCloseTo(100 - cost.aether / 2, 0);
    expect(state("Bob").aether).toBeCloseTo(100 - cost.aether / 2, 0);
    expect(state("Alice").shards).toBe(2 - cost.shards);
    expect(state("Bob").xp - xpBob).toBe(std.progression.xp.ritualJoin);
    await run(1.5);
    const ev = lastEvent(a, /Red Dragon/)!;
    expect(ev.event.by).toBe("Alice + Bob");
    expect(ev.event.detail).toMatch(/tier 3/);
    await settle();
    await say(a, "/unsummon");
  }, 30000);

  it("a ritual nobody joins fades, and the leader casts what they can alone", async () => {
    await say(a, "/aether fill");
    await say(a, "/ritual a red dragon");
    const pb = player("Bob");
    game.teleport(pb, pb.entity.x + 40, pb.entity.y + 5, pb.entity.z);
    expect(await say(b, "/join")).toMatch(/Stand in Alice's circle/);
    await run(std.progression.ritual.joinSeconds + 1);
    expect(a.messages.filter((m) => m.t === "chat").map((m) => (m as { text: string }).text).join("\n")).toMatch(/The ritual faded: 0\/1 joined[\s\S]*Summoning Young Red Dragon/);
    await settle();
    await say(a, "/unsummon");
  }, 60000);

  it("gives the creator XP when others enjoy their summon", async () => {
    await say(a, "/aether fill");
    await say(a, "/summon a pig");
    await run(1.5);
    await settle();
    const pig = [...game.entities.all.values()].find((e) => e.type.summon?.name === "Pig")!;
    const pb = player("Bob");
    const x0 = state("Alice").xp;
    // Bob hangs around the pig for a while.
    for (let i = 0; i < 25; i++) { game.teleport(pb, pig.x + 2, pig.y + 0.5, pig.z); await run(1); }
    expect(state("Alice").xp - x0).toBe(std.progression.xp.creationEngagedPlayer);
  }, 60000);
});
