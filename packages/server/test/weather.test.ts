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

describe("weather", () => {
  let dir: string, game: Game, http: Server, url: string;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "lfg2-weather-"));
    game = new Game({ modules: VANILLA_MODULES, dataDir: dir, worldName: "w", seed: 7, viewDistance: 1, log: () => {} });
    await game.init();
    game.start();
    http = createServer();
    new WebSocketServer({ server: http, path: "/ws" }).on("connection", (s) => game.handleConnection(s));
    await new Promise<void>((r) => http.listen(0, r));
    const addr = http.address();
    url = `ws://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/ws`;
  }, 30000);
  afterAll(async () => { await game.stop(); http.close(); rmSync(dir, { recursive: true, force: true }); });

  it("tells players the weather, and admins can change it", async () => {
    const c = new TestClient(url);
    await c.open();
    c.send({ t: "hello", name: "Wren", protocol: PROTOCOL_VERSION, fingerprint: reg.fingerprint() });
    await c.waitFor("welcome");
    expect((await c.waitFor("weather")).kind).toBe("clear");
    c.send({ t: "chat", text: "/weather thunder 5" });
    expect((await c.waitFor("weather", (m) => m.kind === "thunder")).kind).toBe("thunder");
    c.send({ t: "chat", text: "/weather" });
    await sleep(200);
    expect(c.messages.filter((m) => m.t === "chat").map((m) => (m as { text: string }).text).join("\n")).toMatch(/stormy/);
    // Lightning comes with its warning first.
    const warn = await c.waitFor("lightning", (m) => m.phase === "warn", 20000);
    const hit = await c.waitFor("lightning", (m) => m.phase === "hit", 4000);
    expect([hit.x, hit.z]).toEqual([warn.x, warn.z]);
    expect(warn.seconds).toBeGreaterThanOrEqual(1);
    c.ws.close();
  }, 30000);
});
