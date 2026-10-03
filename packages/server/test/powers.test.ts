import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { DEFAULT_STANDARDS, PROTOCOL_VERSION, SPELLS, VANILLA_CONTENT, buildRegistry, type BuffHud } from "@lfg/shared";
import { Game } from "../src/game";
import { VANILLA_MODULES } from "../src/modules";
import { TestClient } from "./helpers";

const reg = buildRegistry([VANILLA_CONTENT.id], DEFAULT_STANDARDS);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("powers: timed buffs and spells", () => {
  let dir: string;
  let game: Game;
  let http: Server;
  let url: string;
  let a: TestClient, b: TestClient;

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
  const buffs = (c: TestClient) => ([...c.messages].reverse().find((m) => m.t === "buffs") as { buffs: BuffHud[] } | undefined)?.buffs ?? [];
  const player = (name: string) => game.players.get(name.toLowerCase())!;
  const cast = async (c: TestClient, spell: string) => { c.send({ t: "cast", spell }); await sleep(100); };
  /** An open, flat test ground away from spawn. */
  const arena = async () => {
    const [sx, , sz] = game.world.meta.spawn;
    const x = Math.floor(sx) + 60, z = Math.floor(sz) + 60;
    await game.world.ensureArea(x, z, 1);
    const y = game.world.surfaceY(x, z) + 1;
    for (let dx = -12; dx <= 12; dx++) for (let dz = -14; dz <= 4; dz++) {
      game.world.setBlockTracked(x + dx, y - 1, z + dz, reg.blockId("stone"));
      for (let dy = 0; dy < 8; dy++) game.world.setBlockTracked(x + dx, y + dy, z + dz, 0);
    }
    return { x: x + 0.5, y, z: z + 0.5 };
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "lfg2-powers-"));
    game = new Game({ modules: VANILLA_MODULES, dataDir: dir, worldName: "t", seed: 42, viewDistance: 2, log: () => {}, randomSeed: 9 });
    await game.init();
    http = createServer();
    new WebSocketServer({ server: http, path: "/ws" }).on("connection", (s) => game.handleConnection(s));
    await new Promise<void>((r) => http.listen(0, r));
    const addr = http.address();
    url = `ws://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/ws`;
    a = await connect("Merlin");
    b = await connect("Arthur");
    await sleep(300);
  }, 30000);

  afterAll(async () => {
    a.ws.close(); b.ws.close();
    await game.stop();
    http.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("a level 1 can't become a wizard, and is told what it needs", async () => {
    expect(await say(a, "/summon the power of a wizard")).toMatch(/power of wizard is tier 4: it needs level 12/);
    expect(buffs(a)).toEqual([]);
  });

  it("a level 12 becomes a wizard: spells on R/F/G, an aura everyone sees", async () => {
    await say(a, "/xp level 12");
    const reply = await say(a, "/summon the power of a wizard");
    expect(reply).toMatch(/Wizard for 10 min \(tier 4: 60 aether \+ 3 shards\)|not enough|shard/);
    // Tier 4 needs shards: give some and try again.
    await say(a, "/aether shards 3");
    await say(a, "/aether fill");
    expect(await say(a, "/summon the power of a wizard")).toMatch(/Wizard for 10 min .* R: fire bolt · F: blink · G: frost nova/);
    const [buff] = buffs(a);
    expect(buff).toMatchObject({ name: "Wizard", effects: ["night_vision"] });
    expect(buff.spells.map((s) => s.key)).toEqual(["R", "F", "G"]);
    expect(player("Merlin").entity.flags & 16).toBe(16);
  });

  it("fire bolt hits the first thing in the line, then needs its cooldown", async () => {
    const at = await arena();
    const p = player("Merlin");
    game.teleport(p, at.x, at.y, at.z);
    const pig = game.makeApi("test").spawnEntity("pig", at.x, at.y, at.z - 8);
    p.entity.yaw = 0; // looking along -Z, aimed down at the pig
    p.entity.pitch = -Math.atan2(1.62 - pig.type.height / 2, 8);
    const hp = pig.health;
    await cast(a, "fire_bolt");
    expect(hp - pig.health).toBe(SPELLS.fire_bolt.damage);
    expect(a.messages.some((m) => m.t === "spellFx" && m.spell === "fire_bolt")).toBe(true);
    const hp2 = pig.health;
    pig.invulnerable = 0;
    await cast(a, "fire_bolt"); // within the 1 s cooldown
    expect(pig.health).toBe(hp2);
    // Arthur, standing in the way, isn't hurt: PvP is off.
    await sleep(1100);
    const q = player("Arthur");
    game.teleport(q, at.x, at.y, at.z - 4);
    const qh = q.entity.health;
    await cast(a, "fire_bolt");
    expect(q.entity.health).toBe(qh);
  });

  it("blink jumps up to 8 blocks ahead, never into a wall", async () => {
    const p = player("Merlin");
    const at = await arena();
    game.teleport(p, at.x, at.y, at.z);
    p.entity.yaw = 0; p.entity.pitch = 0;
    await cast(a, "blink");
    const moved = at.z - p.entity.z;
    expect(moved).toBeGreaterThan(5);
    expect(moved).toBeLessThanOrEqual(SPELLS.blink.range);
  });

  it("frost nova freezes things around you for at most 1.5 s, with immunity after", async () => {
    const p = player("Merlin");
    const at = await arena();
    game.teleport(p, at.x, at.y, at.z);
    const pig = game.makeApi("test").spawnEntity("pig", at.x + 2, at.y, at.z);
    const t0 = Date.now();
    await cast(a, "frost_nova");
    const frozen = Number(pig.data.frozenUntil) - t0;
    expect(frozen).toBeGreaterThan(0);
    expect(frozen).toBeLessThanOrEqual(DEFAULT_STANDARDS.balance.crowdControl.maxSeconds * 1000 + 200);
    expect(Number(pig.data.ccImmuneUntil) - Number(pig.data.frozenUntil)).toBe(DEFAULT_STANDARDS.balance.crowdControl.immunitySeconds * 1000);
  });

  it("wings let you fly in survival, and when they end you don't take fall damage", async () => {
    await say(b, "/xp level 8");
    await say(b, "/aether shards 1");
    expect(await say(b, "/summon wings")).toMatch(/Wings for 3 min/);
    const q = player("Arthur");
    expect(q.canFly).toBe(true);
    await say(b, "/powers end");
    expect(q.canFly).toBe(false);
    expect(q.noFallUntil).toBeGreaterThan(Date.now() + 5000);
  });

  it("a level 4 asking for wings gets the strongest power their tier allows", async () => {
    await say(b, "/xp level 4");
    await say(b, "/aether fill");
    const reply = await say(b, "/summon the power of flight");
    expect(reply).toMatch(/it needs level 8/);
  });

  it("the avatar form (tier 5) works once a day", async () => {
    await say(a, "/xp level 20");
    await say(a, "/aether fill");
    await say(a, "/aether shards 20");
    expect(await say(a, "/summon become an avatar of the storm")).toMatch(/Avatar for 10 min/);
    expect(player("Merlin").entity.flags & 16).toBe(16);
    expect(player("Merlin").canFly).toBe(true);
    await say(a, "/aether fill");
    expect(await say(a, "/summon become an avatar of the storm")).toMatch(/once a day/);
  });
});
