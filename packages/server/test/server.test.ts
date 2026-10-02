import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import {
  DEFAULT_STANDARDS, PROTOCOL_VERSION, VANILLA_CONTENT, buildRegistry, decodeChunkFrame, type ServerMessage,
} from "@lfg/shared";
import { Game } from "../src/game";
import { Kernel } from "../src/kernel";
import { VANILLA_MODULES } from "../src/modules";

const reg = buildRegistry([VANILLA_CONTENT.id], DEFAULT_STANDARDS);

class TestClient {
  ws: WebSocket;
  messages: ServerMessage[] = [];
  chunks = 0;
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on("message", (data, isBinary) => {
      if (isBinary) {
        const buf = data as Buffer;
        decodeChunkFrame(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
        this.chunks++;
        return;
      }
      const m = JSON.parse(data.toString()) as ServerMessage;
      this.messages.push(m);
      this.waiters = this.waiters.filter((w) => (w.pred(m) ? (w.resolve(m), false) : true));
    });
  }

  open(): Promise<void> {
    return new Promise((r) => this.ws.once("open", () => r()));
  }

  send(m: unknown): void {
    this.ws.send(JSON.stringify(m));
  }

  waitFor<T extends ServerMessage["t"]>(t: T, pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true, ms = 8000): Promise<Extract<ServerMessage, { t: T }>> {
    const found = this.messages.find((m) => m.t === t && pred(m as Extract<ServerMessage, { t: T }>));
    if (found) return Promise.resolve(found as Extract<ServerMessage, { t: T }>);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${t}`)), ms);
      this.waiters.push({
        pred: (m) => m.t === t && pred(m as Extract<ServerMessage, { t: T }>),
        resolve: (m) => { clearTimeout(timer); resolve(m as Extract<ServerMessage, { t: T }>); },
      });
    });
  }
}

describe("game server", () => {
  let dir: string;
  let game: Game;
  let http: Server;
  let url: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "lfg2-"));
    game = new Game({ modules: VANILLA_MODULES, dataDir: dir, worldName: "t", seed: 99, viewDistance: 2, log: () => {} });
    await game.init();
    game.start();
    http = createServer();
    const wss = new WebSocketServer({ server: http, path: "/ws" });
    wss.on("connection", (s) => game.handleConnection(s));
    await new Promise<void>((r) => http.listen(0, r));
    const addr = http.address();
    url = `ws://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/ws`;
  }, 30000);

  afterAll(async () => {
    await game.stop();
    http.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects bad names and mismatched content", async () => {
    const c = new TestClient(url);
    await c.open();
    c.send({ t: "hello", name: "x", protocol: PROTOCOL_VERSION, fingerprint: reg.fingerprint() });
    expect((await c.waitFor("reject")).reason).toMatch(/Name/);
    const d = new TestClient(url);
    await d.open();
    d.send({ t: "hello", name: "Bob", protocol: PROTOCOL_VERSION, fingerprint: 1 });
    expect((await d.waitFor("reject")).reason).toMatch(/mismatch/);
  });

  it("lets a player join, streams chunks, and runs commands", async () => {
    const c = new TestClient(url);
    await c.open();
    c.send({ t: "hello", name: "Alice", protocol: PROTOCOL_VERSION, fingerprint: reg.fingerprint() });
    const welcome = await c.waitFor("welcome");
    expect(welcome.position[1]).toBeGreaterThan(40);
    await c.waitFor("self");
    await new Promise((r) => setTimeout(r, 1500));
    expect(c.chunks).toBeGreaterThan(10);

    c.send({ t: "chat", text: "/give cobblestone 5" });
    const self = await c.waitFor("self", (m) => m.hotbar.some((s) => s?.item === reg.item("cobblestone").id));
    expect(self.hotbar.find((s) => s)?.count).toBe(5);

    // Place a block on the ground in front of us, then break it in creative mode.
    const [x, y, z] = welcome.position.map(Math.floor);
    c.send({ t: "place", x: x + 1, y: y - 1, z, nx: 0, ny: 1, nz: 0, yaw: 0 });
    await c.waitFor("blocks", (m) => m.changes.some(([bx, by, bz, id]) => bx === x + 1 && by === y && bz === z && id === reg.blockId("cobblestone")));
    c.send({ t: "chat", text: "/gamemode creative" });
    await c.waitFor("self", (m) => m.gameMode === "creative");
    c.send({ t: "dig", action: "finish", x: x + 1, y, z });
    await c.waitFor("blocks", (m) => m.changes.some(([bx, by, bz, id]) => bx === x + 1 && by === y && bz === z && id === 0));
    c.ws.close();
  }, 20000);

  it("rejects digging stone faster than the rules allow in survival", async () => {
    const c = new TestClient(url);
    await c.open();
    c.send({ t: "hello", name: "Carol", protocol: PROTOCOL_VERSION, fingerprint: reg.fingerprint() });
    const welcome = await c.waitFor("welcome");
    const [x, , z] = welcome.position.map(Math.floor);
    // Put a stone block right next to the player, then try to break it instantly by hand.
    const y = Math.floor(welcome.position[1]);
    await new Promise((r) => setTimeout(r, 1500)); // let chunks arrive
    const stone = reg.blockId("stone");
    const isStoneHere = (m: { changes: [number, number, number, number][] }) =>
      m.changes.some(([bx, by, bz, id]) => bx === x + 1 && by === y && bz === z && id === stone);
    game.world.setBlockTracked(x + 1, y, z, stone);
    await c.waitFor("blocks", isStoneHere);
    c.send({ t: "dig", action: "start", x: x + 1, y, z });
    c.send({ t: "dig", action: "finish", x: x + 1, y, z });
    // The server rejects it and re-sends the real block (still stone).
    await new Promise((r) => setTimeout(r, 500));
    expect(c.messages.filter((m) => m.t === "blocks" && isStoneHere(m)).length).toBe(2);
    expect(game.world.getBlock(x + 1, y, z)).toBe(reg.blockId("stone"));
    c.ws.close();
  }, 20000);

  it("lets players see each other", async () => {
    const a = new TestClient(url);
    const b = new TestClient(url);
    await Promise.all([a.open(), b.open()]);
    a.send({ t: "hello", name: "Dave", protocol: PROTOCOL_VERSION, fingerprint: reg.fingerprint() });
    await a.waitFor("welcome");
    b.send({ t: "hello", name: "Erin", protocol: PROTOCOL_VERSION, fingerprint: reg.fingerprint() });
    await b.waitFor("welcome");
    const spawn = await a.waitFor("spawn", (m) => m.entities.some((e) => e.name === "Erin"));
    expect(spawn.entities.find((e) => e.name === "Erin")?.type).toBe("player");
    a.ws.close();
    b.ws.close();
  }, 20000);
});

describe("kernel", () => {
  it("contains errors and disables a module that keeps failing", () => {
    const disabled: string[] = [];
    const k = new Kernel({ maxErrors: 3, log: () => {}, onModuleDisabled: (id) => disabled.push(id) });
    let goodRuns = 0;
    k.load({ id: "bad", name: "Bad", version: "1", author: "t", description: "", setup: (api) => api.on("tick", () => { throw new Error("boom"); }) }, (id) => ({ on: (e: never, f: never) => k.on(id, e, f) }) as never);
    k.load({ id: "good", name: "Good", version: "1", author: "t", description: "", setup: (api) => api.on("tick", () => { goodRuns++; }) }, (id) => ({ on: (e: never, f: never) => k.on(id, e, f) }) as never);
    for (let i = 0; i < 5; i++) k.emit("tick", { dt: 0.05, tick: i });
    expect(goodRuns).toBe(5);
    expect(disabled).toEqual(["bad"]);
    expect(k.modules.get("bad")?.enabled).toBe(false);
  });

  it("unloads everything a module registered", () => {
    const k = new Kernel({ log: () => {} });
    let runs = 0;
    k.load({ id: "m", name: "M", version: "1", author: "t", description: "", setup: (api) => api.on("tick", () => { runs++; }) }, (id) => ({ on: (e: never, f: never) => k.on(id, e, f) }) as never);
    k.emit("tick", { dt: 0, tick: 0 });
    k.unload("m");
    k.emit("tick", { dt: 0, tick: 1 });
    expect(runs).toBe(1);
  });
});
