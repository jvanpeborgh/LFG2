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
type ArcMsg = Extract<ServerMessage, { t: "arc" }>;

describe("arcs", () => {
  let dir: string, game: Game, http: Server, c: TestClient;
  const run = async (seconds: number) => {
    for (let t = 0; t < seconds; t += 0.05) { game.step(0.05); if (Math.round(t * 20) % 10 === 0) await sleep(1); }
    await sleep(20);
  };
  const lastArc = () => [...c.messages].reverse().find((m) => m.t === "arc") as ArcMsg | undefined;
  const say = async (text: string) => {
    const n = c.messages.length;
    c.send({ t: "chat", text });
    for (let i = 0; i < 100 && !c.messages.slice(n).some((m) => m.t === "chat"); i++) { await sleep(10); await run(0.05); }
    return c.messages.slice(n).filter((m) => m.t === "chat").map((m) => (m as { text: string }).text).join("\n");
  };
  const dayLength = () => game.std.art.lighting.dayLengthMinutes * 60;
  const setFrac = async (f: number) => { await say(`/time set ${Math.round(f * dayLength())}`); await run(1.2); };
  const boot = async () => {
    game = new Game({ modules: VANILLA_MODULES, dataDir: dir, worldName: "t", seed: 12, viewDistance: 3, log: () => {}, randomSeed: 3 });
    await game.init();
    http = createServer();
    new WebSocketServer({ server: http, path: "/ws" }).on("connection", (s) => game.handleConnection(s));
    await new Promise<void>((r) => http.listen(0, r));
    const addr = http.address();
    c = new TestClient(`ws://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/ws`);
    await c.open();
    c.send({ t: "hello", name: "Watcher", protocol: PROTOCOL_VERSION, fingerprint: reg.fingerprint() });
    await c.waitFor("welcome");
    await run(1);
  };
  const shutdown = async () => { c.ws.close(); await game.stop(); http.close(); };

  beforeAll(async () => { dir = mkdtempSync(join(tmpdir(), "lfg2-arcs-")); await boot(); }, 30000);
  afterAll(async () => { await shutdown(); rmSync(dir, { recursive: true, force: true }); });

  it("a blood moon: more monsters each night, back at dawn with a shard, a boss on the last night, and it lasts across a restart", async () => {
    const mobs = () => (game.std.balance as unknown as { mobs: { nightSpawnChance: number; hostileCap: number } }).mobs;
    const cap0 = mobs().hostileCap, chance0 = mobs().nightSpawnChance;
    await setFrac(0.25);
    expect(await say("/arc a blood moon for 2 nights")).toMatch(/Blood Moon for 2 days/);
    expect(lastArc()).toMatchObject({ title: "Blood Moon", day: 1, days: 2, sky: null });
    // Night falls: more monsters, a red sky.
    await setFrac(0.7);
    expect(mobs().hostileCap).toBe(cap0 * 2);
    expect(mobs().nightSpawnChance).toBeCloseTo(chance0 * 2.5);
    expect(lastArc()!.sky).toBe("blood");
    // Dawn: back to normal, a shard for holding on, day 2.
    const p = () => game.players.get("watcher")!;
    const shards0 = (p().data.progress as { shards: number }).shards;
    await setFrac(0.02);
    expect(mobs().hostileCap).toBe(cap0);
    expect((p().data.progress as { shards: number }).shards).toBe(shards0 + 1);
    expect(lastArc()).toMatchObject({ day: 2, sky: null });
    // A restart: it carries on.
    await shutdown();
    await boot();
    expect(lastArc()).toMatchObject({ title: "Blood Moon", day: 2 });
    // The last night brings the boss.
    await setFrac(0.7);
    expect(JSON.stringify(c.messages.slice(-30))).toMatch(/last blood moon rises/);
    const sv = game.kernel.services.get("summons")!.value as SummonService;
    const bosses = () => [...game.entities.all.values()].filter((e) => !e.removed && sv.info(e.id)?.owner === "arc:blood_moon");
    expect(bosses().length).toBe(1);
    expect(sv.info(bosses()[0].id)!.spec.role).toBe("boss");
    // The last dawn ends it.
    await setFrac(0.02);
    expect(lastArc()!.title).toBe("");
    expect(bosses().length).toBe(0);
    expect(mobs().hostileCap).toBe(cap0);
  }, 60000);

  it("a meteor shower drops meteors at night that leave crystal to mine", async () => {
    await setFrac(0.25);
    expect(await say("/arc a meteor shower")).toMatch(/Meteor Shower/);
    await setFrac(0.7);
    for (let i = 0; i < 120 && !c.messages.some((m) => m.t === "meteor"); i++) await run(0.5);
    const m = c.messages.find((x) => x.t === "meteor") as Extract<ServerMessage, { t: "meteor" }>;
    expect(m).toBeDefined();
    await run(3);
    const [x, y, z] = m.to.map(Math.floor);
    let crystal = 0;
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) for (let dy = -4; dy <= 2; dy++) if (reg.blockById(game.world.getBlock(x + dx, y + dy, z + dz)).name === "crystal") crystal++;
    expect(crystal).toBeGreaterThan(0);
    expect(await say("/arc stop")).toMatch(/Stopped/);
  }, 90000);

  it("a festival hangs lanterns around spawn, and takes them down after", async () => {
    await setFrac(0.25);
    const [sx, , sz] = game.world.meta.spawn;
    const lamps = () => {
      let n = 0;
      for (let dx = -11; dx <= 11; dx++) for (let dz = -11; dz <= 11; dz++) for (let y = 30; y < 120; y++) if (/^neon_|^lantern$/.test(reg.blockById(game.world.getBlock(Math.floor(sx) + dx, y, Math.floor(sz) + dz)).name)) n++;
      return n;
    };
    const before = lamps();
    expect(await say("/arc a harvest festival")).toMatch(/Harvest Festival/);
    expect(lamps()).toBeGreaterThan(before + 4);
    expect(await say("/arc stop")).toMatch(/Stopped/);
    expect(lamps()).toBe(before);
  }, 60000);
});
