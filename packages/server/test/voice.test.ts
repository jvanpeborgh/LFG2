import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { DEFAULT_STANDARDS, PROTOCOL_VERSION, VANILLA_CONTENT, buildRegistry } from "@lfg/shared";
import { Game } from "../src/game";
import { VANILLA_MODULES } from "../src/modules";
import { Transcriber, handleTranscribe } from "../src/transcribe";
import { TestClient } from "./helpers";

const reg = buildRegistry([VANILLA_CONTENT.id], DEFAULT_STANDARDS);
const listen = async (s: Server) => { await new Promise<void>((r) => s.listen(0, r)); const a = s.address(); return typeof a === "object" && a ? a.port : 0; };

describe("voice transcription endpoint", () => {
  let dir: string;
  let game: Game;
  let http: Server, mock: Server;
  let base: string;
  let token: string;
  const received: { auth?: string; body: string }[] = [];

  beforeAll(async () => {
    // A stand-in for an OpenAI-compatible transcription service.
    mock = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c.toString("latin1")));
      req.on("end", () => {
        received.push({ auth: req.headers.authorization, body });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ text: "Summon a huge kraken, please." }));
      });
    });
    const mockPort = await listen(mock);
    const t = new Transcriber({ url: `http://127.0.0.1:${mockPort}/v1/audio/transcriptions`, apiKey: "test-key", model: "whisper-test", perMinute: 3 });
    dir = mkdtempSync(join(tmpdir(), "lfg2-voice-"));
    game = new Game({ modules: VANILLA_MODULES, dataDir: dir, worldName: "t", seed: 42, viewDistance: 1, log: () => {}, voiceServer: t.available });
    await game.init();
    http = createServer((req, res) => { if (!handleTranscribe(req, res, t, (tok) => game.playerForVoiceToken(tok))) { res.writeHead(404); res.end(); } });
    new WebSocketServer({ server: http, path: "/ws" }).on("connection", (s) => game.handleConnection(s));
    const port = await listen(http);
    base = `http://127.0.0.1:${port}`;
    const c = new TestClient(`ws://127.0.0.1:${port}/ws`);
    await c.open();
    c.send({ t: "hello", name: "Speaker", protocol: PROTOCOL_VERSION, fingerprint: reg.fingerprint() });
    const w = await c.waitFor("welcome");
    expect(w.voice?.server).toBe(true);
    token = w.voice!.token;
  }, 30000);

  afterAll(async () => {
    await game.stop();
    http.close(); mock.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const post = (headers: Record<string, string>, body: Uint8Array = new Uint8Array([1, 2, 3, 4])) =>
    fetch(`${base}/api/transcribe`, { method: "POST", headers, body });

  it("transcribes a clip for a connected player, through the configured service", async () => {
    const res = await post({ "content-type": "audio/webm", "x-voice-token": token, "x-voice-language": "en-GB" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "Summon a huge kraken, please." });
    const call = received.at(-1)!;
    expect(call.auth).toBe("Bearer test-key");
    expect(call.body).toMatch(/name="model"\r\n\r\nwhisper-test/);
    expect(call.body).toMatch(/name="language"\r\n\r\nen/);
    expect(call.body).toMatch(/name="prompt"/); // the game's vocabulary as a hint
    expect(call.body).toMatch(/filename="speech.webm"/);
  });

  it("refuses strangers, non-audio, oversized clips and too many clips", async () => {
    expect((await post({ "content-type": "audio/webm" })).status).toBe(401);
    expect((await post({ "content-type": "audio/webm", "x-voice-token": "nope" })).status).toBe(401);
    expect((await post({ "content-type": "text/plain", "x-voice-token": token })).status).toBe(415);
    expect((await post({ "content-type": "audio/webm", "x-voice-token": token }, new Uint8Array(3 * 1024 * 1024))).status).toBe(413);
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await post({ "content-type": "audio/webm", "x-voice-token": token })).status);
    expect(statuses).toContain(429); // 3 a minute in this test (one was used above)
  });
});
