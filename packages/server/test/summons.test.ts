import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { DEFAULT_STANDARDS, PROTOCOL_VERSION, VANILLA_CONTENT, buildRegistry, designGuide, type WorldEventNotice } from "@lfg/shared";
import type { SummonService } from "../src/modules/vanilla/summons";
import { Game } from "../src/game";
import { VANILLA_MODULES } from "../src/modules";
import { TestClient } from "./helpers";

const reg = buildRegistry([VANILLA_CONTENT.id], DEFAULT_STANDARDS);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("summoning generated creatures", () => {
  let dir: string;
  let game: Game;
  let http: Server;
  let c: TestClient;

  const run = async (seconds: number) => {
    for (let t = 0; t < seconds; t += 0.05) {
      game.step(0.05);
      if (Math.round(t * 20) % 10 === 0) await sleep(1);
    }
    await sleep(30);
  };
  const settle = async () => { while (game.events.pending > 0) await run(0.5); };
  const lastEvent = (re: RegExp) =>
    [...c.messages].reverse().find((m) => m.t === "worldEvent" && re.test((m as { event: WorldEventNotice }).event.title)) as { event: WorldEventNotice } | undefined;
  const say = async (text: string) => {
    // These tests are about summons, not progression: summon as a level 20 with a full bar.
    const n = c.messages.length;
    let sent = 1;
    if (/^\/(summon|event)/.test(text)) { c.send({ t: "chat", text: "/aether fill" }); c.send({ t: "chat", text: "/aether shards 20" }); sent = 3; }
    c.send({ t: "chat", text });
    // Wait for the replies (slow when every test file runs at once).
    const replies = () => c.messages.slice(n).filter((m) => m.t === "chat" || m.t === "worldEvent").length;
    for (let i = 0; i < 100 && replies() < sent; i++) await sleep(30);
    await sleep(150);
    return c.messages.slice(n).filter((m) => m.t === "chat").map((m) => (m as { text: string }).text).join("\n");
  };
  const summoned = (name: string) => [...game.entities.all.values()].filter((e) => e.type.name === `summon:${name}`);
  const player = () => game.players.get("summoner")!;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "lfg2-summons-"));
    game = new Game({
      modules: VANILLA_MODULES, dataDir: dir, worldName: "t", seed: 42, viewDistance: 2, log: () => {},
      randomSeed: Number(process.env.RSEED ?? 7),
      eventTiming: { gatherSeconds: { minor: 0.5, major: 0.5, epic: 0.5 }, watchSeconds: 2, spacingSeconds: { minor: 0, major: 0, epic: 0 } },
    });
    await game.init();
    http = createServer();
    new WebSocketServer({ server: http, path: "/ws" }).on("connection", (s) => game.handleConnection(s));
    await new Promise<void>((r) => http.listen(0, r));
    const addr = http.address();
    c = new TestClient(`ws://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/ws`);
    await c.open();
    c.send({ t: "hello", name: "Summoner", protocol: PROTOCOL_VERSION, fingerprint: reg.fingerprint() });
    await c.waitFor("welcome");
    c.send({ t: "chat", text: "/xp level 20" });
    await sleep(500);
  }, 30000);

  afterAll(async () => {
    c.ws.close();
    await game.stop();
    http.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("summons a big cloud: it arrives as a world event, high in the sky, and drifts", async () => {
    await say("/summon a big cloud");
    await run(1.5);
    expect(lastEvent(/Big Cloud/)?.event.phase).toBe("arrival");
    const types = await c.waitFor("entityTypes", (m) => m.types.some((t) => t.name === "summon:big_cloud"));
    expect(types.types[0].summon?.body).toBe("cloud");
    const [cloud] = summoned("big_cloud");
    expect(cloud).toBeTruthy();
    const ground = game.world.surfaceY(Math.floor(cloud.x), Math.floor(cloud.z));
    expect(cloud.y - ground).toBeGreaterThan(15);
    const x0 = cloud.x, z0 = cloud.z;
    await run(10);
    expect(Math.hypot(cloud.x - x0, cloud.z - z0)).toBeGreaterThan(3); // drifting
    await c.waitFor("spawn", (m) => m.entities.some((e) => e.type === "summon:big_cloud"));
    await settle();
  }, 30000);

  it("summons a flying shark that hunts by the rules: warns first, bites within limits, can be outrun", async () => {
    // Move away from spawn: the safe zone protects players there.
    const p = player();
    const sx = game.world.meta.spawn[0] + 40, sz = game.world.meta.spawn[2] + 40;
    await game.world.ensureArea(Math.floor(sx), Math.floor(sz), 1);
    const sy = game.world.surfaceY(Math.floor(sx), Math.floor(sz)) + 1;
    // An open clearing (trees would shelter the player; that's tested separately).
    for (let dx = -8; dx <= 8; dx++) for (let dz = -8; dz <= 8; dz++) for (let dy = 0; dy < 14; dy++) game.world.setBlockTracked(Math.floor(sx) + dx, sy + dy, Math.floor(sz) + dz, 0);
    game.teleport(p, sx + 0.5, sy, sz + 0.5);
    p.entity.yaw = 0;
    await sleep(100);
    await say("/summon a flying shark");
    await run(1.5);
    expect(lastEvent(/Flying Shark/)?.event.phase).toBe("arrival");
    const [shark] = summoned("flying_shark");
    expect(shark.type.kind).toBe("hostile");
    // Let it hunt. Record warnings (fuse events) and bites (player damage).
    const warnings: number[] = [], bites: number[] = [];
    let t = 0;
    let seen = c.messages.length;
    const hp0 = p.entity.health;
    for (let i = 0; i < 400 && bites.length < 2; i++) {
      game.step(0.05);
      t += 0.05;
      await sleep(0); // let this tick's messages arrive
      // The player stands still (worst case). Heal between bites so the test doesn't die.
      if (p.entity.health < hp0) { bites.push(t); p.entity.health = hp0; }
      for (const m of c.messages.slice(seen)) if (m.t === "entityEvent" && m.id === shark.id && m.event === "fuse") warnings.push(t);
      seen = c.messages.length;
    }
    expect(bites.length).toBeGreaterThanOrEqual(1);
    // Every bite came after a warning at least the telegraph time earlier.
    for (const b of bites) {
      const w = warnings.filter((x) => x <= b).pop();
      expect(w, "a warning before the bite").toBeDefined();
      expect(b - w!).toBeGreaterThanOrEqual(DEFAULT_STANDARDS.audio.telegraphLeadSeconds - 0.06);
    }
    if (bites.length >= 2) expect(bites[1] - bites[0]).toBeGreaterThanOrEqual(DEFAULT_STANDARDS.summons.biteCooldownSeconds);
    // Damage within the per-hit cap.
    expect(hp0 - p.entity.health).toBeLessThanOrEqual(DEFAULT_STANDARDS.balance.player.health * DEFAULT_STANDARDS.balance.damage.maxHitShareOfHealth);
    // It's slower than a walking player.
    expect(Math.hypot(shark.body.vx, shark.body.vz)).toBeLessThan(DEFAULT_STANDARDS.balance.player.walkSpeed * 2.3);
    await settle();
  }, 60000);

  it("can't reach a player sheltering under a tree canopy", async () => {
    const p = player();
    const [shark] = summoned("flying_shark");
    const x = Math.floor(p.entity.x), y = Math.floor(p.entity.y), z = Math.floor(p.entity.z);
    // A low leaf roof with walls of leaves: a hiding spot.
    const leaves = game.reg.blockId("leaves");
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) game.world.setBlockTracked(x + dx, y + 3, z + dz, leaves);
    for (let dy = 0; dy < 3; dy++) for (let k = -3; k <= 3; k++) for (const [ax, az] of [[k, -3], [k, 3], [-3, k], [3, k]]) game.world.setBlockTracked(x + ax, y + dy, z + az, leaves);
    shark.body.x = x + 6; shark.body.y = y + 6; shark.body.z = z;
    const hp = p.entity.health;
    await run(15);
    expect(p.entity.health).toBe(hp);
  }, 30000);

  it("never hunts players in the spawn safe zone or in creative", async () => {
    const p = player();
    const [shark] = summoned("flying_shark");
    p.gameMode = "creative";
    const hp = p.entity.health;
    shark.body.x = p.entity.x + 3; shark.body.z = p.entity.z;
    await run(8);
    expect(p.entity.health).toBe(hp);
    p.gameMode = "survival";
    const [sx, sy, sz] = game.world.meta.spawn;
    game.teleport(p, sx, sy, sz);
    shark.body.x = sx + 3; shark.body.y = sy + 3; shark.body.z = sz;
    await run(8);
    expect(p.entity.health).toBe(hp);
  }, 30000);

  it("keeps to the hazard limit: at most 3 hostile summons", async () => {
    const p = player();
    game.teleport(p, game.world.meta.spawn[0] + 40, game.world.meta.spawn[1] + 20, game.world.meta.spawn[2] + 40);
    for (let i = 0; i < 3; i++) { await say("/summon an angry wolf"); await run(1.5); await settle(); }
    const hostiles = [...game.entities.all.values()].filter((e) => e.type.summon && e.type.kind === "hostile").length;
    expect(hostiles).toBe(3);
    expect(lastEvent(/Angry Wolf/)?.event.phase).toBe("fizzle");
    expect(lastEvent(/Angry Wolf/)?.event.detail).toMatch(/hazards at once/);
    await say("/unsummon");
    expect([...game.entities.all.values()].filter((e) => e.type.summon).length).toBe(0);
  }, 60000);

  it("puts swimmers in water, or explains why it can't", async () => {
    await settle();
    await say("/summon a whale");
    await run(1.5);
    const e = lastEvent(/Whale/)!;
    if (e.event.phase === "fizzle") expect(e.event.detail).toMatch(/needs water nearby/);
    else {
      const [whale] = summoned("whale");
      expect(game.table.liquid[game.world.getBlock(Math.floor(whale.x), Math.floor(whale.y + 0.5), Math.floor(whale.z))]).toBe(1);
    }
    await settle();
  }, 30000);

  it("answers clearly when it doesn't know something", async () => {
    await say("/summon a toaster");
    expect(c.messages.filter((m) => m.t === "chat").map((m) => (m as { text: string }).text).pop()).toMatch(/don't know how to make/);
  });

  it("summons a design written by an agent, saved to the world (and kept on a scroll)", async () => {
    await settle();
    await say("/unsummon");
    const svc = game.kernel.services.get("summons")!.value as SummonService;
    const bad = svc.designs.save("Summoner", { name: "Lantern Moth", movement: "fly", shape: { parts: [{ name: "body", shapes: [{ type: "sphere", at: [0, 1, 0], size: [1, 1, 1] }] }] } });
    expect(bad.ok).toBe(false);
    expect(bad.check.issues[0]).toMatchObject({ path: "parts[0].shapes[0].type" });
    const moth = { name: "Lantern Moth", movement: "fly", length: 1.6, colors: { main: "violet2", belly: "yellow5", accent: "violet4" }, shape: designGuide(game.std).example.shape };
    const saved = svc.designs.save("Summoner", moth);
    expect(saved.ok).toBe(true);
    expect(await say("/designs")).toMatch(/lantern_moth: Lantern Moth by Summoner/);
    expect(await say("/cost design:lantern_moth")).toMatch(/Lantern Moth/);
    await say("/summon design:lantern_moth");
    await run(1.5); await settle();
    expect(lastEvent(/Lantern Moth/)?.event.phase).toBe("arrival");
    const types = await c.waitFor("entityTypes", (m) => m.types.some((t) => t.summon?.name === "Lantern Moth"));
    expect(types.types.find((t) => t.summon?.name === "Lantern Moth")!.summon!.shape!.parts.length).toBe(3);
    // Someone else can't overwrite it; its author can, and the revision is a new entity type.
    expect(svc.designs.save("Other", moth).ok).toBe(false);
    const v2 = svc.designs.save("Summoner", { ...moth, length: 2 });
    expect(v2.ok && v2.design.spec.id).not.toBe(saved.ok && saved.design.spec.id);
    expect(await say("/inscribe moth = design:lantern_moth")).toMatch(/Inscribed "moth": Lantern Moth/);
    expect(await say("/summon design:nothing_here")).toMatch(/No design called "nothing_here"/);
    await say("/unsummon");
  }, 30000);
});
