import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { DEFAULT_STANDARDS, PROTOCOL_VERSION, VANILLA_CONTENT, buildRegistry } from "@lfg/shared";
import { Accounts } from "../src/accounts";
import { WorldHost } from "../src/host";
import { VANILLA_MODULES } from "../src/modules";
import { TestClient } from "./helpers";

const reg = buildRegistry([VANILLA_CONTENT.id], DEFAULT_STANDARDS);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const KEY_A = "alice-browser-key-0123456789", KEY_B = "bob-browser-key-0123456789ab";

describe("names, invites and first steps", () => {
  let dir: string, host: WorldHost, http: Server, ws: string, accounts: Accounts;
  const open: TestClient[] = [];
  const join_ = async (name: string, opts: { key?: string; invite?: string; world?: string } = {}) => {
    const c = new TestClient(`${ws}?world=${opts.world ?? "world"}`);
    open.push(c);
    await c.open();
    c.send({ t: "hello", name, protocol: PROTOCOL_VERSION, fingerprint: reg.fingerprint(), key: opts.key, invite: opts.invite });
    const m = await Promise.race([c.waitFor("welcome"), c.waitFor("reject")]);
    return { c, m };
  };
  const say = async (c: TestClient, text: string) => {
    const before = c.messages.length;
    c.send({ t: "chat", text });
    await sleep(250);
    return c.messages.slice(before).filter((m) => m.t === "chat").map((m) => (m as { text: string }).text).join("\n");
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "lfg2-social-"));
    accounts = new Accounts(join(dir, "accounts.json"));
    host = new WorldHost({ dataDir: dir, defaultWorld: "world", accounts, game: { modules: VANILLA_MODULES, seed: 42, viewDistance: 1, log: () => {}, publicUrl: "http://game.example" } });
    await host.get("world");
    http = createServer();
    new WebSocketServer({ server: http, path: "/ws" }).on("connection", (s, req) => host.connect(s, new URL(req.url ?? "/", "http://x").searchParams.get("world") ?? "world"));
    await new Promise<void>((r) => http.listen(0, r));
    const addr = http.address();
    ws = `ws://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/ws`;
  }, 60000);

  afterAll(async () => {
    for (const c of open) c.ws.close();
    await host.stopAll();
    http.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps a name for the browser that claimed it", async () => {
    const a = await join_("Alice", { key: KEY_A });
    expect(a.m.t).toBe("welcome");
    a.c.ws.close(); await sleep(200);
    expect((await join_("Alice")).m).toMatchObject({ t: "reject", reason: expect.stringMatching(/belongs to someone else/) });
    expect((await join_("Alice", { key: "someone-elses-key-0123456789" })).m.t).toBe("reject");
    expect((await join_("alice", { key: KEY_A })).m.t).toBe("welcome");
  });

  it("signs in on another device with a one-time code", async () => {
    const [a] = open.filter((c) => c.ws.readyState === 1);
    const text = await say(a, "/device");
    const code = /enter ([A-Z0-9]{6})/.exec(text)![1];
    const r = accounts.redeem(code)!;
    expect(r.name).toBe("Alice");
    expect(accounts.verify("Alice", r.key)).toBe(true);
    expect(accounts.redeem(code)).toBeNull(); // once only
  });

  it("shows first steps to someone new, and ticks them off", async () => {
    const b = await join_("Bob", { key: KEY_B });
    const steps = await b.c.waitFor("steps", (m) => !!m.steps);
    expect(steps.steps!.map((s) => s.id)).toEqual(["walk", "summon", "invite", "friend"]);
    await say(b.c, "/invite");
    await b.c.waitFor("steps", (m) => !!m.steps?.find((s) => s.id === "invite")?.done);
    expect(await say(b.c, "/steps")).toMatch(/hidden/);
    b.c.ws.close(); await sleep(200);
  });

  it("an invite-only world lets in invited friends, next to whoever invited them", async () => {
    const made = await host.create("secret-garden", "Alice", { title: "Secret Garden", access: "invite" });
    expect(made.ok).toBe(true);
    host.open("secret-garden", "Alice");
    for (const c of open) c.ws.close();
    await sleep(300);
    const a = await join_("Alice", { key: KEY_A, world: "secret-garden" });
    expect(a.m.t).toBe("welcome");
    a.c.send({ t: "chat", text: "/invite" });
    const inv = await a.c.waitFor("invite");
    expect(inv.url).toMatch(/^http:\/\/game\.example\/\?join=[a-z0-9]{8}$/);
    const code = inv.url.split("join=")[1];
    expect(host.invite(code)).toMatchObject({ world: "secret-garden", by: "Alice", title: "Secret Garden" });
    // Without the link: no way in.
    expect((await join_("Bob", { key: KEY_B, world: "secret-garden" })).m).toMatchObject({ t: "reject", reason: expect.stringMatching(/invite-only/) });
    // With it: in, next to Alice, and both hear about it.
    const b = await join_("Bob", { key: KEY_B, world: "secret-garden", invite: code });
    expect(b.m.t).toBe("welcome");
    await sleep(400);
    const game = (await host.get("secret-garden"))!;
    const pa = game.players.get("alice")!, pb = game.players.get("bob")!;
    expect(Math.hypot(pa.entity.x - pb.entity.x, pa.entity.z - pb.entity.z)).toBeLessThan(3);
    expect(a.c.messages.some((m) => m.t === "chat" && /Bob joined, invited by Alice/.test((m as { text: string }).text))).toBe(true);
    await a.c.waitFor("steps", (m) => m.steps === null || !!m.steps.find((s) => s.id === "friend")?.done);
    // Bob is a member now: back in without the link.
    b.c.ws.close(); await sleep(300);
    expect((await join_("Bob", { key: KEY_B, world: "secret-garden" })).m.t).toBe("welcome");
    // Alice can open it to everyone.
    expect(await say(a.c, "/world access public")).toMatch(/open to everyone/);
  }, 30000);
});
