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

  /**
   * A creature's call, now and then: its voice from what it is (birds chirp, beasts low or yip,
   * people murmur, fish blow bubbles, slimes squelch, insects buzz, spirits moan, sleepers
   * snore), pitched by size.
   */
  call(voice: string, size: number, pos?: [number, number, number]): void {
    const g = this.gainAt(pos);
    if (g <= 0) return;
    const k = Math.max(0.4, Math.min(3, size));
    const f = (base: number) => base / Math.sqrt(k);
    if (voice === "bird") { const n = 2 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) this.tone(f(2400) * (0.9 + Math.random() * 0.3), 0.08, 0.08 * g, "sine", i * 0.12, f(3200)); }
    else if (voice === "beast") this.tone(f(260), 0.6 + k * 0.15, 0.12 * g, "sawtooth", 0, f(180));
    else if (voice === "small") { this.tone(f(900), 0.09, 0.1 * g, "square", 0, f(700)); this.tone(f(950), 0.09, 0.08 * g, "square", 0.16, f(720)); }
    else if (voice === "person") { for (let i = 0; i < 3; i++) this.tone(f(220) * (0.9 + Math.random() * 0.25), 0.14, 0.06 * g, "triangle", i * 0.16); }
    else if (voice === "fish") for (let i = 0; i < 4; i++) setTimeout(() => this.noise(0.05, 900 + Math.random() * 600, 4, 0.12 * g), i * 90);
    else if (voice === "slime") this.noise(0.25, 300, 1.5, 0.25 * g, "lowpass");
    else if (voice === "insect") this.noise(0.6, 380, 6, 0.08 * g, "bandpass");
    else if (voice === "spirit") this.tone(f(330), 1.4, 0.07 * g, "sine", 0, f(220));
    else if (voice === "growl") { this.tone(f(110), 0.8, 0.12 * g, "sawtooth", 0, f(80)); this.noise(0.7, f(500), 0.8, 0.08 * g); }
    else if (voice === "snore") this.noise(1.1, 220, 1, 0.07 * g, "lowpass");
  }

  private rainSrc: AudioBufferSourceNode | null = null;
  private rainGain: GainNode | null = null;

  /** The patter of rain (0 = none, 1 = a downpour), a soft looping noise. */
  setRain(level: number): void {
    const { ctx, master, noiseBuf } = this;
    if (!ctx || !master || !noiseBuf) return;
    if (!this.rainSrc && level > 0.01) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 2400; f.Q.value = 0.4;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(master);
      src.start();
      this.rainSrc = src; this.rainGain = g;
    }
    if (this.rainGain) this.rainGain.gain.setTargetAtTime(Math.max(0, level) * 0.12, ctx.currentTime, 0.8);
  }

  /** Thunder: a crack close by, a long low rumble far away (it arrives later the further it is). */
  thunder(distance: number): void {
    const delay = Math.min(4, distance / 340 * 3);
    const g = Math.max(0.15, 1 - distance / 200);
    setTimeout(() => {
      if (distance < 40) this.noise(0.35, 1800, 0.6, 0.5 * g, "highpass");
      this.noise(2.8, 120, 0.7, 0.9 * g, "lowpass");
      this.tone(45, 2.2, 0.4 * g, "sine", 0.1, 30);
    }, delay * 1000);
  }

  /** A critical hit: a bright, short ring. */
  crit(): void {
    this.tone(880, 0.12, 0.12, "triangle", 0, 1320);
    this.noise(0.08, 3000, 1, 0.15, "highpass");
  }

  /** A creature's roar or growl: deeper for bigger ones. */
  roar(size: number, pos?: [number, number, number]): void {
    const g = 0.3 * this.gainAt(pos);
    const f = Math.max(45, 220 / Math.max(0.6, size));
    this.tone(f, 0.9, g, "sawtooth", 0, f * 0.6);
    this.tone(f * 1.5, 0.7, g * 0.4, "square", 0.05, f * 0.9);
    this.noise(0.8, f * 6, 0.8, g * 0.6, "bandpass");
  }

  explosion(distance: number): void {
    const g = Math.max(0, 1 - distance / 80);
    this.noise(1.6, 180, 0.6, 0.9 * g, "lowpass");
    this.tone(55, 0.8, 0.5 * g, "sine", 0, 30);
  }

  click(): void {
    this.tone(660, 0.05, 0.08, "square");
  }

  /** The world's musical key and mode (audio standards); stingers follow it so a themed world sounds its own. */
  private keyShift = 1;
  private minor = false;
  private dorian = false;
  setKey(key: string, mode: string): void {
    const semis: Record<string, number> = { C: -2, "C#": -1, Db: -1, D: 0, "D#": 1, Eb: 1, E: 2, F: 3, "F#": 4, Gb: 4, G: 5, "G#": 6, Ab: 6, A: -5, "A#": -4, Bb: -4, B: -3 };
    this.keyShift = Math.pow(2, (semis[key] ?? 0) / 12);
    this.minor = mode === "minor" || mode === "dorian";
    this.dorian = mode === "dorian";
  }

  /** World-event stingers, in the world's key (D major by default) so overlapping ones don't clash. */
  stinger(kind: "gathering" | "arrival" | "fizzle" | "undo"): void {
    const k = this.keyShift;
    const D = 293.66 * k, A = 440 * k, D5 = 587.33 * k, G = 392 * k;
    // Minor modes flatten the third (and, outside dorian, the sixth).
    const Fs = (this.minor ? 349.23 : 369.99) * k, B = (this.minor && !this.dorian ? 466.16 : 493.88) * k;
    if (kind === "gathering") [D, A, D5].forEach((f, i) => this.tone(f, 1.4, 0.07, "sine", i * 0.25));
    else if (kind === "arrival") [D, Fs, A, D5].forEach((f, i) => this.tone(f, 1.2, 0.09, "triangle", i * 0.09));
    else if (kind === "fizzle") [A, G, Fs].forEach((f, i) => this.tone(f, 0.5, 0.07, "sine", i * 0.15));
    else [D5, B, G, D].forEach((f, i) => this.tone(f, 0.6, 0.07, "sine", i * 0.12));
  }
}
