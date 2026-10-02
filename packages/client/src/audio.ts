/**
 * Procedural sound effects (docs/standards/audio-and-music.md: made in code,
 * short, varied pitch, positional where it matters, world-event stingers in
 * D major). A compressor on the master bus keeps loud moments in check.
 */
export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  volume = 0.6;
  listener = { x: 0, y: 0, z: 0 };

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const ctx = new AudioContext();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    const master = ctx.createGain();
    master.gain.value = this.volume;
    master.connect(comp).connect(ctx.destination);
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.ctx = ctx;
    this.master = master;
    this.noiseBuf = buf;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /** Distance attenuation (max 32 m, per the standards). Returns 0 if out of range. */
  private gainAt(pos?: [number, number, number]): number {
    if (!pos) return 1;
    const d = Math.hypot(pos[0] - this.listener.x, pos[1] - this.listener.y, pos[2] - this.listener.z);
    return Math.max(0, 1 - d / 32);
  }

  private noise(dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = "bandpass"): void {
    const { ctx, master, noiseBuf } = this;
    if (!ctx || !master || !noiseBuf || gain <= 0) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq * (0.95 + Math.random() * 0.1);
    f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = "sine", delay = 0, slideTo?: number): void {
    const { ctx, master } = this;
    if (!ctx || !master || gain <= 0) return;
    const o = ctx.createOscillator();
    o.type = type;
    const t = ctx.currentTime + delay;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Digging tick; pitch roughly follows how "hard" the material sounds. */
  dig(material: string, pos?: [number, number, number]): void {
    const hard = /stone|ore|brick|cobble|furnace|bedrock|ice|glass/.test(material);
    const soft = /grass|leaves|sapling|wool|snow|sand|gravel|dirt/.test(material);
    this.noise(0.08, hard ? 2400 : soft ? 900 : 1500, hard ? 3 : 1.2, 0.35 * this.gainAt(pos));
  }

  breakBlock(material: string, pos?: [number, number, number]): void {
    const hard = /stone|ore|brick|cobble|furnace|bedrock/.test(material);
    const glass = /glass|ice/.test(material);
    if (glass) { this.noise(0.25, 5000, 2, 0.4 * this.gainAt(pos), "highpass"); return; }
    this.noise(0.18, hard ? 1800 : 700, 1, 0.5 * this.gainAt(pos));
  }

  place(pos?: [number, number, number]): void {
    this.noise(0.1, 500, 1.5, 0.45 * this.gainAt(pos));
  }

  pickup(): void {
    this.tone(880 + Math.random() * 120, 0.08, 0.12, "triangle");
  }

  hurt(self: boolean, pos?: [number, number, number]): void {
    const g = (self ? 0.35 : 0.25) * this.gainAt(pos);
    this.tone(self ? 220 : 300, 0.15, g, "square", 0, self ? 150 : 200);
  }

  eat(): void {
    for (let i = 0; i < 3; i++) setTimeout(() => this.noise(0.06, 1200, 2, 0.25), i * 110);
  }

  swing(): void {
    this.noise(0.12, 1800, 0.7, 0.12, "highpass");
  }

  fuse(pos?: [number, number, number]): void {
    this.noise(1.4, 3000, 0.5, 0.25 * this.gainAt(pos), "highpass");
  }

  explosion(distance: number): void {
    const g = Math.max(0, 1 - distance / 80);
    this.noise(1.6, 180, 0.6, 0.9 * g, "lowpass");
    this.tone(55, 0.8, 0.5 * g, "sine", 0, 30);
  }

  click(): void {
    this.tone(660, 0.05, 0.08, "square");
  }

  /** World-event stingers, all in D major so overlapping ones don't clash. */
  stinger(kind: "gathering" | "arrival" | "fizzle" | "undo"): void {
    const D = 293.66, Fs = 369.99, A = 440, D5 = 587.33, B = 493.88, G = 392;
    if (kind === "gathering") [D, A, D5].forEach((f, i) => this.tone(f, 1.4, 0.07, "sine", i * 0.25));
    else if (kind === "arrival") [D, Fs, A, D5].forEach((f, i) => this.tone(f, 1.2, 0.09, "triangle", i * 0.09));
    else if (kind === "fizzle") [A, G, Fs].forEach((f, i) => this.tone(f, 0.5, 0.07, "sine", i * 0.15));
    else [D5, B, G, D].forEach((f, i) => this.tone(f, 0.6, 0.07, "sine", i * 0.12));
  }
}
