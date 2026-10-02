import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

describe("adding code to the running world", () => {
  let dir: string;
  let game: Game;
  let http: Server;
  let c: TestClient;
  let pos: [number, number, number];

  /** Fast-forward the game loop, letting async checks and network messages through. */
  const run = async (seconds: number) => {
    for (let t = 0; t < seconds; t += 0.05) {
      game.step(0.05);
      if (Math.round(t * 20) % 5 === 0) await sleep(2);
    }
    await sleep(50);
  };
  const events = () => c.messages.filter((m) => m.t === "worldEvent").map((m) => (m as { event: WorldEventNotice }).event);
  const lastEvent = (title: RegExp) => [...events()].reverse().find((e) => title.test(e.title));
  const cmd = async (text: string) => { c.send({ t: "chat", text }); await sleep(150); };
  /** One change at a time: wait out the current event (incl. its aftershock watch) before the next. */
  const settle = async () => { while (game.events.pending > 0) await run(0.5); };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "lfg2-mods-"));
    game = new Game({
      modules: VANILLA_MODULES, dataDir: dir, worldName: "t", seed: 5, viewDistance: 1, log: () => {},
      eventTiming: { gatherSeconds: { minor: 0.5, major: 0.5, epic: 0.5 }, watchSeconds: 4, spacingSeconds: { minor: 0, major: 0, epic: 0 } },
    });
    await game.init();
    http = createServer();
    new WebSocketServer({ server: http, path: "/ws" }).on("connection", (s) => game.handleConnection(s));
    await new Promise<void>((r) => http.listen(0, r));
    const addr = http.address();
    c = new TestClient(`ws://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/ws`);
    await c.open();
    c.send({ t: "hello", name: "Builder", protocol: PROTOCOL_VERSION, fingerprint: reg.fingerprint() });
    pos = (await c.waitFor("welcome")).position;
  }, 30000);

  afterAll(async () => {
    c.ws.close();
    await game.stop();
    http.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("brings a new module into the world without a restart", async () => {
    await cmd("/module install chicken-rain");
    await run(1.5);
    expect(lastEvent(/chicken-rain/)?.phase).toBe("arrival");
    expect(game.kernel.modules.get("example:chicken-rain")?.enabled).toBe(true);
    const before = game.entities.count((e) => e.type.name === "chicken");
    await run(21); // its 20 s timer
    expect(game.entities.count((e) => e.type.name === "chicken")).toBeGreaterThan(before);
    expect(c.ws.readyState).toBe(c.ws.OPEN); // still connected the whole time
  }, 30000);

  it("fizzles a file that doesn't load, and nothing changes", async () => {
    await settle();
    await cmd("/module install typo");
    await run(1.5);
    const e = lastEvent(/typo/)!;
    expect(e.phase).toBe("fizzle");
    expect(e.detail).toMatch(/couldn't load typo\.ts/);
    expect(game.kernel.modules.has("example:typo")).toBe(false);
  }, 20000);

  it("undoes a module automatically when it starts failing after arrival", async () => {
    await settle();
    await cmd("/module install broken-on-purpose");
    await run(1); // gathering: passes the 2 s shadow run
    expect(lastEvent(/broken-on-purpose/)?.phase).toBe("arrival");
    await run(5); // fails after 3 s live; the kernel switches it off; the aftershock undoes it
    const undo = lastEvent(/broken-on-purpose/)!;
    expect(undo.phase).toBe("undo");
    expect(undo.detail).toMatch(/kept failing/);
    expect(game.kernel.modules.has("example:broken-on-purpose")).toBe(false);
    expect(game.kernel.modules.get("vanilla:survival")?.enabled).toBe(true);
  }, 20000);

  it("applies an edited module file as a change, and removes it as a world event", async () => {
    await settle();
    await cmd("/module install feather-fall");
    await run(1.5);
    await settle();
    expect(game.kernel.modules.get("example:feather-fall")?.def.version).toBe("1.0.0");
    const file = join(game.worldModules.dir, "feather-fall.ts");
    writeFileSync(file, readFileSync(file, "utf8").replace('version: "1.0.0"', 'version: "1.1.0"'));
    game.worldModules.onFile("feather-fall.ts", "an agent");
    await run(1.5);
    expect(lastEvent(/Feather fall changes/)?.phase).toBe("arrival");
    expect(game.kernel.modules.get("example:feather-fall")?.def.version).toBe("1.1.0");
    await settle();
    await cmd("/module remove example:feather-fall");
    await run(1.5);
    expect(lastEvent(/Feather fall fades away/)?.phase).toBe("arrival");
    expect(game.kernel.modules.has("example:feather-fall")).toBe(false);
  }, 20000);

  it("shadow-runs new code against the real world without letting it change anything", async () => {
    await settle();
    const [x, y, z] = pos.map(Math.floor);
    const gold = reg.blockId("gold_ore");
    writeFileSync(join(game.worldModules.dir, "gold-floor.ts"), `
      export default {
        id: "test:gold-floor", name: "Gold floor", version: "1", author: "test", description: "Turns the floor to gold",
        setup(api) {
          api.on("tick", () => { api.world.setBlock(${x}, ${y - 1}, ${z}, ${gold}); });
        },
      };`);
    game.worldModules.onFile("gold-floor.ts", "an agent");
    await sleep(100); // the shadow run happens while gathering
    expect(game.world.getBlock(x, y - 1, z)).not.toBe(gold);
    await run(1.5);
    expect(lastEvent(/gold-floor/)?.phase).toBe("arrival");
    expect(game.world.getBlock(x, y - 1, z)).toBe(gold);
  }, 20000);

  it("rejects modules that are too slow in the shadow run", async () => {
    await settle();
    writeFileSync(join(game.worldModules.dir, "slow.ts"), `
      export default {
        id: "test:slow", name: "Slow", version: "1", author: "test", description: "Burns CPU",
        setup(api) { api.on("tick", () => { const end = performance.now() + 20; while (performance.now() < end) {} }); },
      };`);
    game.worldModules.onFile("slow.ts", "an agent");
    await run(1.5);
    expect(lastEvent(/slow/)?.phase).toBe("fizzle");
    expect(lastEvent(/slow/)?.detail).toMatch(/too slow/);
  }, 20000);

  it("refuses modules that try to import other code (they only get the api)", async () => {
    await settle();
    writeFileSync(join(game.worldModules.dir, "sneaky.ts"), `
      import { readFileSync } from "node:fs";
      export default {
        id: "test:sneaky", name: "Sneaky", version: "1", author: "test", description: "Reads server files",
        setup(api) { api.broadcast(readFileSync("/etc/passwd", "utf8")); },
      };`);
    game.worldModules.onFile("sneaky.ts", "an agent");
    await run(1.5);
    expect(lastEvent(/sneaky/)?.phase).toBe("fizzle");
    expect(lastEvent(/sneaky/)?.detail).toMatch(/can't import other code/);
  }, 20000);
});
