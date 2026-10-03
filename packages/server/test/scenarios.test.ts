import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { DEFAULT_STANDARDS, EXAMPLE_RAID, PROTOCOL_VERSION, VANILLA_CONTENT, buildRegistry, type ScenarioHud, type WorldEventNotice } from "@lfg/shared";
import { Game } from "../src/game";
import { VANILLA_MODULES } from "../src/modules";
import { TestClient } from "./helpers";
import type { RaidLibrary } from "../src/modules/vanilla/scenarios";

const reg = buildRegistry([VANILLA_CONTENT.id], DEFAULT_STANDARDS);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("scenarios: an invasion from the sea", () => {
  let dir: string;
  let game: Game;
  let http: Server;
  let c: TestClient;

  const step = async (n: number, each?: () => void) => {
    for (let i = 0; i < n; i++) {
      game.step(0.05);
      each?.();
      if (i % 10 === 0) await sleep(0);
    }
    await sleep(20);
  };
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
  };
  const hud = () => ([...c.messages].reverse().find((m) => m.t === "scenario") as { hud: ScenarioHud | null } | undefined)?.hud;
  const player = () => game.players.get("defender")!;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "lfg2-scenarios-"));
    game = new Game({
      modules: VANILLA_MODULES, dataDir: dir, worldName: "t", seed: 42, viewDistance: 2, log: (m: string) => { if (process.env.SCEN_LOG && /playtest|reward/.test(m)) console.log(m); },
      randomSeed: 3,
      eventTiming: { gatherSeconds: { minor: 0.5, major: 0.5, epic: 0.5 }, watchSeconds: 2, spacingSeconds: { minor: 0, major: 0, epic: 0 } },
    });
    await game.init();
    http = createServer();
    new WebSocketServer({ server: http, path: "/ws" }).on("connection", (s) => game.handleConnection(s));
    await new Promise<void>((r) => http.listen(0, r));
    const addr = http.address();
    c = new TestClient(`ws://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/ws`);
    await c.open();
    c.send({ t: "hello", name: "Defender", protocol: PROTOCOL_VERSION, fingerprint: reg.fingerprint() });
    await c.waitFor("welcome");
    c.send({ t: "chat", text: "/xp level 20" });
    await sleep(300);
  }, 30000);

  afterAll(async () => {
    c.ws.close();
    await game.stop();
    http.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("plans the example: ships, rising waves, a mid boss and a final boss", async () => {
    // Seed 42 has sea just west of spawn; stand on the shore ~55 blocks south of spawn (outside the safe zone).
    const p = player();
    const [sx, , sz] = game.world.meta.spawn;
    await game.world.ensureArea(Math.floor(sx), Math.floor(sz) + 56, 2);
    const y = game.world.surfaceY(Math.floor(sx) + 8, Math.floor(sz) + 56) + 1;
    game.teleport(p, sx + 8.5, y, sz + 56.5);
    await step(10);
    await say("/event a swarm of ships arrive at the nearest coast and enemies come out in waves, with increasing difficulty and some bosses");
    const plan = c.messages.filter((m) => m.t === "chat").map((m) => (m as { text: string }).text).pop()!;
    expect(plan).toMatch(/Pirate Raid: 3 ships, 5 waves/);
    expect(plan).toMatch(/Pirate Captain in wave 3, Pirate King in wave 5/);
    // Gathering runs the coast search, model checks and the wave-by-wave playtest.
    for (let i = 0; i < 40 && game.events.pending > 0 && lastEvent(/Pirate Raid/)?.event.phase !== "arrival"; i++) await step(10);
    const ev = lastEvent(/Pirate Raid/)!;
    expect(ev.event.phase, ev.event.detail).toBe("arrival");
    expect(hud()?.status).toBe("Ships approaching");
  }, 60000);

  it("sails the ships in to anchor near the beach, then runs the waves to a reward", async () => {
    const p = player();
    const api = game.makeApi("test");
    const ships = () => [...game.entities.all.values()].filter((e) => e.type.summon?.body === "ship");
    const foes = () => [...game.entities.all.values()].filter((e) => e.type.summon?.body === "biped");
    expect(ships().length).toBe(3);
    const beach = hud()!.at;
    const d0 = Math.min(...ships().map((s) => Math.hypot(s.x - beach[0], s.z - beach[2])));
    // Ships float on the water.
    for (const s of ships()) expect(game.table.liquid[game.world.getBlock(Math.floor(s.x), Math.floor(s.y + 0.5), Math.floor(s.z))]).toBe(1);

    // The defender stands on the beach and swings at anything close; heals between hits so the test
    // runs to the end, but every hit is recorded. When a boss winds up a slam, they step out of the ring.
    game.teleport(p, beach[0], beach[1], beach[2]);
    const hits: number[] = [];
    let hp = p.entity.health, swing = 0, maxAlive = 0, slamWarned = 0;
    const waves = new Set<number>();
    let pulled = 0;
    let seen = c.messages.length;
    const fight = () => {
      if (p.entity.health < hp) hits.push(hp - p.entity.health);
      p.entity.health = hp = p.entity.type.maxHealth;
      p.dead = false;
      swing -= 0.05;
      const alive = foes();
      maxAlive = Math.max(maxAlive, alive.length);
      for (const m of c.messages.slice(seen)) {
        if (m.t === "slam" && m.phase === "warn") {
          slamWarned++;
          // Step away from the boss, out of the ring.
          const dx = p.entity.x - m.x, dz = p.entity.z - m.z, d = Math.hypot(dx, dz) || 1;
          game.teleport(p, m.x + (dx / d) * (m.radius + 2), p.entity.y, m.z + (dz / d) * (m.radius + 2));
        }
        if (m.t === "scenario" && m.hud) waves.add(m.hud.wave);
      }
      seen = c.messages.length;
      if (swing <= 0) {
        const target = alive.find((e) => Math.hypot(e.x - p.entity.x, e.z - p.entity.z) < 3);
        if (target) { api.damage(target, 16, { kind: "melee", attacker: p.entity }); swing = 0.5; }
        // Otherwise walk up to the nearest one close by (unless it's winding up a slam).
        else {
          const near = alive.map((e) => ({ e, d: Math.hypot(e.x - p.entity.x, e.z - p.entity.z) })).filter((q) => q.d < 10 && !(q.e.flags & 4)).sort((a, b) => a.d - b.d)[0];
          if (near) {
            const nx = p.entity.x + ((near.e.x - p.entity.x) / near.d) * 0.4, nz = p.entity.z + ((near.e.z - p.entity.z) / near.d) * 0.4;
            game.teleport(p, nx, game.world.surfaceY(Math.floor(nx), Math.floor(nz)) + 1, nz);
          }
        }
      }
    };
    // Approach.
    for (let i = 0; i < 90 && hud()?.status === "Ships approaching"; i++) await step(20, fight);
    const anchored = Math.min(...ships().map((s) => Math.hypot(s.x - beach[0], s.z - beach[2])));
    expect(anchored).toBeLessThan(d0 - 20); // they sailed in…
    expect(anchored).toBeLessThan(32); // …to the shallows off the beach
    // The waves (the defender only fights what comes to them).
    for (let i = 0; i < 400 && !/Victory/.test(hud()?.status ?? ""); i++) {
      await step(20, fight);
      // Pull stragglers in so the test doesn't depend on pathfinding around every rock.
      for (const e of foes()) if (Math.hypot(e.x - p.entity.x, e.z - p.entity.z) > 6 && e.age > 25) { pulled++; e.body.x = p.entity.x + 2; e.body.z = p.entity.z; e.body.y = p.entity.y + 1; }
    }
    if (process.env.SCEN_LOG) console.log(`pulled ${pulled} stragglers; hits ${hits.join(",")}; maxAlive ${maxAlive}; slams warned ${slamWarned}`);
    expect(hud()?.status).toMatch(/Victory/);
    expect([...waves].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(maxAlive).toBeLessThanOrEqual(8);
    expect(slamWarned).toBeGreaterThan(0);
    const cap = DEFAULT_STANDARDS.balance.player.health * DEFAULT_STANDARDS.balance.damage.maxHitShareOfHealth;
    for (const h of hits) expect(h).toBeLessThanOrEqual(cap);
    // The reward chest is on the beach, with loot in it.
    let found = false;
    for (const [, be] of game.world.blockEntities) if (be.kind === "chest" && be.slots.items.some((s) => s && s.item === game.reg.item("diamond").id)) found = true;
    expect(found).toBe(true);
    // Then the ships sail off and everything is cleaned up.
    await step(900, fight);
    expect(ships().length).toBe(0);
    expect(foes().length).toBe(0);
    expect(hud()).toBeNull();
  }, 180000);

  it("only one scenario at a time, and it can be called off", async () => {
    await say("/event viking raid in 3 waves");
    await step(30);
    await say("/event pirates attack in waves");
    expect(c.messages.filter((m) => m.t === "chat").map((m) => (m as { text: string }).text).pop()).toMatch(/already running|Planning/);
    await say("/event stop");
    await step(900);
    expect([...game.entities.all.values()].filter((e) => e.type.summon).length).toBe(0);
  }, 60000);

  it("runs a raid written as JSON (by an agent): checked, playtested, saved, started with /event raid:<id>", async () => {
    for (let i = 0; i < 60 && game.events.pending > 0; i++) await step(10);
    const lib = game.kernel.services.get("raids")!.value as RaidLibrary;
    const bad = await lib.check({ title: "Bad Tide", waves: [{ enemies: [{ who: "a toaster", count: 2 }] }] });
    expect(bad.ok).toBe(false);
    expect(bad.issues[0]).toMatchObject({ path: "waves[0].enemies[0].who" });
    const p = player();
    const near: [number, number] = [p.entity.x, p.entity.z];
    const checked = await lib.check(EXAMPLE_RAID, near);
    expect(checked.ok, JSON.stringify(checked.issues)).toBe(true);
    expect(checked.summary).toMatch(/Skeleton King/);
    expect(typeof checked.playtest === "object" && checked.playtest.ok).toBe(true);
    const saved = await lib.save("Defender", EXAMPLE_RAID, near);
    expect(saved.ok).toBe(true);
    expect(lib.list()[0]).toMatchObject({ id: "the_bone_tide", startWith: "/event raid:the_bone_tide" });
    await say("/event raid:the_bone_tide");
    await step(40);
    expect(lastEvent(/The Bone Tide/)?.event.phase).toBe("arrival");
    expect(hud()?.title).toBe("The Bone Tide");
    await say("/event stop");
    await step(900);
  }, 120000);
});
