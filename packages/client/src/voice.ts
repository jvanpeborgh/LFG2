/**
 * Push-to-talk voice input: hold B (or the mic button), speak, release.
 *
 * Two ways to turn speech into text:
 *   server   record the clip (MediaRecorder) and send it to the game server,
 *            which forwards it to the transcription service its host chose.
 *            Works in every browser with a microphone.
 *   browser  the Web Speech API (Chrome, Edge, Safari): no upload to our
 *            server, live partial results while you speak; the browser
 *            vendor does the recognition.
 *
 * The microphone is only open while the key is held (the browser's mic
 * indicator shows it), clips are short (≤ 15 s), and nothing is kept.
 */

export type VoiceMode = "auto" | "server" | "browser" | "off";

export interface VoiceEvents {
  /** Listening started (true) or stopped (false). */
  listening(on: boolean): void;
  /** Microphone level 0..1 while listening (for the meter). */
  level(v: number): void;
  /** Partial text while speaking (browser recognition only). */
  interim(text: string): void;
  /** Waiting for the server to transcribe. */
  working(): void;
  /** Final text, with the recogniser's confidence where it gives one. */
  result(text: string, confidence: number | null): void;
  error(message: string): void;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

const MAX_SECONDS = 15;
const MIN_SECONDS = 0.35;

function speechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export class Voice {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private meterTimer = 0;
  private stopTimer = 0;
  private startedAt = 0;
  private recognition: SpeechRecognitionLike | null = null;
  private active = false;

  constructor(
    private opts: { token: string; serverAvailable: boolean; lang: string; mode: () => VoiceMode },
    private on: VoiceEvents,
  ) {}

  /** Which way it will transcribe right now (null = voice isn't available). */
  get provider(): "server" | "browser" | null {
    const mode = this.opts.mode();
    const canServer = this.opts.serverAvailable && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
    const canBrowser = !!speechRecognitionCtor();
    if (mode === "off") return null;
    if (mode === "server") return canServer ? "server" : null;
    if (mode === "browser") return canBrowser ? "browser" : null;
    return canServer ? "server" : canBrowser ? "browser" : null;
  }

  get listening(): boolean {
    return this.active;
  }

  async start(): Promise<void> {
    if (this.active) return;
    const provider = this.provider;
    if (!provider) {
      this.on.error(this.opts.mode() === "off" ? "Voice is off (Settings)" : "Voice needs a microphone and either a browser with speech recognition or a server with transcription set up");
      return;
    }
    this.active = true;
    this.startedAt = performance.now();
    this.on.listening(true);
    try {
      if (provider === "browser") this.startBrowser();
      else await this.startServer();
      this.stopTimer = window.setTimeout(() => this.stop(), MAX_SECONDS * 1000);
    } catch (e) {
      this.cleanup();
      this.on.error(e instanceof Error && e.name === "NotAllowedError" ? "Microphone permission was denied" : `Microphone: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Release: finish the clip and transcribe it. */
  stop(): void {
    if (!this.active) return;
    clearTimeout(this.stopTimer);
    const short = (performance.now() - this.startedAt) / 1000 < MIN_SECONDS;
    if (this.recognition) {
      if (short) { this.recognition.abort(); this.cleanup(); this.on.error("Hold B while you speak"); return; }
      this.recognition.stop(); // results arrive in onresult/onend
      return;
    }
    if (this.recorder && this.recorder.state !== "inactive") {
      (this.recorder as MediaRecorder & { tooShort?: boolean }).tooShort = short;
      this.recorder.stop();
    }
  }

  /** Throw away what's being recorded. */
  cancel(): void {
    if (this.recognition) this.recognition.abort();
    if (this.recorder) { this.recorder.ondataavailable = null; this.recorder.onstop = null; if (this.recorder.state !== "inactive") this.recorder.stop(); }
    this.cleanup();
  }

  // ------------------------------------------------------------------ server transcription

  private async startServer(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
    if (!this.active) { this.cleanup(); return; } // released before permission came through
    const type = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
    const rec = new MediaRecorder(this.stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      const tooShort = (rec as MediaRecorder & { tooShort?: boolean }).tooShort;
      const mime = (rec.mimeType || type || "audio/webm").split(";")[0];
      this.cleanup();
      if (tooShort) { this.on.error("Hold B while you speak"); return; }
      void this.upload(new Blob(chunks, { type: mime }));
    };
    rec.start();
    this.recorder = rec;
    this.meter(this.stream);
  }

  private async upload(clip: Blob): Promise<void> {
    this.on.working();
    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        body: clip,
        headers: { "content-type": clip.type || "audio/webm", "x-voice-token": this.opts.token, "x-voice-language": this.opts.lang },
      });
      const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? `server answered ${res.status}`);
      this.on.result(body.text ?? "", null);
    } catch (e) {
      this.on.error(`Couldn't transcribe: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** A simple input level meter (so you can see it hears you). */
  private meter(stream: MediaStream): void {
    try {
      this.audioCtx = new AudioContext();
      const src = this.audioCtx.createMediaStreamSource(stream);
      const an = this.audioCtx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      this.meterTimer = window.setInterval(() => {
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128) / 128);
        this.on.level(Math.min(1, peak * 1.6));
      }, 60);
    } catch { /* no meter, still records */ }
  }

  // ------------------------------------------------------------------ browser recognition

  private startBrowser(): void {
    const Ctor = speechRecognitionCtor()!;
    const r = new Ctor();
    r.lang = this.opts.lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    let final = "", confidence: number | null = null, gotError = false;
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) { final += res[0].transcript; confidence = res[0].confidence || null; }
        else interim += res[0].transcript;
      }
      this.on.interim((final + interim).trim());
    };
    r.onerror = (e) => {
      gotError = true;
      if (e.error === "aborted") return;
      this.on.error(e.error === "not-allowed" ? "Microphone permission was denied" : e.error === "no-speech" ? "Didn't hear anything" : `Speech recognition: ${e.error}`);
    };
    r.onend = () => {
      this.cleanup();
      if (!gotError) final.trim() ? this.on.result(final.trim(), confidence) : this.on.error("Didn't catch that");
    };
    r.start();
    this.recognition = r;
  }

  private cleanup(): void {
    clearTimeout(this.stopTimer);
    clearInterval(this.meterTimer);
    this.stream?.getTracks().forEach((t) => t.stop()); // the mic turns off between clips
    this.stream = null;
    void this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
    this.recorder = null;
    this.recognition = null;
    if (this.active) { this.active = false; this.on.listening(false); }
  }
}
