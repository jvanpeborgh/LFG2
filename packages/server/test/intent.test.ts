import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { DEFAULT_STANDARDS, PROTOCOL_VERSION, VANILLA_CONTENT, buildRegistry, type Intent } from "@lfg/shared";
import { Game } from "../src/game";
import { intentModule } from "../src/intent";
import type { Interpreter, ReadContext } from "../src/interpreter";
import type { RaceService } from "../src/modules/vanilla/races";
import type { SummonService } from "../src/modules/vanilla/summons";
import { VANILLA_MODULES } from "../src/modules";
import { TestClient } from "./helpers";

const reg = buildRegistry([VANILLA_CONTENT.id], DEFAULT_STANDARDS);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const none = { creature: null, count: 1, vehicle: null, race: null, hunt: null, happening: null, arc: null, request: null };
const intent = (i: Partial<Intent> & Pick<Intent, "kind">): Intent => ({ title: "", reply: "", ...none, ...i });

/** What Claude read the dragon as (a live reading, kept as a fixture). */
const DRAGON = intent({
  kind: "creature", title: "Sleepy Dragon", reply: "A drowsy dragon mount is yawning its way to you.",
  creature: { name: "Sleepy Dragon", skill: "four-legged-creature", template: "dragon", mood: "cute", style: null, movement: "fly", temperament: "passive", length: 6, colors: { main: "violet3", belly: "violet5", accent: "yellow4" }, features: ["dragon head", "membrane wings", "horns", "long tail", "saddle", "spines", "not a real feature"], finish: null, gait: "walk", surface: "scales", abilities: [], element: null, ride: true },
});

/** A stand-in for Claude: fixed readings by request, and a record of what was asked. */
class FakeInterpreter implements Interpreter {
  asked: { text: string; via?: string }[] = [];
  constructor(private readings: Record<string, Intent | null>) {}
  async read(text: string, ctx: ReadContext = {}) {
    this.asked.push({ text, via: ctx.via });
    await sleep(5);
    return this.readings[text] ?? null;
  }
}

describe("requests read by the model, made by the game", () => {
  let dir: string, game: Game, http: Server, c: TestClient;
  const fake = new FakeInterpreter({
    "a sleepy dragon I can ride": DRAGON,
    "make everyone bouncy and slow": intent({ kind: "happening", title: "Bouncy Slowpokes", happening: { title: "Bouncy Slowpokes", description: "Bounce high, move slowly", minutes: 99, rules: [{ path: "balance.player.jumpBlocks", factor: 3 }, { path: "balance.player.walkSpeed", factor: 0.01 }, { path: "balance.damage.maxHitShareOfHealth", factor: 5 }], effect: null } }),
    "a race for the whole server": intent({ kind: "race", title: "Server Cup", race: { title: "Server Cup", laps: 2, vehicle: "buggy" } }),
    "sing me a song": intent({ kind: "unclear", reply: "I can't sing, but I can summon a songbird: try /summon a songbird." }),
  });
  const run = async (s: number) => { for (let t = 0; t < s; t += 0.05) { game.step(0.05); if (Math.round(t * 20) % 10 === 0) await sleep(1); } await sleep(20); };
  const say = async (text: string, wait = 1.5) => {
    const n = c.messages.length;
    c.send({ t: "chat", text });
    await run(wait);
    return c.messages.slice(n).filter((m) => m.t === "chat").map((m) => (m as { text: string }).text).join("\n");
  };
  const summons = () => game.kernel.services.get("summons")!.value as SummonService;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "lfg2-intent-"));
    game = new Game({ modules: [...VANILLA_MODULES, intentModule(fake)], dataDir: dir, worldName: "t", seed: 12, viewDistance: 3, log: () => {}, randomSeed: 3, admins: ["reader"] });
    await game.init();
    http = createServer();
    new WebSocketServer({ server: http, path: "/ws" }).on("connection", (s) => game.handleConnection(s));
    await new Promise<void>((r) => http.listen(0, r));
    const addr = http.address();
    c = new TestClient(`ws://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/ws`);
    await c.open();
    c.send({ t: "hello", name: "Reader", protocol: PROTOCOL_VERSION, fingerprint: reg.fingerprint() });
    await c.waitFor("welcome");
    await run(1);
  }, 30000);
  afterAll(async () => { c.ws.close(); await game.stop(); http.close(); rmSync(dir, { recursive: true, force: true }); });

  it("a creature: the reading becomes the summon (tame, saddled, to ride); unknown features are dropped", async () => {
    const out = await say("/summon a sleepy dragon I can ride", 8);
    expect(fake.asked.at(-1)).toEqual({ text: "a sleepy dragon I can ride", via: "/summon" });
    expect(out).toMatch(/drowsy dragon/);
    // Tier 2 for a new player: scaled down to what they can cast, as any summon is.
    expect(out).toMatch(/Summoning Young Sleepy Dragon/);
    const mine = [...game.entities.all.values()].map((e) => summons().info(e.id)).filter((i) => i?.spec.name.endsWith("Sleepy Dragon"));
    expect(mine.length).toBe(1);
    const spec = mine[0]!.spec;
    expect(spec.temperament).not.toBe("hostile");
    expect(spec.movement).toBe("fly");
    expect(spec.features).toContain("saddle");
    expect(spec.features).not.toContain("not a real feature");
  }, 30000);

  it("a happening the model made up: only allowed rules, within bounds", async () => {
    const jump0 = game.std.balance.player.jumpBlocks, walk0 = game.std.balance.player.walkSpeed, hit0 = game.std.balance.damage.maxHitShareOfHealth;
    const out = await say("/event make everyone bouncy and slow");
    expect(out).toMatch(/Bouncy Slowpokes for 15 min/);
    expect(game.std.balance.player.jumpBlocks).toBeCloseTo(jump0 * 3);
    expect(game.std.balance.player.walkSpeed).toBeCloseTo(walk0 * 0.4); // ×0.01 held to the floor
    expect(game.std.balance.damage.maxHitShareOfHealth).toBe(hit0); // not a rule happenings may change
    await say("/happen stop");
    expect(game.std.balance.player.jumpBlocks).toBe(jump0);
  }, 30000);

  it("a race, read from any words", async () => {
    await say("/event a race for the whole server", 5);
    const races = game.kernel.services.get("races")!.value as RaceService;
    expect(races.running()).toBe(true);
    await say("/race stop");
  }, 30000);

  it("says so when it can't tell, and falls back to the words when there's no reading", async () => {
    expect(await say("/summon sing me a song")).toMatch(/try \/summon a songbird/);
    // No reading (offline, timed out): the keyword planner makes a pig.
    expect(await say("/summon a pig", 3)).toMatch(/Summoning Pig/);
    // A saved design is never sent to be read.
    const n = fake.asked.length;
    await say("/summon design:nothing_here");
    expect(fake.asked.length).toBe(n);
  }, 30000);
});
