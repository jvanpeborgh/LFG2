import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { DEFAULT_STANDARDS, PROTOCOL_VERSION, VANILLA_CONTENT, buildRegistry } from "@lfg/shared";
import { Game } from "../src/game";
import type { ServerModule } from "../src/kernel";
import { VANILLA_MODULES } from "../src/modules";
import { TestClient } from "./helpers";

const reg = buildRegistry([VANILLA_CONTENT.id], DEFAULT_STANDARDS);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A module that only works while gravity is "normal": it throws every tick otherwise. */
const fragile: ServerModule = {
  id: "test:fragile",
  name: "Fragile contraption",
  version: "1",
  author: "test",
  description: "Breaks in low gravity",
  setup(api) {
    api.on("tick", () => {
      if (api.std.balance.player.gravity < 20) throw new Error("my contraption needs real gravity");
    });
  },
};

describe("changing a rule while people play", () => {
  let dir: string;
  let game: Game;
  let http: Server;
  let url: string;
  let c: TestClient;

  /** Run the game loop by hand (fast-forward), letting network messages flow between steps. */
  const run = async (seconds: number) => {
    for (let t = 0; t < seconds; t += 0.05) {
      game.step(0.05);
      if (Math.round(t * 20) % 10 === 0) await sleep(1);
    }
    await sleep(50);
  };
  const chatReplies = () => c.messages.filter((m) => m.t === "chat").map((m) => (m as { text: string }).text);

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "lfg2-rules-"));
    game = new Game({
      modules: [...VANILLA_MODULES, fragile],
      dataDir: dir, worldName: "t", seed: 77, viewDistance: 1, log: () => {},
      eventTiming: { gatherSeconds: { minor: 1, major: 1, epic: 1 }, watchSeconds: 3, spacingSeconds: { minor: 0, major: 0, epic: 0 } },
    });
    await game.init();
    http = createServer();
    new WebSocketServer({ server: http, path: "/ws" }).on("connection", (s) => game.handleConnection(s));
    await new Promise<void>((r) => http.listen(0, r));
    const addr = http.address();
    url = `ws://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/ws`;
    c = new TestClient(url);
    await c.open();
    c.send({ t: "hello", name: "Ruler", protocol: PROTOCOL_VERSION, fingerprint: reg.fingerprint() });
    await c.waitFor("welcome");
  }, 30000);

  afterAll(async () => {
    c.ws.close();
    await game.stop();
    http.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("changes walk speed for everyone as a world event, and can be undone", async () => {
    c.send({ t: "chat", text: "/rule set balance.player.walkSpeed 6" });
    await sleep(100);
    await c.waitFor("worldEvent", (m) => m.event.phase === "gathering" && m.event.title.includes("Walk speed"));
    expect(game.std.balance.player.walkSpeed).toBe(4.3); // not yet: it's still gathering
    await run(1.2);
    await c.waitFor("worldEvent", (m) => m.event.phase === "arrival" && m.event.title.includes("Walk speed"));
    const rules = await c.waitFor("rules", (m) => m.changes.some(([p, v]) => p === "balance.player.walkSpeed" && v === 6));
    expect(rules).toBeTruthy();
    expect(game.std.balance.player.walkSpeed).toBe(6);
    // Kept with the world.
    game.saveAll();
    expect(JSON.parse(readFileSync(join(dir, "t", "level.json"), "utf8")).rules["balance.player.walkSpeed"]).toBe(6);
    // Undo.
    c.send({ t: "chat", text: "/rule undo" });
    await c.waitFor("rules", (m) => m.changes.some(([p, v]) => p === "balance.player.walkSpeed" && v === 4.3));
    expect(game.std.balance.player.walkSpeed).toBe(4.3);
    // The shared default object is untouched: each world has its own copy.
    expect(DEFAULT_STANDARDS.balance.player.walkSpeed).toBe(4.3);
    await run(4); // let the aftershock window end
  }, 20000);

  it("refuses locked rules and wild values", async () => {
    c.send({ t: "chat", text: "/rule set locked.maxNoControlSeconds 30" });
    c.send({ t: "chat", text: "/rule set balance.player.health 5000" });
    c.send({ t: "chat", text: "/rule set balance.player.gravity banana" });
    await sleep(200);
    const replies = chatReplies();
    expect(replies.some((t) => /locked/.test(t))).toBe(true);
    expect(replies.some((t) => /at most 10×/.test(t))).toBe(true);
    expect(replies.some((t) => /Can't use "banana"/.test(t))).toBe(true);
    expect(game.std.balance.player.health).toBe(100);
  });

  it("undoes a rule change automatically when it breaks a module, and revives the module", async () => {
    c.send({ t: "chat", text: "/rule set balance.player.gravity 9" });
    await sleep(100);
    await run(1.2); // gathering → arrival
    expect(game.std.balance.player.gravity).toBe(9);
    // The fragile module now throws every tick; the kernel switches it off, and the aftershock watch
    // sees a module break right after the change and rolls the change back.
    await run(2);
    const undo = await c.waitFor("worldEvent", (m) => m.event.phase === "undo" && m.event.title.includes("Gravity"));
    expect(undo.event.detail).toMatch(/test:fragile kept failing/);
    expect(game.std.balance.player.gravity).toBe(32);
    expect(game.kernel.modules.get("test:fragile")?.enabled).toBe(true);
    // The rest of the world never stopped.
    expect(game.kernel.modules.get("vanilla:mobs")?.enabled).toBe(true);
  }, 20000);
});
