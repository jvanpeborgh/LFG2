import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { DEFAULT_STANDARDS, PROTOCOL_VERSION, VANILLA_CONTENT, buildRegistry, type ServerMessage } from "@lfg/shared";
import { Game } from "../src/game";
import { VANILLA_MODULES } from "../src/modules";
import type { GearService } from "../src/modules/vanilla/gear";
import type { SummonService } from "../src/modules/vanilla/summons";
import { TestClient } from "./helpers";

const reg = buildRegistry([VANILLA_CONTENT.id], DEFAULT_STANDARDS);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("creature gear", () => {
  let dir: string, game: Game, http: Server, c: TestClient;
  const run = async (s: number) => { for (let t = 0; t < s; t += 0.05) { game.step(0.05); if (Math.round(t * 20) % 10 === 0) await sleep(1); } await sleep(20); };
  const say = async (text: string) => {
    const n = c.messages.length;
    c.send({ t: "chat", text });
    for (let i = 0; i < 100 && !c.messages.slice(n).some((m) => m.t === "chat"); i++) { await sleep(10); await run(0.05); }
    return c.messages.slice(n).filter((m) => m.t === "chat").map((m) => (m as { text: string }).text).join("\n");
  };
  const player = () => game.players.get("smith")!;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "lfg2-gear-"));
    game = new Game({ modules: VANILLA_MODULES, dataDir: dir, worldName: "t", seed: 9, viewDistance: 2, log: () => {}, randomSeed: 5 });
    await game.init();
    http = createServer();
    new WebSocketServer({ server: http, path: "/ws" }).on("connection", (s) => game.handleConnection(s));
    await new Promise<void>((r) => http.listen(0, r));
    const addr = http.address();
    c = new TestClient(`ws://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/ws`);
    await c.open();
    c.send({ t: "hello", name: "Smith", protocol: PROTOCOL_VERSION, fingerprint: reg.fingerprint() });
    await c.waitFor("welcome");
    await run(1);
  }, 30000);
  afterAll(async () => { c.ws.close(); await game.stop(); http.close(); rmSync(dir, { recursive: true, force: true }); });

  it("wears dragon armour: it blocks a share of hits, resists fire, and everyone sees it", async () => {
    expect(await say("/loot an angry red dragon helm")).toMatch(/Helm/);
    expect(await say("/loot an angry red dragon plate")).toMatch(/Plate/);
    const p = player();
    // Hold each piece and right-click to put it on.
    for (const kind of ["relic_helm", "relic_plate"]) {
      const i = p.hotbar.findIndex((s) => s && reg.itemById(s.item)?.name === kind);
      expect(i).toBeGreaterThanOrEqual(0);
      p.selected = i;
      c.send({ t: "useItem" });
      await run(0.2);
    }
    const worn = (game.kernel.services.get("gear")!.value as GearService).worn(p);
    expect(worn.head?.meta?.name).toMatch(/Helm/);
    expect(worn.chest?.meta?.perks).toContain("fire_resist");
    const wear = [...c.messages].reverse().find((m) => m.t === "wear") as Extract<ServerMessage, { t: "wear" }>;
    expect(wear.gear.head?.main).toMatch(/^#/);
    // A hit hurts less; fire hardly at all.
    p.entity.health = 100;
    const melee = game.kernel.emit("entity:damage", { entity: p.entity, amount: 20, source: { kind: "melee" }, cancelled: false });
    expect(melee.amount).toBeLessThan(20);
    const fire = game.kernel.emit("entity:damage", { entity: p.entity, amount: 20, source: { kind: "fire" }, cancelled: false });
    expect(fire.amount).toBeLessThan(melee.amount);
    expect(await say("/gear")).toMatch(/Blocks \d+% of hits/);
    // Taken off, it's back in the inventory.
    expect(await say("/gear off head")).toMatch(/Took off/);
    expect((game.kernel.services.get("gear")!.value as GearService).worn(p).head).toBeUndefined();
  }, 30000);

  it("a defeated boss drops gear made from it, with lore naming who felled it", async () => {
    const p = player();
    const svc = game.kernel.services.get("summons")!.value as SummonService;
    const spec = { ...svc.plan("an angry wolf").spec!, role: "boss" as const };
    const prepared = svc.prepare(spec, 3);
    if (typeof prepared === "string") throw new Error(prepared);
    const e = svc.spawn(spec, prepared.stats, p.entity.x + 2, p.entity.y, p.entity.z, { by: "Mira" });
    const before = [...game.entities.all.values()].filter((x) => x.type.kind === "item").length;
    game.kernel.emit("entity:death", { entity: e, source: { kind: "melee", attacker: p.entity } });
    const drops = [...game.entities.all.values()].filter((x) => x.type.kind === "item").map((x) => x.data.item as { meta?: { name: string; lore: string[] } }).filter((s) => s.meta);
    expect(drops.length).toBeGreaterThanOrEqual(2);
    expect(drops.length + before).toBeGreaterThan(before);
    expect(drops[0].meta!.lore[0]).toMatch(/Mira's .*Wolf, felled by Smith/);
  }, 30000);

  it("keeps what you wear when you come back", async () => {
    const p = player();
    await say("/loot a shark helm");
    const i = p.hotbar.findIndex((s) => s?.meta?.kind === "helm" && s.meta.perks.includes("water_breathing"));
    p.selected = i;
    c.send({ t: "useItem" });
    await run(0.2);
    expect(p.gearEffects).toContain("water_breathing");
    const saved = JSON.parse(JSON.stringify(p.toSave()));
    expect(saved.data.gear.head.meta.name).toMatch(/Helm/);
  }, 30000);
});
