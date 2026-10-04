import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { AttackFx } from "@lfg/shared";

/** Particle colours for each element (a bright and a deep one). */
const ELEMENT_COLORS: Record<string, [string, string]> = {
  fire: ["#ff7a1a", "#ffd04a"], frost: ["#bfe8ff", "#ffffff"], poison: ["#7ad14a", "#c8f06a"], lightning: ["#e8f0ff", "#9ad0ff"],
  water: ["#4aa0ff", "#bfe0ff"], web: ["#f4f4f0", "#cfcfc8"], stone: ["#8a7a60", "#c4b496"], magic: ["#c070ff", "#ffd0ff"],
};
import { parseHex, type Standards } from "@lfg/shared";

// Shared by every chunk shader: the flags the mesher packs into the shade (see mesher.ts MeshData).
const UNPACK = /* glsl */ `
float flagOf(float z) { return floor(z / 2.0 + 0.001); }
`;

const CHUNK_VERT = /* glsl */ `
attribute vec3 light;
uniform float time;
uniform float wind;
varying vec2 vUv;
varying vec3 vLight;
varying vec3 vWorld;
varying float vFogDepth;
${UNPACK}
void main() {
  vUv = uv;
  float flag = flagOf(light.z);
  vLight = vec3(light.xy, light.z - flag * 2.0);
  vec4 world = modelMatrix * vec4(position, 1.0);
  // Wind: leaves rustle a little, plant tops sway; gusts roll across the land.
  if (flag > 0.5) {
    float gust = 0.6 + 0.4 * sin(time * 0.35 + world.x * 0.05 + world.z * 0.04);
    float amp = (flag > 1.5 ? 0.11 : 0.035) * wind * gust;
    world.x += sin(time * 1.9 + world.x * 0.7 + world.z * 0.3) * amp;
    world.z += cos(time * 1.6 + world.z * 0.6 + world.x * 0.2) * amp * 0.8;
    if (flag < 1.5) world.y += sin(time * 2.3 + world.x + world.z) * amp * 0.3;
  }
  vWorld = world.xyz;
  vec4 mv = viewMatrix * world;
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

// Fog takes on the sun's colour in its direction (sunrise and sunset glow through the haze).
const FOG = /* glsl */ `
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
uniform vec3 sunDir;
uniform vec3 sunGlow;
vec3 fogged(vec3 col, vec3 world, float depth) {
  vec3 dir = normalize(world - cameraPosition);
  float toward = pow(max(dot(dir, sunDir), 0.0), 6.0);
  vec3 fc = mix(fogColor, sunGlow, toward);
  return mix(col, fc, smoothstep(fogNear, fogFar, depth));
}
`;

const CHUNK_FRAG = /* glsl */ `
uniform sampler2D atlas;
uniform float daylight;
uniform float nightVision;
uniform vec3 skyTint;
uniform vec3 shadeTint;
uniform float alphaTest;
uniform float opacity;
uniform float time;
uniform float wetness;
uniform vec3 skyColor;
varying vec2 vUv;
varying vec3 vLight;
varying vec3 vWorld;
varying float vFogDepth;
${FOG}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
// Minecraft-like light curve: dim levels fall off quickly.
float curve(float l) { return l / (4.0 - 3.0 * l); }
void main() {
  vec4 tex = texture2D(atlas, vUv);
  if (tex.a < alphaTest) discard;
  float sky = curve(vLight.x) * daylight;
  float blk = curve(vLight.y);
  // Torchlight flickers a touch.
  float flicker = 1.0 + 0.035 * sin(time * 9.0 + vWorld.x * 3.1 + vWorld.z * 2.3) + 0.02 * sin(time * 23.0 + vWorld.y * 5.0);
  vec3 lightCol = max(skyTint * sky, vec3(1.0, 0.82, 0.6) * blk * 1.08 * flicker);
  lightCol = max(lightCol, vec3(0.035));
  lightCol = max(lightCol, vec3(0.6, 0.66, 0.72) * nightVision);
  // Faces turned from the sun, and corners in shadow, go a little cooler.
  vec3 shade = mix(shadeTint, vec3(1.0), smoothstep(0.55, 1.0, vLight.z)) * vLight.z;
  vec3 col = tex.rgb * lightCol * shade;
  // Wet world: in and after rain, surfaces open to the sky darken; flat tops gather puddles that
  // mirror the sky and ripple with the drops.
  float exposed = smoothstep(0.8, 1.0, vLight.x) * wetness;
  if (exposed > 0.01) {
    vec3 fn = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
    float up = smoothstep(0.7, 0.95, abs(fn.y)) * step(0.0, fn.y + 0.5);
    col *= 1.0 - 0.28 * exposed;
    float puddle = smoothstep(0.52, 0.62, noise(vWorld.xz * 0.35)) * up * exposed;
    vec2 cell = fract(vWorld.xz * 1.3) - 0.5;
    float ripple = sin(length(cell) * 38.0 - time * 7.0 - hash(floor(vWorld.xz * 1.3)) * 30.0) * 0.5 + 0.5;
    vec3 refl = skyColor * max(daylight, 0.2) * (0.85 + ripple * 0.25);
    col = mix(col, refl, puddle * 0.55);
  }
  gl_FragColor = vec4(fogged(col, vWorld, vFogDepth), tex.a * opacity);
  #include <colorspace_fragment>
}`;

// Water: gentle waves on the surface, the sky reflected at grazing angles, glints of sun and moon.
const WATER_VERT = /* glsl */ `
attribute vec3 light;
uniform float time;
varying vec2 vUv;
varying vec3 vLight;
varying vec3 vWorld;
varying float vSurface;
varying float vFogDepth;
${UNPACK}
float wave(vec2 p) { return sin(p.x * 0.9 + time * 1.3) * 0.5 + sin(p.y * 0.7 - time * 1.1) * 0.35 + sin((p.x + p.y) * 1.7 + time * 2.1) * 0.15; }
void main() {
  vUv = uv;
  float flag = flagOf(light.z);
  vLight = vec3(light.xy, light.z - flag * 2.0);
  vSurface = flag > 1.5 ? 1.0 : 0.0;
  vec4 world = modelMatrix * vec4(position, 1.0);
  if (vSurface > 0.5) world.y += wave(world.xz) * 0.045 - 0.02;
  vWorld = world.xyz;
  vec4 mv = viewMatrix * world;
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const WATER_FRAG = /* glsl */ `
uniform sampler2D atlas;
uniform float daylight;
uniform float nightVision;
uniform vec3 skyTint;
uniform float alphaTest;
uniform float opacity;
uniform float time;
uniform vec3 skyColor;
uniform vec3 horizonColor;
varying vec2 vUv;
varying vec3 vLight;
varying vec3 vWorld;
varying float vSurface;
varying float vFogDepth;
${FOG}
float curve(float l) { return l / (4.0 - 3.0 * l); }
float wave(vec2 p) { return sin(p.x * 0.9 + time * 1.3) * 0.5 + sin(p.y * 0.7 - time * 1.1) * 0.35 + sin((p.x + p.y) * 1.7 + time * 2.1) * 0.15; }
void main() {
  vec4 tex = texture2D(atlas, vUv);
  if (tex.a < alphaTest) discard;
  float sky = curve(vLight.x) * daylight;
  float blk = curve(vLight.y);
  vec3 lightCol = max(max(skyTint * sky, vec3(1.0, 0.82, 0.6) * blk), vec3(0.04));
  lightCol = max(lightCol, vec3(0.6, 0.66, 0.72) * nightVision);
  vec3 col = tex.rgb * lightCol * vLight.z;
  float alpha = tex.a * opacity;
  if (vSurface > 0.5) {
    // A normal from the waves' slope, for the reflection and the glint.
    float e = 0.15;
    vec3 n = normalize(vec3(wave(vWorld.xz - vec2(e, 0.0)) - wave(vWorld.xz + vec2(e, 0.0)), 6.0, wave(vWorld.xz - vec2(0.0, e)) - wave(vWorld.xz + vec2(0.0, e))));
    vec3 view = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - max(dot(view, n), 0.0), 3.0);
    vec3 refl = mix(horizonColor, skyColor, clamp(reflect(-view, n).y * 2.0, 0.0, 1.0));
    col = mix(col, refl * max(sky, 0.15), fres * 0.65 * smoothstep(0.2, 0.8, vLight.x));
    float glint = pow(max(dot(reflect(-sunDir, n), view), 0.0), 120.0);
    col += sunGlow * glint * 1.6 * smoothstep(0.3, 0.9, vLight.x);
    alpha = mix(alpha, 0.97, fres * 0.8);
  }
  gl_FragColor = vec4(fogged(col, vWorld, vFogDepth), alpha);
  #include <colorspace_fragment>
}`;

// The sky: a dome from horizon to zenith, warmer near the sun at sunrise and sunset, with the sun's glow.
const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const SKY_FRAG = /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 sunDir;
uniform vec3 sunGlow;
uniform float sunset;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec3 col = mix(horizon, zenith, pow(h, 0.55));
  float toward = max(dot(d, sunDir), 0.0);
  // The low sky glows towards the sun at sunrise and sunset; a halo round the sun all day.
  col = mix(col, sunGlow, sunset * pow(toward, 3.0) * (1.0 - h * 0.7));
  col += sunGlow * pow(toward, 48.0) * 0.6;
  // Below the horizon fades to the fog colour.
  col = mix(col, horizon * 0.9, smoothstep(0.0, -0.15, d.y));
  gl_FragColor = vec4(col, 1.0);
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
  private skyMat!: THREE.ShaderMaterial;
  private skyDome!: THREE.Mesh;
  private fireflies!: THREE.Points;
  private fireflyData: { x: number; y: number; z: number; phase: number; vx: number; vz: number }[] = [];
  /** The ground under a point, for ambient life (set by the game). */
  groundAt: ((x: number, z: number) => { y: number; grassy: boolean } | null) | null = null;
  /** 0 = still, 1 = a breeze, 2+ = a storm (weather sets it). */
  wind = 1;
  private elapsed = 0;
  private wetness = 0;
  /** Weather: how wet and how stormy it is now (eased towards the target, so it rolls in). */
  private weather = { kind: "clear" as "clear" | "rain" | "thunder", wet: 0, storm: 0 };
  private precip!: THREE.LineSegments;
  private snow!: THREE.Points;
  private drops = new Float32Array(0);
  private bolt: THREE.Line | null = null;
  private boltLife = 0;
  /** Is this column snowy (cold biome) and where's its roof, for rain and snow (set by the game). */
  columnAt: ((x: number, z: number) => { top: number; cold: boolean } | null) | null = null;
  private particles: { mesh: THREE.InstancedMesh; vel: Float32Array; life: Float32Array; pos: Float32Array; next: number };
  readonly ambient = new THREE.AmbientLight(0xffffff, 0.6);
  /** Sky above, ground below: creatures get shape from soft directional fill instead of flat ambient. */
  readonly hemi = new THREE.HemisphereLight(0xdfeeff, 0x6b5a3a, 1);
  /** A rim light from behind and above, so silhouettes separate from the background. */
  readonly rim = new THREE.DirectionalLight(0xfff2dc, 1);
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
      time: { value: 0 },
      wind: { value: 1 },
      shadeTint: { value: new THREE.Color(0.86, 0.92, 1.06) },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunGlow: { value: new THREE.Color(1, 0.9, 0.7) },
      skyColor: { value: new THREE.Color() },
      horizonColor: { value: new THREE.Color() },
      wetness: { value: 0 },
    });
    this.solidMat = new THREE.ShaderMaterial({ vertexShader: CHUNK_VERT, fragmentShader: CHUNK_FRAG, uniforms: uniforms() });
    this.waterMat = new THREE.ShaderMaterial({
      vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, uniforms: uniforms(), transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    // The sky dome, drawn behind everything.
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false,
      uniforms: { zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunGlow: { value: new THREE.Color() }, sunset: { value: 0 } },
    });
    this.skyDome = new THREE.Mesh(new THREE.SphereGeometry(800, 32, 16), this.skyMat);
    this.skyDome.renderOrder = -10;
    this.skyDome.frustumCulled = false;
    this.scene.add(this.skyDome);
    this.waterMat.uniforms.alphaTest.value = 0.01;
    this.waterMat.uniforms.opacity.value = 0.85;

    this.rim.position.set(-0.5, 0.8, -1);
    this.scene.add(this.ambient, this.hemi, this.rim, this.sunLight);

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
    this.composer?.setSize(w, h);
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
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
    const daylight = Math.max(0.16, Math.min(1, height * 2.2 + 0.55)) * (1 - this.weather.wet * 0.25 - this.weather.storm * 0.15) + this.flash * 0.8;
    const day = new THREE.Color(...parseHex((this.std.art.palette as Record<string, string>)[(this.std.art.materials as Record<string, string>).sky] ?? this.std.art.palette.blue4).map((v) => v / 255) as [number, number, number]).lerp(new THREE.Color(0.62, 0.8, 1), 0.5);
    const night = new THREE.Color(0.02, 0.03, 0.08);
    const sunset = new THREE.Color(0.95, 0.55, 0.32);
    const sky = night.clone().lerp(day, (daylight - 0.16) / 0.84);
    // Rain greys the sky and dims the day; a storm more so.
    const overcast = this.weather.wet * 0.55 + this.weather.storm * 0.25;
    sky.lerp(new THREE.Color(0.42, 0.46, 0.52).multiplyScalar(0.3 + daylight * 0.7), overcast);
    const sunsetAmt = Math.max(0, 1 - Math.abs(height) * 4);
    const fog = sky.clone().lerp(sunset, sunsetAmt * 0.45);
    if (underwater) {
      fog.setRGB(0.06, 0.18, 0.4);
      sky.copy(fog);
    }
    this.sky = { daylight, sunAngle: ang, skyColor: sky, fogColor: fog };
    this.scene.background = sky;
    // The dome: a deeper zenith over a paler horizon, glowing towards the sun when it's low.
    const zenith = sky.clone().multiplyScalar(0.78).lerp(new THREE.Color(0.18, 0.35, 0.75), 0.25 * daylight);
    const horizon = sky.clone().lerp(new THREE.Color(1, 1, 1), 0.28 * daylight).lerp(sunset, sunsetAmt * 0.35);
    const glow = new THREE.Color(1, 0.93, 0.78).lerp(new THREE.Color(1, 0.55, 0.25), sunsetAmt);
    if (height < -0.15) glow.multiplyScalar(0.25); // night: only a faint moonlit haze
    const sunDir = new THREE.Vector3(Math.cos(ang), Math.sin(ang), 0.3).normalize();
    this.skyMat.uniforms.zenith.value.copy(underwater ? fog : zenith);
    this.skyMat.uniforms.horizon.value.copy(underwater ? fog : horizon);
    this.skyMat.uniforms.sunDir.value.copy(sunDir);
    this.skyMat.uniforms.sunGlow.value.copy(glow);
    this.skyMat.uniforms.sunset.value = underwater ? 0 : sunsetAmt;
    this.skyDome.visible = !underwater;
    // Sunlight warms at golden hour; at night the sky's light is a cool moonlit blue.
    const tint = new THREE.Color(1, 1, 1).lerp(new THREE.Color(1, 0.8, 0.62), sunsetAmt * 0.6);
    if (height < 0) tint.lerp(new THREE.Color(0.62, 0.74, 1.12), Math.min(1, -height * 3));
    for (const m of [this.solidMat, this.waterMat]) {
      m.uniforms.daylight.value = daylight;
      m.uniforms.nightVision.value = this.nightVision;
      m.uniforms.fogColor.value.copy(fog);
      m.uniforms.skyTint.value.copy(tint);
      m.uniforms.sunDir.value.copy(height > -0.15 ? sunDir : sunDir.clone().negate());
      m.uniforms.sunGlow.value.copy(underwater ? fog : fog.clone().lerp(glow, height > -0.15 ? 0.55 : 0.1));
      m.uniforms.skyColor.value.copy(zenith);
      m.uniforms.horizonColor.value.copy(horizon);
      // Shade goes cool by day, neutral at night.
      m.uniforms.shadeTint.value.setRGB(1, 1, 1).lerp(new THREE.Color(0.84, 0.91, 1.08), daylight);
    }
    if (underwater) {
      this.solidMat.uniforms.fogNear.value = 2;
      this.solidMat.uniforms.fogFar.value = 24;
    }
    // Three.js lights are physically based (no ×π legacy scaling), so Lambert surfaces need ×π
    // to match the brightness of the chunk shader.
    // Fill = flat ambient + sky/ground hemisphere (the same total as before at noon, but with direction).
    const fill = Math.max(0.3 + daylight * 0.45, this.nightVision * 0.6);
    this.ambient.intensity = Math.PI * fill * 0.3;
    this.hemi.intensity = Math.PI * fill * 0.8;
    this.sunLight.intensity = Math.PI * daylight * 0.55;
    this.rim.intensity = Math.PI * (0.12 + daylight * 0.18);
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - daylight * 2.2) * (1 - this.weather.wet);
    // Clouds catch the sunset, and go dark and cool at night.
    const cloud = new THREE.Color(0.1, 0.12, 0.2).lerp(new THREE.Color(1, 1, 1), Math.max(0, (daylight - 0.16) / 0.84)).lerp(new THREE.Color(1, 0.62, 0.42), sunsetAmt * 0.7);
    (this.clouds.material as THREE.MeshBasicMaterial).color.copy(cloud);
    // A warmer, bigger sun near the horizon.
    (this.sun.material as THREE.MeshBasicMaterial).color.setRGB(1, 0.95, 0.72).lerp(new THREE.Color(1, 0.55, 0.25), sunsetAmt);
    this.sun.scale.setScalar(1 + sunsetAmt * 0.6);
  }

  /** The weather changed: it eases in over a few seconds. */
  setWeather(kind: "clear" | "rain" | "thunder"): void { this.weather.kind = kind; }

  /**
   * Rain (streaks) or snow (flakes) in a box around the camera, each drop stopping at its column's
   * roof, so it doesn't rain indoors or under trees.
   */
  private updatePrecipitation(dt: number): void {
    const N = 1400;
    if (!this.precip) {
      this.drops = new Float32Array(N * 4); // x, y, z, speed
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(N * 6), 3));
      this.precip = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xaec4dc, transparent: true, opacity: 0.45, depthWrite: false }));
      this.precip.frustumCulled = false;
      const sg = new THREE.BufferGeometry();
      sg.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3));
      this.snow = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.85, depthWrite: false }));
      this.snow.frustumCulled = false;
      this.scene.add(this.precip, this.snow);
      for (let i = 0; i < N; i++) this.drops[i * 4 + 1] = -1e4;
    }
    const w = this.weather;
    const target = w.kind === "clear" ? 0 : 1;
    w.wet += (target - w.wet) * Math.min(1, dt * 0.25);
    // The ground soaks up over half a minute of rain and dries over a couple of minutes after.
    this.wetness = Math.max(0, Math.min(1, this.wetness + (w.kind === "clear" ? -dt / 120 : dt / 30)));
    for (const m of [this.solidMat, this.waterMat]) m.uniforms.wetness.value = this.wetness;
    w.storm += ((w.kind === "thunder" ? 1 : 0) - w.storm) * Math.min(1, dt * 0.25);
    this.wind = 1 + w.wet * 0.8 + w.storm * 1.2;
    const active = Math.floor(N * w.wet);
    const cam = this.camera.position;
    const rp = this.precip.geometry.getAttribute("position") as THREE.BufferAttribute;
    const sp = this.snow.geometry.getAttribute("position") as THREE.BufferAttribute;
    const lean = 0.15 + w.storm * 0.35;
    // One roof lookup per column this frame (drops share columns).
    const roofs = new Map<number, { top: number; cold: boolean } | null>();
    const columnOf = (x: number, z: number) => {
      const k = Math.floor(x) * 4096 + Math.floor(z);
      if (!roofs.has(k)) roofs.set(k, this.columnAt?.(x, z) ?? null);
      return roofs.get(k)!;
    };
    for (let i = 0; i < N; i++) {
      const o = i * 4;
      let x = this.drops[o], y = this.drops[o + 1], z = this.drops[o + 2];
      const col = active > 0 ? columnOf(x, z) : null;
      const cold = !!col?.cold;
      const floor = col ? col.top : -1e3;
      if (i >= active || y < floor || Math.abs(x - cam.x) > 22 || Math.abs(z - cam.z) > 22 || y < cam.y - 20) {
        if (i >= active) { rp.setXYZ(i * 2, 0, -1e4, 0); rp.setXYZ(i * 2 + 1, 0, -1e4, 0); sp.setXYZ(i, 0, -1e4, 0); this.drops[o + 1] = -1e4; continue; }
        x = cam.x + (Math.random() - 0.5) * 44; z = cam.z + (Math.random() - 0.5) * 44; y = cam.y + 8 + Math.random() * 16;
        this.drops[o + 3] = 0.7 + Math.random() * 0.6;
      }
      const speed = this.drops[o + 3];
      if (cold) {
        y -= dt * 1.6 * speed; x += Math.sin(this.elapsed * 0.8 + i) * dt * 0.5; z += Math.cos(this.elapsed * 0.6 + i * 1.3) * dt * 0.5;
        sp.setXYZ(i, x, y, z); rp.setXYZ(i * 2, 0, -1e4, 0); rp.setXYZ(i * 2 + 1, 0, -1e4, 0);
      } else {
        y -= dt * 22 * speed; x += dt * 22 * speed * lean;
        rp.setXYZ(i * 2, x, y, z); rp.setXYZ(i * 2 + 1, x - lean * 0.6, y + 0.6, z); sp.setXYZ(i, 0, -1e4, 0);
      }
      this.drops[o] = x; this.drops[o + 1] = y; this.drops[o + 2] = z;
    }
    rp.needsUpdate = true; sp.needsUpdate = true;
    this.precip.visible = this.snow.visible = active > 0;
    // A lightning bolt lingers a moment.
    if (this.bolt) { this.boltLife -= dt; if (this.boltLife <= 0) { this.scene.remove(this.bolt); this.bolt.geometry.dispose(); this.bolt = null; } }
  }

  /**
   * Lightning: "warn" shows the ring it will strike inside, crackling (step out of it); "hit" is
   * the bolt, a flash of the sky, and the ring bursting.
   */
  lightning(phase: "warn" | "hit", x: number, y: number, z: number, radius: number, seconds: number, distance: number): void {
    if (phase === "warn") { this.slam("warn", x, y, z, radius, seconds, distance); for (let i = 0; i < 6; i++) setTimeout(() => this.burst(x - 0.5 + (Math.random() - 0.5) * radius, y, z - 0.5 + (Math.random() - 0.5) * radius, "#cfe2ff", 2, 2), i * 200); return; }
    const pts: THREE.Vector3[] = [];
    let px = x, pz = z;
    for (let h = y + 70; h > y; h -= 4 + Math.random() * 4) { pts.push(new THREE.Vector3(px, h, pz)); px += (Math.random() - 0.5) * 3; pz += (Math.random() - 0.5) * 3; }
    pts.push(new THREE.Vector3(x, y, z));
    if (this.bolt) { this.scene.remove(this.bolt); this.bolt.geometry.dispose(); }
    this.bolt = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xf2f6ff, fog: false }));
    this.scene.add(this.bolt);
    this.boltLife = 0.25;
    this.flash = Math.max(this.flash, Math.max(0.25, 1 - distance / 120));
    this.slam("hit", x, y, z, radius, 0, distance);
    for (let i = 0; i < 4; i++) this.burst(x - 0.5, y, z - 0.5, i % 2 ? "#ffffff" : "#bcd4ff", 6, 5);
  }

  /** Keep sky objects centred on the camera. */
  followCamera(dt: number): void {
    const p = this.camera.position;
    this.elapsed += dt;
    for (const m of [this.solidMat, this.waterMat]) {
      m.uniforms.time.value = this.reducedMotion ? 0 : this.elapsed;
      m.uniforms.wind.value = this.reducedMotion ? 0 : this.wind;
    }
    this.skyDome.position.copy(p);
    this.updateFireflies(dt);
    this.updatePrecipitation(dt);
    // Stars twinkle (gently: a slow shimmer, not a flash).
    if (!this.reducedMotion) (this.stars.material as THREE.PointsMaterial).size = 1.6 + Math.sin(this.elapsed * 1.7) * 0.25;
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

  /**
   * Fireflies on summer nights: a few dozen soft lights drifting over the grass near you, blinking
   * slowly. They fade in at dusk and out at dawn.
   */
  private updateFireflies(dt: number): void {
    if (!this.fireflies) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(48 * 3), 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(48 * 3), 3));
      const c = document.createElement("canvas");
      c.width = c.height = 32;
      const x = c.getContext("2d")!;
      const grad = x.createRadialGradient(16, 16, 0, 16, 16, 16);
      grad.addColorStop(0, "rgba(255,255,220,1)"); grad.addColorStop(0.25, "rgba(220,255,140,0.8)"); grad.addColorStop(1, "rgba(160,255,80,0)");
      x.fillStyle = grad; x.fillRect(0, 0, 32, 32);
      this.fireflies = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.35, map: new THREE.CanvasTexture(c), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      this.fireflies.frustumCulled = false;
      this.scene.add(this.fireflies);
    }
    // Fireflies stay in when it rains.
    const night = Math.max(0, Math.min(1, (0.55 - this.sky.daylight) * 4)) * (1 - this.weather.wet);
    this.fireflies.visible = night > 0.01 && !!this.groundAt;
    if (!this.fireflies.visible) { this.fireflyData = []; return; }
    const cam = this.camera.position;
    const pos = this.fireflies.geometry.getAttribute("position") as THREE.BufferAttribute;
    const col = this.fireflies.geometry.getAttribute("color") as THREE.BufferAttribute;
    for (let i = 0; i < 48; i++) {
      let f = this.fireflyData[i];
      if (!f || Math.hypot(f.x - cam.x, f.z - cam.z) > 26) {
        // A new one over grass somewhere around you (or none, if there's no grass there).
        const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 20;
        const x = cam.x + Math.cos(a) * r, z = cam.z + Math.sin(a) * r;
        const ground = this.groundAt!(x, z);
        f = this.fireflyData[i] = ground?.grassy ? { x, y: ground.y + 0.6 + Math.random() * 1.8, z, phase: Math.random() * 10, vx: 0, vz: 0 } : { x, y: -999, z, phase: 0, vx: 0, vz: 0 };
      }
      f.vx += (Math.random() - 0.5) * dt * 1.5; f.vz += (Math.random() - 0.5) * dt * 1.5;
      f.vx *= 0.98; f.vz *= 0.98;
      f.x += f.vx * dt; f.z += f.vz * dt; f.y += Math.sin(this.elapsed * 0.9 + f.phase) * dt * 0.15;
      pos.setXYZ(i, f.x, f.y, f.z);
      const blink = Math.max(0, Math.sin(this.elapsed * 1.3 + f.phase * 3)) ** 3 * night;
      col.setXYZ(i, blink * 0.9, blink, blink * 0.5);
    }
    pos.needsUpdate = true; col.needsUpdate = true;
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

  /**
   * A summon's attack: the warning (sparks gathering at its mouth, dust pawed up, the stomp ring),
   * then the attack itself (a breath cone streaming for its duration, a shot flying its line at
   * the speed it travels on the server, a charge's dust trail, a stomp's shockwave).
   */
  attackFx(fx: AttackFx, distance: number): void {
    const [c1, c2] = ELEMENT_COLORS[fx.element] ?? ELEMENT_COLORS.fire;
    const [fx0, fy0, fz0] = fx.from, [tx, ty, tz] = fx.to;
    const later = (ms: number, f: () => void) => setTimeout(f, ms);
    if (fx.kind === "stomp") { this.slam(fx.phase === "hit" ? "hit" : "warn", fx0, fy0, fz0, fx.radius ?? 3, fx.seconds, distance); return; }
    if (fx.phase === "warn") {
      if (fx.kind === "charge") for (let i = 0; i < 4; i++) later(i * 200, () => this.burst(fx0 - 0.5, fy0 - 0.4, fz0 - 0.5, i % 2 ? "#8a7a60" : "#c4b496", 4, 2));
      else for (let i = 0; i < 5; i++) later(i * (fx.seconds * 180), () => this.burst(fx0 - 0.5, fy0 - 0.5, fz0 - 0.5, i % 2 ? c1 : c2, 3, 0.8));
      return;
    }
    if (fx.phase === "end") { for (let i = 0; i < 6; i++) later(i * 250, () => this.burst(fx0 - 0.5, fy0 + 1.2, fz0 - 0.5, "#fff4b0", 2, 1)); return; }
    const dx = tx - fx0, dy = ty - fy0, dz = tz - fz0;
    if (fx.kind === "breath") {
      // A widening cone, streaming for the breath's duration.
      const steps = Math.round(fx.seconds * 14);
      for (let i = 0; i < steps; i++) later(i * 70, () => {
        for (let j = 0; j < 6; j++) {
          const t = Math.random(), spread = t * 0.5;
          const ox = (Math.random() - 0.5) * 2 * spread * Math.hypot(dx, dz), oy = (Math.random() - 0.5) * spread * 3;
          const px = -dz / (Math.hypot(dx, dz) || 1), pz = dx / (Math.hypot(dx, dz) || 1);
          this.burst(fx0 + dx * t + px * ox * 0.5 - 0.5, fy0 + dy * t + oy - 0.5, fz0 + dz * t + pz * ox * 0.5 - 0.5, (i + j) % 3 ? c1 : c2, 1, 1.2);
        }
      });
    } else if (fx.kind === "shot") {
      const n = Math.max(6, Math.round(fx.seconds * 30));
      for (let i = 0; i <= n; i++) later((i / n) * fx.seconds * 1000, () => {
        const t = i / n;
        this.burst(fx0 + dx * t - 0.5, fy0 + dy * t - 0.5, fz0 + dz * t - 0.5, i % 2 ? c1 : c2, 2, 0.4);
      });
    } else if (fx.kind === "charge") {
      const n = Math.max(4, Math.round(fx.seconds * 10));
      for (let i = 0; i < n; i++) later((i / n) * fx.seconds * 1000, () => {
        const t = (i / n) * Math.min(1, fx.seconds * 9 / (Math.hypot(dx, dz) || 1));
        this.burst(fx0 + dx * t - 0.5, fy0 - 0.4, fz0 + dz * t - 0.5, i % 2 ? "#8a7a60" : "#c4b496", 4, 2.5);
      });
      if (!this.reducedMotion) this.shake = Math.min(1, Math.max(this.shake, 0.25 - distance / 60));
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

  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;

  /**
   * Glow effects: the scene renders to a high-range target, bright things (the sun, lightning,
   * lanterns, glowing eyes and spells) bloom softly, and tone mapping rolls off highlights instead of
   * clipping them. Off: the plain render.
   */
  setEffects(on: boolean): void {
    if (on && !this.composer) {
      const size = this.renderer.getSize(new THREE.Vector2());
      const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType });
      this.composer = new EffectComposer(this.renderer, target);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.32, 0.45, 0.82);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
      this.renderer.toneMapping = THREE.NeutralToneMapping;
      this.renderer.toneMappingExposure = 1.04;
      this.resize();
    } else if (!on && this.composer) {
      this.composer.dispose();
      this.composer = null;
      this.bloom = null;
      this.renderer.toneMapping = THREE.NoToneMapping;
    }
  }

  render(): void {
    // Night and storms bloom a little more (lanterns and lightning stand out).
    if (this.bloom) this.bloom.strength = 0.28 + (1 - this.sky.daylight) * 0.25 + this.flash * 0.4;
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
