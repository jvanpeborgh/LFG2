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
const id = (n: string) => reg.item(n).id;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Survival gameplay over the real protocol: crafting with window clicks,
 * smelting, fall damage, TNT. Time-based mechanics are fast-forwarded by
 * stepping the game loop directly.
 */
describe("survival gameplay", () => {
  let dir: string;
  let game: Game;
  let http: Server;
  let url: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "lfg2-play-"));
    game = new Game({ modules: VANILLA_MODULES, dataDir: dir, worldName: "t", seed: 1234, viewDistance: 2, log: () => {} });
    await game.init();
    game.start();
    http = createServer();
    new WebSocketServer({ server: http, path: "/ws" }).on("connection", (s) => game.handleConnection(s));
    await new Promise<void>((r) => http.listen(0, r));
    const addr = http.address();
    url = `ws://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/ws`;
  }, 30000);

  afterAll(async () => {
    await game.stop();
    http.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const join_ = async (name: string) => {
    const c = new TestClient(url);
    await c.open();
    c.send({ t: "hello", name, protocol: PROTOCOL_VERSION, fingerprint: reg.fingerprint() });
    const welcome = await c.waitFor("welcome");
    await sleep(1200); // chunks
    return { c, welcome, player: game.players.get(name.toLowerCase())! };
  };

  it("crafts planks and sticks through inventory clicks", async () => {
    const { c, player } = await join_("Crafter");
    player.hotbar[0] = reg.stack("log", 3);
    // Inventory window indices: 0 result, 1–4 craft grid, 5–31 main, 32–40 hotbar.
    c.send({ t: "click", index: 32, button: 0, shift: false }); // pick up logs
    c.send({ t: "click", index: 1, button: 0, shift: false }); // put into grid
    const w = await c.waitFor("window", (m) => m.window?.sections[0].slots[0]?.item === id("planks"));
    expect(w.window!.sections[0].slots[0]!.count).toBe(4);
    c.send({ t: "click", index: 0, button: 0, shift: true }); // shift-craft all
    await c.waitFor("self", (m) => [...m.hotbar, ...m.main].some((s) => s?.item === id("planks") && s.count === 12));
    // Sticks: two planks stacked vertically in the 2×2 grid.
    const inMain = player.main.findIndex((s) => s?.item === id("planks"));
    const planksIdx = inMain >= 0 ? 5 + inMain : 32 + player.hotbar.findIndex((s) => s?.item === id("planks"));
    c.send({ t: "click", index: planksIdx, button: 0, shift: false });
    c.send({ t: "click", index: 1, button: 1, shift: false }); // one plank top-left
    c.send({ t: "click", index: 3, button: 1, shift: false }); // one plank bottom-left
    await c.waitFor("window", (m) => m.window?.sections[0].slots[0]?.item === id("stick"));
    c.send({ t: "click", index: planksIdx, button: 0, shift: false }); // put the rest of the planks back
    c.send({ t: "closeWindow" });
    await sleep(200);
    // Closing the window returns the grid contents: still 12 planks in total.
    const planks = [...player.hotbar, ...player.main].filter((s) => s?.item === id("planks")).reduce((n, s) => n + s!.count, 0);
    expect(planks).toBe(12);
    c.ws.close();
  }, 20000);

  it("smelts cobblestone into stone in a furnace", async () => {
    const { c, welcome, player } = await join_("Smelter");
    const [x, y, z] = welcome.position.map(Math.floor);
    game.world.setBlockTracked(x + 2, y, z, reg.blockId("furnace"));
    player.hotbar[0] = reg.stack("cobblestone", 2);
    player.hotbar[1] = reg.stack("coal", 1);
    c.send({ t: "place", x: x + 2, y, z, nx: -1, ny: 0, nz: 0, yaw: 0 });
    await c.waitFor("window", (m) => m.window?.kind === "furnace");
    // Furnace window: 0 input, 1 fuel, 2 output, 3–29 main, 30–38 hotbar.
    c.send({ t: "click", index: 30, button: 0, shift: false });
    c.send({ t: "click", index: 0, button: 0, shift: false });
    c.send({ t: "click", index: 31, button: 0, shift: false });
    c.send({ t: "click", index: 1, button: 0, shift: false });
    await sleep(300);
    for (let i = 0; i < 90; i++) game.step(0.25); // ~22 s of game time
    const be = game.world.getBlockEntity(x + 2, y, z)!;
    expect(be.slots.output[0]).toMatchObject({ item: id("stone"), count: 2 });
    expect(be.slots.input[0]).toBeNull();
    c.ws.close();
  }, 20000);

  it("hurts players who fall too far", async () => {
    const { c, welcome, player } = await join_("Faller");
    const [x, y, z] = welcome.position;
    game.teleport(player, x, y + 12, z);
    await c.waitFor("teleport");
    for (let yy = y + 12; yy >= y; yy -= 1) {
      c.send({ t: "move", x, y: yy, z, yaw: 0, pitch: 0, flying: false, sprinting: false, onGround: yy === y });
      await sleep(60);
    }
    const self = await c.waitFor("self", (m) => m.health < m.maxHealth);
    // 12 blocks with damage starting after 4 → (12 − 4) × 5 = 40.
    expect(self.maxHealth - self.health).toBeGreaterThanOrEqual(35);
    c.ws.close();
  }, 20000);

  it("lights TNT with flint and steel and blows a crater", async () => {
    const { c, welcome, player } = await join_("Blaster");
    const [x, y, z] = welcome.position.map(Math.floor);
    const tx = x + 3, ty = y - 1;
    game.world.setBlockTracked(tx, ty, z, reg.blockId("tnt"));
    player.hotbar[0] = reg.stack("flint_and_steel");
    player.gameMode = "creative"; // don't die in the test
    c.send({ t: "place", x: tx, y: ty, z, nx: 0, ny: 1, nz: 0, yaw: 0 });
    await sleep(200);
    expect(game.world.getBlock(tx, ty, z)).toBe(0); // primed: the block became an entity
    for (let i = 0; i < 100; i++) game.step(0.05); // 5 s
    const ex = await c.waitFor("explosion");
    expect(Math.abs(ex.x - (tx + 0.5))).toBeLessThan(1.5);
    let air = 0;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (game.world.getBlock(tx + dx, ty - 1, z + dz) === 0) air++;
    expect(air).toBeGreaterThan(10);
    c.ws.close();
  }, 20000);

  it("eats food to restore hunger", async () => {
    const { c, player } = await join_("Eater");
    player.hunger = 10;
    player.hotbar[0] = reg.stack("steak", 2);
    player.selected = 0;
    c.send({ t: "useItem" });
    const self = await c.waitFor("self", (m) => m.hunger === 18);
    expect(self.hotbar[0]?.count).toBe(1);
    c.ws.close();
  }, 20000);
});
