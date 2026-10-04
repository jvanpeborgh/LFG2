/**
 * Procedural sound effects (docs/standards/audio-and-music.md: made in code,
 * short, varied pitch, positional where it matters, world-event stingers in
 * D major). A compressor on the master bus keeps loud moments in check.
 *
 * The place you're in shapes what you hear: sounds pan to where they come from, rooms and caves
 * echo (a short and a long reverb, mixed by how enclosed you are), rain is muffled under a roof,
 * and a soundscape plays under it all: wind in the open (stronger up high and in storms), birds in
 * the trees by day, crickets on summer nights, lapping by the water, drips and a low hum in caves.
 * Footsteps sound like what you walk on.
 */

/** What the space around the listener is like (see soundscape.ts). All 0..1 except room. */
export interface Surroundings {
  /** How closed in: walls and a roof all round = 1, open field = 0. */
  enclosed: number;
  /** Roughly how far the walls are (blocks). */
  room: number;
  /** Under rock: a cave or a mine. */
  cave: number;
  /** A roof overhead (rain is muffled). */
  roof: boolean;
  /** Trees around. */
  trees: number;
  /** Water nearby. */
  water: number;
  /** Grass and flowers around (crickets). */
  grass: number;
}

const OPEN: Surroundings = { enclosed: 0, room: 16, cave: 0, roof: false, trees: 0, water: 0, grass: 0 };
export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** Where every sound goes: straight to the speakers and, by how enclosed you are, into the echoes. */
  private bus: GainNode | null = null;
  private roomWet: GainNode | null = null;
  private caveWet: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  volume = 0.6;
  listener = { x: 0, y: 0, z: 0, yaw: 0 };
  env: Surroundings = { ...OPEN };

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
    // Echoes: a short room and a long cave, made from decaying noise.
    const bus = ctx.createGain();
    bus.connect(master);
    const echo = (seconds: number, dark: number) => {
      const len = Math.floor(ctx.sampleRate * seconds);
      const ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const ch = ir.getChannelData(c);
        let lp = 0;
        for (let i = 0; i < len; i++) {
          lp += (Math.random() * 2 - 1 - lp) * dark; // darker tails in caves
          ch[i] = lp * Math.pow(1 - i / len, 2.4) * (i < ctx.sampleRate * 0.012 ? 0 : 1);
        }
      }
      const conv = ctx.createConvolver();
      conv.buffer = ir;
      const wet = ctx.createGain();
      wet.gain.value = 0;
      bus.connect(conv).connect(wet).connect(master);
      return wet;
    };
    this.roomWet = echo(0.7, 0.6);
    this.caveWet = echo(2.6, 0.25);
    this.bus = bus;
  }

  /** Where a sound at `pos` goes: panned left or right of where you face, into the bus. */
  private out(pos?: [number, number, number]): AudioNode | null {
    const { ctx, bus } = this;
    if (!ctx || !bus) return null;
    if (!pos) return bus;
    const dx = pos[0] - this.listener.x, dz = pos[2] - this.listener.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.5) return bus;
    const yaw = this.listener.yaw;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, ((dx * Math.cos(yaw) - dz * Math.sin(yaw)) / d) * 0.85));
    pan.connect(bus);
    return pan;
  }

  /** The space around you changed (a few times a second). */
  setSurroundings(env: Surroundings): void {
    this.env = env;
    const { ctx } = this;
    if (!ctx || !this.roomWet || !this.caveWet) return;
    const t = ctx.currentTime;
    const cave = env.cave * env.enclosed;
    this.roomWet.gain.setTargetAtTime(env.enclosed * (1 - env.cave) * 0.35 * Math.min(1, env.room / 6), t, 0.4);
    this.caveWet.gain.setTargetAtTime(cave * 0.55, t, 0.6);
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

  private noise(dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = "bandpass", pos?: [number, number, number], delay = 0): void {
    const { ctx, noiseBuf } = this;
    const dest = this.out(pos);
    if (!ctx || !dest || !noiseBuf || gain <= 0) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq * (0.95 + Math.random() * 0.1);
    f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime + delay;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = "sine", delay = 0, slideTo?: number, pos?: [number, number, number]): void {
    const { ctx } = this;
    const dest = this.out(pos);
    if (!ctx || !dest || gain <= 0) return;
    const o = ctx.createOscillator();
    o.type = type;
    const t = ctx.currentTime + delay;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /** Digging tick; pitch roughly follows how "hard" the material sounds. */
  dig(material: string, pos?: [number, number, number]): void {
    const hard = /stone|ore|brick|cobble|furnace|bedrock|ice|glass/.test(material);
    const soft = /grass|leaves|sapling|wool|snow|sand|gravel|dirt/.test(material);
    this.noise(0.08, hard ? 2400 : soft ? 900 : 1500, hard ? 3 : 1.2, 0.35 * this.gainAt(pos), "bandpass", pos);
  }

  breakBlock(material: string, pos?: [number, number, number]): void {
    const hard = /stone|ore|brick|cobble|furnace|bedrock/.test(material);
    const glass = /glass|ice/.test(material);
    if (glass) { this.noise(0.25, 5000, 2, 0.4 * this.gainAt(pos), "highpass", pos); return; }
    this.noise(0.18, hard ? 1800 : 700, 1, 0.5 * this.gainAt(pos), "bandpass", pos);
  }

  place(pos?: [number, number, number]): void {
    this.noise(0.1, 500, 1.5, 0.45 * this.gainAt(pos), "bandpass", pos);
  }

  pickup(): void {
    this.tone(880 + Math.random() * 120, 0.08, 0.12, "triangle");
  }

  hurt(self: boolean, pos?: [number, number, number]): void {
    const g = (self ? 0.35 : 0.25) * this.gainAt(pos);
    this.tone(self ? 220 : 300, 0.15, g, "square", 0, self ? 150 : 200, pos);
  }

  eat(): void {
    for (let i = 0; i < 3; i++) setTimeout(() => this.noise(0.06, 1200, 2, 0.25), i * 110);
  }

  swing(): void {
    this.noise(0.12, 1800, 0.7, 0.12, "highpass");
  }

  fuse(pos?: [number, number, number]): void {
    this.noise(1.4, 3000, 0.5, 0.25 * this.gainAt(pos), "highpass", pos);
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
    if (voice === "bird") { const n = 2 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) this.tone(f(2400) * (0.9 + Math.random() * 0.3), 0.08, 0.08 * g, "sine", i * 0.12, f(3200), pos); }
    else if (voice === "beast") this.tone(f(260), 0.6 + k * 0.15, 0.12 * g, "sawtooth", 0, f(180), pos);
    else if (voice === "small") { this.tone(f(900), 0.09, 0.1 * g, "square", 0, f(700), pos); this.tone(f(950), 0.09, 0.08 * g, "square", 0.16, f(720), pos); }
    else if (voice === "person") { for (let i = 0; i < 3; i++) this.tone(f(220) * (0.9 + Math.random() * 0.25), 0.14, 0.06 * g, "triangle", i * 0.16, undefined, pos); }
    else if (voice === "fish") for (let i = 0; i < 4; i++) this.noise(0.05, 900 + Math.random() * 600, 4, 0.12 * g, "bandpass", pos, i * 0.09);
    else if (voice === "slime") this.noise(0.25, 300, 1.5, 0.25 * g, "lowpass", pos);
    else if (voice === "insect") this.noise(0.6, 380, 6, 0.08 * g, "bandpass", pos);
    else if (voice === "spirit") this.tone(f(330), 1.4, 0.07 * g, "sine", 0, f(220), pos);
    else if (voice === "growl") { this.tone(f(110), 0.8, 0.12 * g, "sawtooth", 0, f(80), pos); this.noise(0.7, f(500), 0.8, 0.08 * g, "bandpass", pos); }
    else if (voice === "snore") this.noise(1.1, 220, 1, 0.07 * g, "lowpass", pos);
  }

  private rainSrc: AudioBufferSourceNode | null = null;
  private rainGain: GainNode | null = null;
  private rainFilter: BiquadFilterNode | null = null;

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
      this.rainSrc = src; this.rainGain = g; this.rainFilter = f;
    }
    // Under a roof the rain is a muffled drumming; deep in a cave, gone.
    const inside = this.env.roof ? 1 : 0;
    const muffle = 1 - this.env.cave * this.env.enclosed;
    if (this.rainGain) this.rainGain.gain.setTargetAtTime(Math.max(0, level) * 0.12 * (inside ? 0.55 : 1) * muffle, ctx.currentTime, 0.8);
    if (this.rainFilter) this.rainFilter.frequency.setTargetAtTime(inside ? 520 : 2400, ctx.currentTime, 0.5);
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
    this.tone(f, 0.9, g, "sawtooth", 0, f * 0.6, pos);
    this.tone(f * 1.5, 0.7, g * 0.4, "square", 0.05, f * 0.9, pos);
    this.noise(0.8, f * 6, 0.8, g * 0.6, "bandpass", pos);
  }

  explosion(distance: number): void {
    const g = Math.max(0, 1 - distance / 80);
    this.noise(1.6, 180, 0.6, 0.9 * g, "lowpass");
    this.tone(55, 0.8, 0.5 * g, "sine", 0, 30);
  }

  click(): void {
    this.tone(660, 0.05, 0.08, "square");
  }

  /** A footstep on this block: grass crunches, stone clicks, wood knocks, sand and snow hush. */
  step(material: string, soft = false, pos?: [number, number, number]): void {
    const g = (soft ? 0.5 : 1) * this.gainAt(pos);
    if (g <= 0) return;
    const r = () => 0.9 + Math.random() * 0.2;
    if (/water/.test(material)) this.noise(0.22, 900 * r(), 0.8, 0.14 * g, "bandpass", pos);
    else if (/stone|ore|brick|cobble|furnace|bedrock|lamp|lantern|neon/.test(material)) { this.noise(0.05, 2600 * r(), 2.5, 0.16 * g, "bandpass", pos); this.tone(140 * r(), 0.05, 0.05 * g, "sine", 0, undefined, pos); }
    else if (/plank|log|wood|table|chest/.test(material)) { this.tone(170 * r(), 0.08, 0.1 * g, "triangle", 0, 120, pos); this.noise(0.06, 700 * r(), 1.5, 0.08 * g, "bandpass", pos); }
    else if (/glass|ice|crystal/.test(material)) this.noise(0.05, 4200 * r(), 4, 0.1 * g, "bandpass", pos);
    else if (/sand|snow|wool/.test(material)) this.noise(0.14, 3200 * r(), 0.6, 0.07 * g, "highpass", pos);
    else if (/gravel/.test(material)) { for (let i = 0; i < 3; i++) this.noise(0.04, 1600 * r(), 2, 0.09 * g, "bandpass", pos, i * 0.03); }
    else if (/leaves/.test(material)) this.noise(0.12, 2000 * r(), 0.5, 0.08 * g, "bandpass", pos);
    else { this.noise(0.09, 1100 * r(), 1, 0.12 * g, "bandpass", pos); this.noise(0.05, 3000 * r(), 1, 0.04 * g, "highpass", pos, 0.02); } // grass, dirt
  }

  private engineNodes: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; squeal: GainNode } | null = null;

  /**
   * The engine of what we drive: a low growl that climbs with speed (level 0..1; 0 = off), and
   * tyres squealing in a drift.
   */
  engine(level: number, drifting: boolean): void {
    const { ctx, bus, noiseBuf } = this;
    if (!ctx || !bus || !noiseBuf) return;
    if (!this.engineNodes) {
      if (level <= 0) return;
      const gain = ctx.createGain(); gain.gain.value = 0;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 600;
      const osc = ctx.createOscillator(); osc.type = "sawtooth";
      const osc2 = ctx.createOscillator(); osc2.type = "square";
      osc.connect(lp); osc2.connect(lp); lp.connect(gain).connect(bus);
      const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2800; bp.Q.value = 6;
      const squeal = ctx.createGain(); squeal.gain.value = 0;
      src.connect(bp).connect(squeal).connect(bus);
      osc.start(); osc2.start(); src.start();
      this.engineNodes = { osc, osc2, gain, squeal };
    }
    const t = ctx.currentTime, e = this.engineNodes;
    e.osc.frequency.setTargetAtTime(48 + level * 110, t, 0.15);
    e.osc2.frequency.setTargetAtTime(24 + level * 55, t, 0.15);
    e.gain.gain.setTargetAtTime(level > 0 ? 0.05 + level * 0.06 : 0, t, 0.2);
    e.squeal.gain.setTargetAtTime(drifting ? 0.05 : 0, t, 0.08);
  }

  /** Landing from a fall: a thud, heavier the harder you land. */
  land(material: string, speed: number): void {
    const k = Math.min(1, speed / 20);
    this.noise(0.18 + k * 0.2, 260, 0.8, 0.12 + k * 0.3, "lowpass");
    this.step(material);
  }

  private beds: { wind: GainNode; windF: BiquadFilterNode; water: GainNode; hum: GainNode } | null = null;
  private nextBird = 2;
  private nextCricket = 1;
  private nextDrip = 3;

  /**
   * The soundscape, every frame: wind, water and the cave's hum as soft loops, and now and then a
   * bird, a cricket's chirp or a drip. daylight 0..1; height is your y; storm 0..1.
   */
  ambience(dt: number, daylight: number, height: number, storm: number): void {
    const { ctx, master, noiseBuf } = this;
    if (!ctx || !master || !noiseBuf) return;
    if (!this.beds) {
      const loop = (type: BiquadFilterType, freq: number, q: number) => {
        const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
        const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
        const g = ctx.createGain(); g.gain.value = 0;
        src.connect(f).connect(g).connect(this.bus ?? master);
        src.start(0, Math.random());
        return { g, f };
      };
      const wind = loop("lowpass", 380, 0.7), water = loop("lowpass", 520, 1.2), hum = loop("lowpass", 90, 1);
      this.beds = { wind: wind.g, windF: wind.f, water: water.g, hum: hum.g };
    }
    const e = this.env, t = ctx.currentTime, tt = performance.now() / 1000;
    const open = 1 - e.enclosed;
    // Wind: gusts that come and go, more of it high up, in the open and in storms.
    const gust = 0.6 + 0.4 * Math.sin(tt * 0.31) * Math.sin(tt * 0.13 + 1);
    const high = Math.max(0, Math.min(1, (height - 70) / 50));
    this.beds.wind.gain.setTargetAtTime(open * (0.012 + high * 0.05 + storm * 0.05) * gust, t, 0.5);
    this.beds.windF.frequency.setTargetAtTime(300 + gust * 250 + storm * 300, t, 0.5);
    this.beds.water.gain.setTargetAtTime(e.water * 0.035 * (0.7 + 0.3 * Math.sin(tt * 0.9)), t, 0.4);
    this.beds.hum.gain.setTargetAtTime(e.cave * e.enclosed * 0.05, t, 1);
    const calm = storm < 0.3;
    // Birds sing in the trees by day; crickets in the grass at night; caves drip.
    this.nextBird -= dt;
    if (this.nextBird <= 0) {
      this.nextBird = 2 + Math.random() * 6;
      if (calm && daylight > 0.5 && e.trees > 0.1 && Math.random() < e.trees + 0.2) this.call("bird", 0.6 + Math.random() * 0.6, this.around(10 + Math.random() * 14, height + 4));
    }
    this.nextCricket -= dt;
    if (this.nextCricket <= 0) {
      this.nextCricket = 0.5 + Math.random() * 1.4;
      if (calm && daylight < 0.4 && e.grass > 0.15 && open > 0.4) {
        const at = this.around(6 + Math.random() * 10, height), f = 4300 + Math.random() * 500, g = 0.018 * Math.min(1, e.grass * 2) * this.gainAt(at);
        for (let i = 0; i < 3; i++) this.tone(f, 0.035, g, "sine", i * 0.06, undefined, at);
      }
    }
    this.nextDrip -= dt;
    if (this.nextDrip <= 0) {
      this.nextDrip = 1.5 + Math.random() * 4;
      if (e.cave * e.enclosed > 0.4) { const f = 900 + Math.random() * 700; this.tone(f, 0.12, 0.05, "sine", 0, f * 0.55, this.around(3 + Math.random() * 8, height + 2)); }
    }
  }

  /** A spot this far away from the listener in a random direction. */
  private around(dist: number, y: number): [number, number, number] {
    const a = Math.random() * Math.PI * 2;
    return [this.listener.x + Math.cos(a) * dist, y, this.listener.z + Math.sin(a) * dist];
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
