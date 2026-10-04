import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { DEFAULT_STANDARDS, PROTOCOL_VERSION, nearestOnTrack, VANILLA_CONTENT, buildRegistry, type ServerMessage } from "@lfg/shared";
import { Game } from "../src/game";
import type { RaceService } from "../src/modules/vanilla/races";
import { VANILLA_MODULES } from "../src/modules";
import { TestClient } from "./helpers";

const reg = buildRegistry([VANILLA_CONTENT.id], DEFAULT_STANDARDS);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type RaceMsg = Extract<ServerMessage, { t: "race" }>;

describe("races", () => {
  let dir: string, game: Game, http: Server, c: TestClient;
  const run = async (seconds: number) => {
    for (let t = 0; t < seconds; t += 0.05) { game.step(0.05); if (Math.round(t * 20) % 10 === 0) await sleep(1); }
    await sleep(20);
  };
  const lastRace = () => [...c.messages].reverse().find((m) => m.t === "race") as RaceMsg | undefined;
  const player = () => game.players.get("racer")!;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "lfg2-races-"));
    game = new Game({ modules: VANILLA_MODULES, dataDir: dir, worldName: "t", seed: 12, viewDistance: 3, log: () => {}, randomSeed: 3 });
    await game.init();
    http = createServer();
    new WebSocketServer({ server: http, path: "/ws" }).on("connection", (s) => game.handleConnection(s));
    await new Promise<void>((r) => http.listen(0, r));
    const addr = http.address();
    c = new TestClient(`ws://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/ws`);
    await c.open();
    c.send({ t: "hello", name: "Racer", protocol: PROTOCOL_VERSION, fingerprint: reg.fingerprint() });
    await c.waitFor("welcome");
    await run(1);
  }, 30000);

  afterAll(async () => {
    c.ws.close();
    await game.stop();
    http.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("lays a course, hands out a kart, counts the lap through every checkpoint, rewards, and clears up", async () => {
    c.send({ t: "chat", text: "/race a kart race, 1 lap" });
    for (let i = 0; i < 100 && !lastRace(); i++) { await sleep(20); await run(0.2); }
    await run(4);
    const r0 = lastRace()!;
    expect(r0.title).toMatch(/Kart/);
    expect(r0.laps).toBe(1);
    // In a kart on the grid.
    expect(player().riding).not.toBeNull();
    expect(player().riding!.profile.mode).toBe("drive");
    // The start line is laid (wool and cobblestone in a check pattern).
    const start = r0.next!;
    const line = game.world.getBlock(Math.floor(start[0]), start[1] - 1, Math.floor(start[2]));
    expect(["wool", "cobblestone", "stone", "bricks"]).toContain(reg.blockById(line).name);
    // Wait out the countdown, then drive: a block at a time towards the next checkpoint.
    for (let i = 0; i < 80 && lastRace()!.phase !== "racing"; i++) await run(0.1);
    expect(lastRace()!.phase).toBe("racing");
    // Drive the centre line, a block at a time, round and over the line.
    const track = (game.kernel.services.get("races")!.value as RaceService).track()!;
    let checkpoints = 0, last = "";
    const n = track.points.length;
    const startAt = nearestOnTrack(track, player().entity.x, player().entity.z).index;
    for (let i = 1; i < n * 1.3; i++) {
      const r = lastRace()!;
      if (r.phase !== "racing") break;
      const key = r.next!.join(",");
      if (key !== last) { checkpoints++; last = key; }
      const q = track.points[(startAt + i) % n];
      c.send({ t: "move", x: q.x, y: track.y, z: q.z, yaw: q.yaw, pitch: 0, flying: false, sprinting: true, onGround: true, heading: q.yaw });
      await sleep(4);
      await run(0.05);
    }
    expect(checkpoints).toBeGreaterThan(5);
    const done = lastRace()!;
    expect(done.phase).toBe("finished");
    expect(done.results?.[0]?.name).toBe("Racer");
    expect(done.results?.[0]?.time).toBeGreaterThan(0);
    // First prize.
    expect(JSON.stringify(c.messages.slice(-200))).toMatch(/Prize: 2 Diamond/);
    // Then it all goes: off the kart, the kart gone, the course taken up.
    await run(14);
    expect(lastRace()!.phase).toBe("over");
    expect(player().riding).toBeNull();
    expect([...game.entities.all.values()].some((e) => e.type.name.includes("kart"))).toBe(false);
    const after = reg.blockById(game.world.getBlock(Math.floor(start[0]), start[1] - 1, Math.floor(start[2]))).name;
    expect(after).not.toBe("wool");
  }, 120000);
});
