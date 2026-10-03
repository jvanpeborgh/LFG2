import type { IncomingMessage, ServerResponse } from "node:http";
import { VOICE_HINT } from "@lfg/shared";

/**
 * Speech to text on the server, for voice summons.
 *
 * The browser records a short push-to-talk clip and uploads it here; this
 * forwards it to any OpenAI-compatible transcription endpoint
 * (POST …/audio/transcriptions, multipart: file, model): OpenAI, Groq, or a
 * self-hosted Whisper server (whisper.cpp, faster-whisper-server). Audio is
 * never stored. Only players connected to the game can use it (a per-session
 * token from the welcome message), with a size and rate limit, so the API key
 * can't be used by anyone else.
 *
 * Browsers with the Web Speech API can transcribe on their own; this is for
 * the rest, and for hosts who want to choose where audio goes.
 */
export interface TranscriberOptions {
  /** e.g. https://api.openai.com/v1/audio/transcriptions or http://localhost:8000/v1/audio/transcriptions */
  url?: string;
  apiKey?: string;
  model?: string;
  /** Largest upload (bytes). About 15 s of opus audio is far below this. */
  maxBytes?: number;
  /** Clips per player per minute. */
  perMinute?: number;
}

export class Transcriber {
  readonly url: string | null;
  private apiKey: string | undefined;
  private model: string;
  readonly maxBytes: number;
  private perMinute: number;
  private recent = new Map<string, number[]>();

  constructor(opts: TranscriberOptions, private fetchImpl: typeof fetch = fetch) {
    this.url = opts.url || null;
    this.apiKey = opts.apiKey;
    this.model = opts.model || "whisper-1";
    this.maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
    this.perMinute = opts.perMinute ?? 12;
  }

  /** From the environment: TRANSCRIBE_URL (or OPENAI_API_KEY alone for OpenAI), TRANSCRIBE_API_KEY, TRANSCRIBE_MODEL. */
  static fromEnv(env: NodeJS.ProcessEnv): Transcriber {
    const key = env.TRANSCRIBE_API_KEY ?? env.OPENAI_API_KEY;
    const url = env.TRANSCRIBE_URL ?? (env.OPENAI_API_KEY ? "https://api.openai.com/v1/audio/transcriptions" : undefined);
    return new Transcriber({ url, apiKey: key, model: env.TRANSCRIBE_MODEL });
  }

  get available(): boolean {
    return !!this.url;
  }

  /** Rate limit per player; true if this clip is allowed. */
  allow(who: string, now = Date.now()): boolean {
    const times = (this.recent.get(who) ?? []).filter((t) => now - t < 60_000);
    if (times.length >= this.perMinute) { this.recent.set(who, times); return false; }
    times.push(now);
    this.recent.set(who, times);
    return true;
  }

  async transcribe(audio: Uint8Array, mime: string, language?: string): Promise<string> {
    if (!this.url) throw new Error("transcription isn't set up on this server");
    const form = new FormData();
    const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "mp4" : mime.includes("wav") ? "wav" : "webm";
    form.append("file", new Blob([audio], { type: mime }), `speech.${ext}`);
    form.append("model", this.model);
    form.append("response_format", "json");
    form.append("prompt", VOICE_HINT);
    if (language) form.append("language", language);
    const res = await this.fetchImpl(this.url, {
      method: "POST",
      body: form,
      headers: this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {},
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`transcription service answered ${res.status}`);
    const body = (await res.json()) as { text?: string };
    return (body.text ?? "").trim();
  }
}

const readBody = (req: IncomingMessage, max: number): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > max) { reject(new Error("too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    req.on("error", reject);
  });

/**
 * POST /api/transcribe (body: the audio clip; headers: content-type, x-voice-token,
 * optional x-voice-language) → { text }. Returns false if the request isn't for it.
 */
export function handleTranscribe(
  req: IncomingMessage,
  res: ServerResponse,
  t: Transcriber,
  playerForToken: (token: string) => string | null,
): boolean {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname !== "/api/transcribe") return false;
  const reply = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };
  if (req.method !== "POST") { reply(405, { error: "POST an audio clip" }); return true; }
  if (!t.available) { reply(503, { error: "transcription isn't set up on this server" }); return true; }
  const who = playerForToken(String(req.headers["x-voice-token"] ?? ""));
  if (!who) { reply(401, { error: "join the game first" }); return true; }
  const mime = String(req.headers["content-type"] ?? "");
  if (!/^audio\//.test(mime)) { reply(415, { error: "send audio (e.g. audio/webm)" }); return true; }
  if (Number(req.headers["content-length"] ?? 0) > t.maxBytes) { reply(413, { error: "clip too long" }); return true; }
  if (!t.allow(who)) { reply(429, { error: "too many voice commands; wait a moment" }); return true; }
  const lang = String(req.headers["x-voice-language"] ?? "").slice(0, 2).toLowerCase();
  readBody(req, t.maxBytes)
    .then((audio) => t.transcribe(audio, mime, /^[a-z]{2}$/.test(lang) ? lang : undefined))
    .then((text) => reply(200, { text }))
    .catch((e: Error) => reply(e.message === "too large" ? 413 : 502, { error: e.message }));
  return true;
}
