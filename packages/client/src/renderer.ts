import * as THREE from "three";
import { parseHex, type Standards } from "@lfg/shared";

const CHUNK_VERT = /* glsl */ `
attribute vec3 light;
varying vec2 vUv;
varying vec3 vLight;
varying float vFogDepth;
void main() {
  vUv = uv;
  vLight = light;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const CHUNK_FRAG = /* glsl */ `
uniform sampler2D atlas;
uniform float daylight;
uniform float nightVision;
uniform vec3 skyTint;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
uniform float alphaTest;
uniform float opacity;
varying vec2 vUv;
varying vec3 vLight;
varying float vFogDepth;
// Minecraft-like light curve: dim levels fall off quickly.
float curve(float l) { return l / (4.0 - 3.0 * l); }
void main() {
  vec4 tex = texture2D(atlas, vUv);
  if (tex.a < alphaTest) discard;
  float sky = curve(vLight.x) * daylight;
  float blk = curve(vLight.y);
  vec3 lightCol = max(skyTint * sky, vec3(1.0, 0.86, 0.66) * blk * 1.05);
  lightCol = max(lightCol, vec3(0.035));
  lightCol = max(lightCol, vec3(0.6, 0.66, 0.72) * nightVision);
  vec3 col = tex.rgb * lightCol * vLight.z;
  float fog = smoothstep(fogNear, fogFar, vFogDepth);
  gl_FragColor = vec4(mix(col, fogColor, fog), tex.a * opacity);
  #include <colorspace_fragment>
}`;

export interface SkyState {
  daylight: number;
  sunAngle: number;
  skyColor: THREE.Color;
  fogColor: THREE.Color;
}

/** Scene, camera and all world-space visuals that aren't chunks or entities. */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly solidMat: THREE.ShaderMaterial;
  readonly waterMat: THREE.ShaderMaterial;
  readonly atlasTexture: THREE.CanvasTexture;
  private highlight: THREE.LineSegments;
  private crack: THREE.Mesh;
  private sun: THREE.Mesh;
  private moon: THREE.Mesh;
  private clouds: THREE.Mesh;
  private stars: THREE.Points;
  private particles: { mesh: THREE.InstancedMesh; vel: Float32Array; life: Float32Array; pos: Float32Array; next: number };
  readonly ambient = new THREE.AmbientLight(0xffffff, 0.6);
  readonly sunLight = new THREE.DirectionalLight(0xffffff, 0.7);
  sky: SkyState = { daylight: 1, sunAngle: 0, skyColor: new THREE.Color(), fogColor: new THREE.Color() };
  private flash = 0;
  private cloudDrift = 0;
  private shake = 0;
  reducedMotion = false;

  constructor(canvas: HTMLCanvasElement, atlas: HTMLCanvasElement, private std: Standards) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 1000);
    this.camera.rotation.order = "YXZ";

    this.atlasTexture = new THREE.CanvasTexture(atlas);
    this.atlasTexture.magFilter = THREE.NearestFilter;
    this.atlasTexture.minFilter = THREE.NearestFilter;
    this.atlasTexture.generateMipmaps = false;
    this.atlasTexture.flipY = false;
    this.atlasTexture.colorSpace = THREE.SRGBColorSpace;

    const uniforms = () => ({
      atlas: { value: this.atlasTexture },
      daylight: { value: 1 },
      nightVision: { value: 0 },
      skyTint: { value: new THREE.Color(1, 1, 1) },
      fogColor: { value: new THREE.Color() },
      fogNear: { value: 60 },
      fogFar: { value: 120 },
      alphaTest: { value: 0.5 },
      opacity: { value: 1 },
    });
    this.solidMat = new THREE.ShaderMaterial({ vertexShader: CHUNK_VERT, fragmentShader: CHUNK_FRAG, uniforms: uniforms() });
    this.waterMat = new THREE.ShaderMaterial({
      vertexShader: CHUNK_VERT, fragmentShader: CHUNK_FRAG, uniforms: uniforms(), transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.waterMat.uniforms.alphaTest.value = 0.01;
    this.waterMat.uniforms.opacity.value = 0.85;

    this.scene.add(this.ambient, this.sunLight);

    // Block highlight and breaking overlay.
    const box = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004));
    this.highlight = new THREE.LineSegments(box, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 }));
    this.highlight.visible = false;
    this.scene.add(this.highlight);
    this.crack = new THREE.Mesh(
      new THREE.BoxGeometry(1.008, 1.008, 1.008),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.crack.visible = false;
    this.scene.add(this.crack);

    // Sun, moon, stars, clouds.
    const disc = (color: number, size: number) =>
      new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ color, fog: false, transparent: true, depthWrite: false }));
    this.sun = disc(0xfff1b8, 60);
    this.moon = disc(0xdfe6f2, 40);
    this.scene.add(this.sun, this.moon);
    const starPos: number[] = [];
    for (let i = 0; i < 900; i++) {
      const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      starPos.push(r * Math.cos(t) * 600, Math.abs(u) * 600, r * Math.sin(t) * 600);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.Float32BufferAttribute(starPos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false }));
    this.scene.add(this.stars);
    this.clouds = this.makeClouds();
    this.scene.add(this.clouds);

    // Block particles (small cubes), one instanced mesh.
    const max = 600;
    const pm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), new THREE.MeshLambertMaterial({ color: 0xffffff }), max);
    pm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    pm.frustumCulled = false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) { pm.setMatrixAt(i, zero); pm.setColorAt(i, new THREE.Color(1, 1, 1)); }
    this.scene.add(pm);
    this.particles = { mesh: pm, vel: new Float32Array(max * 3), life: new Float32Array(max), pos: new Float32Array(max * 3), next: 0 };

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  private makeClouds(): THREE.Mesh {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d")!;
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) {
        const v = Math.sin(x * 0.35) + Math.sin(y * 0.29 + x * 0.1) + Math.sin((x + y) * 0.17) + Math.random() * 0.6;
        if (v > 1.1) { ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.fillRect(x, y, 1, 1); }
      }
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 4);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = 140;
    return m;
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setViewDistance(blocks: number): void {
    for (const m of [this.solidMat, this.waterMat]) {
      m.uniforms.fogNear.value = blocks * 0.6;
      m.uniforms.fogFar.value = blocks * 0.95;
    }
    this.camera.far = blocks * 4 + 700;
    this.camera.updateProjectionMatrix();
  }

  /** Update sky colours and lighting for a time-of-day fraction (0 = sunrise, 0.25 noon, 0.75 midnight). */
  setTime(frac: number, underwater: boolean): void {
    const ang = frac * Math.PI * 2;
    const height = Math.sin(ang);
    const daylight = Math.max(0.16, Math.min(1, height * 2.2 + 0.55));
    const day = new THREE.Color(...parseHex((this.std.art.palette as Record<string, string>)[(this.std.art.materials as Record<string, string>).sky] ?? this.std.art.palette.blue4).map((v) => v / 255) as [number, number, number]).lerp(new THREE.Color(0.62, 0.8, 1), 0.5);
    const night = new THREE.Color(0.02, 0.03, 0.08);
    const sunset = new THREE.Color(0.95, 0.55, 0.32);
    const sky = night.clone().lerp(day, (daylight - 0.16) / 0.84);
    const sunsetAmt = Math.max(0, 1 - Math.abs(height) * 4);
    const fog = sky.clone().lerp(sunset, sunsetAmt * 0.45);
    if (underwater) {
      fog.setRGB(0.06, 0.18, 0.4);
      sky.copy(fog);
    }
    this.sky = { daylight, sunAngle: ang, skyColor: sky, fogColor: fog };
    this.scene.background = sky;
    const tint = new THREE.Color(1, 1, 1).lerp(new THREE.Color(1, 0.8, 0.65), sunsetAmt * 0.5);
    for (const m of [this.solidMat, this.waterMat]) {
      m.uniforms.daylight.value = daylight;
      m.uniforms.nightVision.value = this.nightVision;
      m.uniforms.fogColor.value.copy(fog);
      m.uniforms.skyTint.value.copy(tint);
    }
    if (underwater) {
      this.solidMat.uniforms.fogNear.value = 2;
      this.solidMat.uniforms.fogFar.value = 24;
    }
    // Three.js lights are physically based (no ×π legacy scaling), so Lambert surfaces need ×π
    // to match the brightness of the chunk shader.
    this.ambient.intensity = Math.PI * Math.max(0.3 + daylight * 0.45, this.nightVision * 0.6);
    this.sunLight.intensity = Math.PI * daylight * 0.45;
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - daylight * 2.2);
    (this.clouds.material as THREE.MeshBasicMaterial).color.setScalar(0.25 + daylight * 0.75);
  }

  /** Keep sky objects centred on the camera. */
  followCamera(dt: number): void {
    const p = this.camera.position;
    const a = this.sky.sunAngle;
    const r = 500;
    this.sun.position.set(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, p.z);
    this.sun.lookAt(p);
    this.moon.position.set(p.x - Math.cos(a) * r, p.y - Math.sin(a) * r, p.z);
    this.moon.lookAt(p);
    this.sunLight.position.set(Math.cos(a), Math.max(0.2, Math.sin(a)), 0.3);
    this.stars.position.copy(p);
    this.clouds.position.x = p.x;
    this.clouds.position.z = p.z;
    // The cloud plane follows the camera; shift its texture so clouds stay put in the world (and drift slowly).
    this.cloudDrift += dt * 0.004;
    const tex = (this.clouds.material as THREE.MeshBasicMaterial).map!;
    tex.offset.set((p.x / 400 + this.cloudDrift) % 1, (-p.z / 400) % 1);
  }

  setHighlight(pos: [number, number, number] | null, progress: number): void {
    this.highlight.visible = !!pos;
    this.crack.visible = !!pos && progress > 0;
    if (!pos) return;
    this.highlight.position.set(pos[0] + 0.5, pos[1] + 0.5, pos[2] + 0.5);
    this.crack.position.copy(this.highlight.position);
    (this.crack.material as THREE.MeshBasicMaterial).opacity = Math.min(0.6, progress * 0.6);
    const s = 1 - progress * 0.04;
    this.crack.scale.setScalar(s * 1.01);
  }

  burst(x: number, y: number, z: number, color: string, count = 14, speed = 3): void {
    const p = this.particles;
    const c = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const i = p.next;
      p.next = (p.next + 1) % p.life.length;
      p.pos[i * 3] = x + Math.random(); p.pos[i * 3 + 1] = y + Math.random(); p.pos[i * 3 + 2] = z + Math.random();
      p.vel[i * 3] = (Math.random() - 0.5) * speed; p.vel[i * 3 + 1] = Math.random() * speed; p.vel[i * 3 + 2] = (Math.random() - 0.5) * speed;
      p.life[i] = 0.6 + Math.random() * 0.6;
      const shade = 0.75 + Math.random() * 0.35;
      p.mesh.setColorAt(i, c.clone().multiplyScalar(shade));
    }
    if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
  }

  /** A few raindrops under a cloud (called every frame while it rains). */
  rain(x: number, y: number, z: number, w: number, d: number): void {
    const p = this.particles;
    const c = new THREE.Color(this.std.art.reserved.water);
    for (let k = 0; k < 3; k++) {
      const i = p.next;
      p.next = (p.next + 1) % p.life.length;
      p.pos[i * 3] = x + (Math.random() - 0.5) * w;
      p.pos[i * 3 + 1] = y - 0.2;
      p.pos[i * 3 + 2] = z + (Math.random() - 0.5) * d;
      p.vel[i * 3] = 0; p.vel[i * 3 + 1] = -14; p.vel[i * 3 + 2] = 0;
      p.life[i] = 1.6;
      p.mesh.setColorAt(i, c);
    }
    if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
  }

  /** 0..1: the night vision power brightens the dark. */
  nightVision = 0;

  /** A spell's visual: fire bolt (a streak in the danger colour), blink (magic at both ends), frost nova (an icy ring). */
  spellFx(spell: string, from: [number, number, number], to: [number, number, number]): void {
    let [fx, fy, fz] = from;
    const [tx, ty, tz] = to;
    if (spell === "fire_bolt") {
      // Start the streak a little in front of the caster, so it doesn't fill their own screen.
      const len = Math.hypot(tx - fx, ty - fy, tz - fz) || 1, k = Math.min(1.5, len) / len;
      fx += (tx - fx) * k; fy += (ty - fy) * k; fz += (tz - fz) * k;
      const n = Math.max(4, Math.round(Math.hypot(tx - fx, ty - fy, tz - fz) * 1.5));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        this.burst(fx + (tx - fx) * t - 0.5, fy + (ty - fy) * t - 0.5, fz + (tz - fz) * t - 0.5, i % 2 ? this.std.art.reserved.danger : "#ffc04a", 1, 0.6);
      }
      this.burst(tx - 0.5, ty - 0.5, tz - 0.5, this.std.art.reserved.danger, 10, 4);
    } else if (spell === "blink") {
      this.burst(fx - 0.5, fy - 0.5, fz - 0.5, this.std.art.reserved.magic, 14, 3);
      this.burst(tx - 0.5, ty - 0.5, tz - 0.5, this.std.art.reserved.magic, 14, 3);
    } else if (spell === "frost_nova") {
      const r = Math.hypot(tx - fx, tz - fz);
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        this.burst(fx - 0.5 + Math.cos(a) * r, fy, fz - 0.5 + Math.sin(a) * r, this.std.art.reserved.ice, 2, 2);
      }
    }
  }

  private rings: { group: THREE.Group; edge: THREE.Mesh; fill: THREE.Mesh; t: number; seconds: number; radius: number }[] = [];

  /**
   * Boss slam warning: a ring on the ground in the danger colour (step outside it), with a disc
   * that fills it as the slam winds up, so you can read the timing. Pulses at 2 Hz (under the
   * 3 Hz photosensitivity limit). On "hit", dust bursts round the ring and the camera nudges.
   */
  slam(phase: "warn" | "hit", x: number, y: number, z: number, radius: number, seconds: number, distance: number): void {
    if (phase === "hit") {
      for (const r of this.rings.splice(0)) { this.scene.remove(r.group); r.group.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } }); }
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        this.burst(x - 0.5 + Math.cos(a) * radius * 0.8, y - 0.3, z - 0.5 + Math.sin(a) * radius * 0.8, i % 2 ? "#8a7a60" : "#c4b496", 6, 5);
      }
      if (!this.reducedMotion) this.shake = Math.min(1, Math.max(this.shake, 0.5 - distance / 40));
      return;
    }
    const color = new THREE.Color(this.std.art.reserved.danger);
    // Drawn over the terrain (no depth test) so bumps and shallow water can't hide it.
    const mat = (o: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: o, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    const edge = new THREE.Mesh(new THREE.RingGeometry(radius - 0.25, radius, 48), mat(0.85));
    const fill = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), mat(0.25));
    const group = new THREE.Group();
    group.add(edge, fill);
    group.rotation.x = -Math.PI / 2;
    group.position.set(x, y + 0.1, z);
    group.renderOrder = 5;
    edge.renderOrder = fill.renderOrder = 5;
    fill.scale.setScalar(0.01);
    this.scene.add(group);
    this.rings.push({ group, edge, fill, t: 0, seconds: Math.max(0.1, seconds), radius });
  }

  private ritualRing: { id: number; group: THREE.Group; t: number } | null = null;

  /** A ritual circle on the ground in the magic colour (shown while it's open to join), or null to clear it. */
  ritual(r: { id: number; at: [number, number, number]; radius: number } | null): void {
    if (this.ritualRing && (!r || r.id !== this.ritualRing.id)) {
      this.scene.remove(this.ritualRing.group);
      this.ritualRing.group.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
      this.ritualRing = null;
    }
    if (!r || this.ritualRing) return;
    const color = new THREE.Color(this.std.art.reserved.magic);
    const mat = (o: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: o, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    const group = new THREE.Group();
    group.add(new THREE.Mesh(new THREE.RingGeometry(r.radius - 0.2, r.radius, 64), mat(0.9)));
    group.add(new THREE.Mesh(new THREE.RingGeometry(r.radius * 0.55 - 0.12, r.radius * 0.55, 6), mat(0.7)));
    group.add(new THREE.Mesh(new THREE.CircleGeometry(r.radius, 64), mat(0.12)));
    group.rotation.x = -Math.PI / 2;
    group.position.set(r.at[0], r.at[1] + 0.1, r.at[2]);
    group.renderOrder = 5;
    this.scene.add(group);
    this.ritualRing = { id: r.id, group, t: 0 };
  }

  explosion(x: number, y: number, z: number, radius: number, distance: number): void {
    for (let i = 0; i < 6; i++) this.burst(x - 0.5 + (Math.random() - 0.5) * radius, y - 0.5, z - 0.5 + (Math.random() - 0.5) * radius, i % 2 ? "#5a5550" : "#e8e2d8", 18, 9);
    // Flash and shake are capped by the comfort standards (docs/standards/ux-accessibility-and-comfort.md).
    this.flash = Math.max(this.flash, Math.max(0, 0.5 - distance / 60));
    if (!this.reducedMotion) this.shake = Math.min(1, Math.max(this.shake, 1 - distance / 40));
  }

  private tmp = new THREE.Matrix4();

  update(dt: number): void {
    const p = this.particles;
    for (let i = 0; i < p.life.length; i++) {
      if (p.life[i] <= 0) continue;
      p.life[i] -= dt;
      p.vel[i * 3 + 1] -= 18 * dt;
      p.pos[i * 3] += p.vel[i * 3] * dt; p.pos[i * 3 + 1] += p.vel[i * 3 + 1] * dt; p.pos[i * 3 + 2] += p.vel[i * 3 + 2] * dt;
      const s = p.life[i] > 0 ? Math.min(1, p.life[i] * 2) : 0;
      this.tmp.makeScale(s, s, s).setPosition(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]);
      p.mesh.setMatrixAt(i, this.tmp);
    }
    p.mesh.instanceMatrix.needsUpdate = true;
    this.flash = Math.max(0, this.flash - dt * 2);
    this.shake = Math.max(0, this.shake - dt * 1.5);
    for (const r of this.rings) {
      r.t += dt;
      r.fill.scale.setScalar(Math.min(1, r.t / r.seconds) + 0.01);
      (r.edge.material as THREE.MeshBasicMaterial).opacity = 0.65 + 0.3 * Math.sin(r.t * Math.PI * 2 * 2);
    }
    if (this.ritualRing) {
      // The inner hexagon turns slowly; magic sparks rise from the circle.
      this.ritualRing.t += dt;
      this.ritualRing.group.children[1].rotation.z = this.ritualRing.t * 0.6;
      if (Math.random() < dt * 8) {
        const a = Math.random() * Math.PI * 2, p = this.ritualRing.group.position, rad = (this.ritualRing.group.children[0] as THREE.Mesh<THREE.RingGeometry>).geometry.parameters.outerRadius;
        this.burst(p.x - 0.5 + Math.cos(a) * rad, p.y, p.z - 0.5 + Math.sin(a) * rad, this.std.art.reserved.magic, 1, 1.5);
      }
    }
    // A ring whose slam never came (the boss died mid wind-up) fades out.
    for (const r of this.rings.filter((r) => r.t > r.seconds + 1)) { this.scene.remove(r.group); this.rings.splice(this.rings.indexOf(r), 1); }
  }

  /** Camera shake offset for this frame (≤ 0.3 m, per the comfort limits). */
  shakeOffset(): [number, number, number] {
    if (this.shake <= 0) return [0, 0, 0];
    const a = Math.min(0.3, this.shake * 0.3);
    return [(Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a];
  }

  get flashAmount(): number {
    return this.flash;
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
