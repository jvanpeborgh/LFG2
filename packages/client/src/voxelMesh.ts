import * as THREE from "three";
import { FINISHES, meshModel, type MeshData, type ModelStyle, type VoxelModel } from "@lfg/shared";

/** Materials that can be tinted (hurt flash, warning pulse): all of them have an emissive colour. */
export type LitMaterial = THREE.MeshLambertMaterial | THREE.MeshPhongMaterial | THREE.MeshStandardMaterial;

export interface VoxelObject {
  root: THREE.Group;
  /** Pivot groups by animation role. */
  parts: Map<string, THREE.Group[]>;
  materials: LitMaterial[];
  /** Per-part textures (the voxel style's occlusion grids), to dispose with the object. */
  textures?: THREE.Texture[];
  /** Secondary motion: springs that make ears, tails and heads swing with turns and stops. */
  motion?: Motion;
}

/** A damped spring: where it is, how fast it's moving. */
interface Spring { x: number; v: number }
interface Motion {
  t: number; x: number; y: number; z: number; yaw: number;
  /** Smoothed turn rate (rad/s), forward speed, and forward and vertical acceleration. */
  turn: number; speed: number; vy: number; accel: number; ay: number;
  /** How far it has rolled along its facing (wheels spin by this). */
  roll: number;
  tail: Spring; tailUp: Spring; ears: Spring; head: Spring; lean: Spring;
}

/** Step a spring towards `target`: stiff enough to follow, loose enough to overshoot a little. */
function spring(s: Spring, target: number, dt: number, k = 70, damp = 9): number {
  for (let left = dt; left > 1e-6; left -= 1 / 120) {
    const h = Math.min(left, 1 / 120);
    s.v += (k * (target - s.x) - damp * s.v) * h;
    s.x += s.v * h;
  }
  return s.x;
}

export interface BuildOptions {
  /** The close-up version may use this many times the budget, shown within `closeUpBlocks` of the camera. */
  closeUpMultiplier?: number;
  closeUpBlocks?: number;
  /** The skin's micro-detail in the smooth styles (default hide). */
  surface?: "fur" | "hide" | "scales" | "cloth" | "smooth";
}

const tmp = new THREE.Color();

/** Geometry for one detail level: a geometry per part, with a group per finish. */
type Level = THREE.BufferGeometry[];
/** Meshing is the slow part, and every creature of a type looks the same: share geometry per model and style. */
const cache = new WeakMap<VoxelModel, Map<string, { far: Level; near?: Level; farScale: number; halos: MeshData[] }>>();

function toGeometry(m: MeshData): THREE.BufferGeometry {
  const colors = new Float32Array(m.colors.length);
  for (let i = 0; i < m.colors.length; i += 3) {
    // Palette colours are sRGB; Three.js wants linear vertex colours.
    tmp.setRGB(m.colors[i], m.colors[i + 1], m.colors[i + 2], THREE.SRGBColorSpace);
    colors[i] = tmp.r; colors[i + 1] = tmp.g; colors[i + 2] = tmp.b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  // Triangles sorted by finish, one draw group (material) per finish.
  const n = m.indices.length / 3;
  const order = [...Array(n).keys()];
  if (m.finishes) order.sort((a, b) => m.finishes![a] - m.finishes![b]);
  const idx = new Uint32Array(m.indices.length);
  order.forEach((t, i) => { idx[i * 3] = m.indices[t * 3]; idx[i * 3 + 1] = m.indices[t * 3 + 1]; idx[i * 3 + 2] = m.indices[t * 3 + 2]; });
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  let start = 0;
  for (let f = 0; f < FINISHES.length; f++) {
    let count = 0;
    while (start + count < n && (m.finishes?.[order[start + count]] ?? 0) === f) count++;
    if (count) g.addGroup(start * 3, count * 3, f);
    start += count;
  }
  g.computeBoundingSphere();
  g.userData.shared = true;
  return g;
}

/** Image-based lighting for gloss and metal (set once the renderer exists; see setEnvironment). */
let envMap: THREE.Texture | null = null;
/** How strongly glow halos show: strong at night, faint by day (see setGlowStrength). */
let glowStrength = 0.35;

/** Give gloss and metal finishes something to reflect: a prefiltered environment from the renderer. */
export function setEnvironment(renderer: THREE.WebGLRenderer, scene: () => THREE.Scene): void {
  const pmrem = new THREE.PMREMGenerator(renderer);
  envMap = pmrem.fromScene(scene(), 0.04).texture;
  pmrem.dispose();
}

/** 0..1: glow halos fade in as it gets dark. */
export function setGlowStrength(v: number): void {
  glowStrength = Math.max(0, Math.min(1, v));
}

/** One material per finish: matte, gloss, metal, glow (lit from within: its colour is added as light). */
/**
 * Surface micro-detail for the smooth styles: a small 3D noise, measured in blocks, bends the
 * normals (screen-space bump mapping, as three's bump maps do), so a body reads as fur, hide or
 * skin under the light instead of smooth plastic. Colours are untouched; glow and metal stay clean.
 */
const DETAIL_GLSL = /* glsl */ `
varying vec3 vDetailPos;
uniform float uDetailScale;
uniform float uDetailStrength;
float dHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float dNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dHash(i), dHash(i + vec3(1, 0, 0)), f.x), mix(dHash(i + vec3(0, 1, 0)), dHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(dHash(i + vec3(0, 0, 1)), dHash(i + vec3(1, 0, 1)), f.x), mix(dHash(i + vec3(0, 1, 1)), dHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
uniform float uDetailCells;
float dCells(vec3 x) {
  // Worley cells: raised plates with grooves between (scales).
  vec3 i = floor(x), f = fract(x);
  float d1 = 8.0, d2 = 8.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int k = -1; k <= 1; k++) {
    vec3 g = vec3(float(k), float(y), float(z));
    vec3 o = vec3(dHash(i + g), dHash(i + g + 7.1), dHash(i + g + 13.3));
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return smoothstep(0.0, 0.25, d2 - d1);
}
float dHeight(vec3 p) { return uDetailCells > 0.5 ? dCells(p) : dNoise(p) * 0.65 + dNoise(p * 2.7 + 11.0) * 0.35; }
`;

const SURFACE_DETAIL = {
  fur: { scale: 22, strength: 0.035, cells: 0 },
  hide: { scale: 12, strength: 0.014, cells: 0 },
  scales: { scale: 9, strength: 0.03, cells: 1 },
  cloth: { scale: 30, strength: 0.01, cells: 0 },
} as const;

function withDetail(m: THREE.Material, vs: number, surface: keyof typeof SURFACE_DETAIL, k: number, key: string): void {
  const d = SURFACE_DETAIL[surface];
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uDetailScale = { value: vs * d.scale };
    sh.uniforms.uDetailStrength = { value: d.strength * k };
    sh.uniforms.uDetailCells = { value: d.cells };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vDetailPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvDetailPos = position;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\n${DETAIL_GLSL}`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
      {
        float hgt = dHeight(vDetailPos * uDetailScale) * uDetailStrength;
        vec3 sp = -vViewPosition;
        vec3 dpx = dFdx(sp), dpy = dFdy(sp);
        vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
        float det = dot(dpx, r1);
        vec3 grad = sign(det) * (dFdx(hgt) * r1 + dFdy(hgt) * r2);
        normal = normalize(abs(det) * normal - grad);
      }`);
  };
  m.customProgramCacheKey = () => key;
}

/**
 * The voxel style's shading, in the shader so greedy meshing stays cheap: ambient occlusion from
 * the part's own voxels (each part's grid is a small 3D texture; a face darkens where neighbours
 * crowd its corners, smoothly across it), and a slight brightness jitter per voxel, the
 * hand-painted variation of voxel art.
 */
const VOXEL_GLSL = /* glsl */ `
varying vec3 vVoxPos;
varying vec3 vVoxNor;
uniform highp sampler3D uOcc;
uniform vec3 uDims;
uniform float uJitter;
float vHash(vec3 p) { p = fract(p * 0.3183099 + 0.17); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vOcc(vec3 c) {
  if (any(lessThan(c, vec3(0.0))) || any(greaterThanEqual(c, uDims))) return 0.0;
  return texture(uOcc, (c + 0.5) / uDims).r > 0.5 ? 1.0 : 0.0;
}
float vAO(float a, float b, float c) { return a + b > 1.5 ? 0.0 : (3.0 - (a + b + c)) / 3.0; }
`;

let emptyOcc: THREE.Data3DTexture | null = null;
function occTexture(g: VoxelModel["parts"][number]["grid"]): THREE.Data3DTexture {
  const data = new Uint8Array(g.w * g.h * g.d);
  for (let z = 0; z < g.d; z++) for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.get(x, y, z)) data[x + y * g.w + z * g.w * g.h] = 255;
  const t = new THREE.Data3DTexture(data, g.w, g.h, g.d);
  t.format = THREE.RedFormat; t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

function withVoxelShading(m: THREE.Material, key: string): void {
  if (!emptyOcc) { emptyOcc = new THREE.Data3DTexture(new Uint8Array(1), 1, 1, 1); emptyOcc.format = THREE.RedFormat; emptyOcc.needsUpdate = true; }
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uOcc = { value: emptyOcc };
    sh.uniforms.uDims = { value: new THREE.Vector3(1, 1, 1) };
    sh.uniforms.uJitter = { value: 0.2 };
    m.userData.shader = sh;
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vVoxPos;\nvarying vec3 vVoxNor;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvVoxPos = position; vVoxNor = normal;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\n${VOXEL_GLSL}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
      {
        vec3 N = normalize(vVoxNor);
        vec3 cell = floor(vVoxPos - N * 0.5);
        diffuseColor.rgb *= 1.0 - uJitter * 0.5 + uJitter * vHash(cell);
        vec3 a = abs(N);
        vec3 U = a.x > 0.5 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
        vec3 V = a.z > 0.5 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
        vec3 o = cell + N;
        float fu = clamp(dot(vVoxPos - cell, U), 0.0, 1.0), fv = clamp(dot(vVoxPos - cell, V), 0.0, 1.0);
        float su0 = vOcc(o - U), su1 = vOcc(o + U), sv0 = vOcc(o - V), sv1 = vOcc(o + V);
        float a00 = vAO(su0, sv0, vOcc(o - U - V)), a10 = vAO(su1, sv0, vOcc(o + U - V));
        float a01 = vAO(su0, sv1, vOcc(o - U + V)), a11 = vAO(su1, sv1, vOcc(o + U + V));
        float ao = mix(mix(a00, a10, fu), mix(a01, a11, fu), fv);
        diffuseColor.rgb *= mix(0.5, 1.0, ao);
      }`);
  };
  m.customProgramCacheKey = () => key;
}

function finishMaterials(style: ModelStyle, vs = 0.0625, surface: BuildOptions["surface"] = "hide"): LitMaterial[] {
  const flatShading = style === "lowpoly";
  const glow = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading });
  glow.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace("vec3 totalEmissiveRadiance = emissive;", "vec3 totalEmissiveRadiance = emissive + vColor.rgb * 0.85;");
  };
  glow.customProgramCacheKey = () => "finish-glow";
  const matte = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading });
  const gloss = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading, roughness: 0.38, metalness: 0, envMap, envMapIntensity: 0.75 });
  const metal = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading, roughness: 0.42, metalness: 0.85, envMap, envMapIntensity: 0.8 });
  if ((style === "sculpted" || style === "smooth") && surface !== "smooth") { withDetail(matte, vs, surface, 1, "detail-matte"); withDetail(gloss, vs, surface, 0.5, "detail-gloss"); }
  if (style === "voxel") { withVoxelShading(matte, "voxel-matte"); withVoxelShading(gloss, "voxel-gloss"); withVoxelShading(metal, "voxel-metal"); }
  return [
    matte,
    gloss,
    metal,
    glow,
  ];
}

let haloTexture: THREE.Texture | null = null;
function halo(): THREE.Texture {
  if (haloTexture) return haloTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  haloTexture = new THREE.CanvasTexture(c);
  return haloTexture;
}

/** Soft halos around glowing spots (eyes, lanterns): clusters of glow triangles, one sprite each. */
function glowHalos(m: MeshData): THREE.Sprite[] {
  if (!m.finishes) return [];
  const cells = new Map<string, { x: number; y: number; z: number; r: number; g: number; b: number; n: number }>();
  for (let t = 0; t < m.finishes.length; t++) {
    if (m.finishes[t] !== 3) continue;
    const i = m.indices[t * 3] * 3;
    const x = m.positions[i], y = m.positions[i + 1], z = m.positions[i + 2];
    const key = `${Math.floor(x / 4)},${Math.floor(y / 4)},${Math.floor(z / 4)}`;
    const c = cells.get(key) ?? { x: 0, y: 0, z: 0, r: 0, g: 0, b: 0, n: 0 };
    c.x += x; c.y += y; c.z += z; c.r += m.colors[i]; c.g += m.colors[i + 1]; c.b += m.colors[i + 2]; c.n++;
    cells.set(key, c);
  }
  const out: THREE.Sprite[] = [];
  for (const c of [...cells.values()].sort((a, b) => b.n - a.n).slice(0, 12)) {
    const col = new THREE.Color().setRGB(c.r / c.n, c.g / c.n, c.b / c.n, THREE.SRGBColorSpace);
    const mat = new THREE.SpriteMaterial({ map: halo(), color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    const s = new THREE.Sprite(mat);
    s.position.set(c.x / c.n, c.y / c.n, c.z / c.n);
    s.scale.setScalar(Math.min(14, 3 + Math.sqrt(c.n) * 1.2));
    s.onBeforeRender = () => { mat.opacity = glowStrength * 0.8; };
    out.push(s);
  }
  return out;
}

/**
 * Turn a generated model into Three.js meshes: one pivot group per part, drawn in a style
 * (voxel cubes, a smooth surface, low-poly facets, or sculpted forms) within a triangle budget.
 * Sculpted models get a close-up version and a distant one (a LOD per part).
 */
export function buildVoxelObject(model: VoxelModel, style: ModelStyle = "voxel", maxTriangles = Infinity, opts: BuildOptions = {}): VoxelObject {
  const root = new THREE.Group();
  const parts = new Map<string, THREE.Group[]>();
  const vs = model.voxelSize;
  const mult = opts.closeUpMultiplier ?? 1;
  const key = `${style}|${maxTriangles}|${mult}`;
  let byKey = cache.get(model);
  if (!byKey) { byKey = new Map(); cache.set(model, byKey); }
  let levels = byKey.get(key);
  if (!levels) {
    const m = meshModel(model, style, maxTriangles, mult);
    levels = { far: m.parts.map(toGeometry), near: m.near?.parts.map(toGeometry), farScale: m.scale, halos: m.parts };
    byKey.set(key, levels);
  }
  const materials = finishMaterials(style, vs, opts.surface);
  const within = opts.closeUpBlocks ?? 16;
  const pivots: THREE.Group[] = [];
  const textures: THREE.Texture[] = [];
  for (const [pi, part] of model.parts.entries()) {
    const place = (mesh: THREE.Object3D) => {
      mesh.scale.setScalar(vs);
      mesh.position.set((part.origin[0] - part.pivot[0]) * vs, (part.origin[1] - part.pivot[1]) * vs, (part.origin[2] - part.pivot[2]) * vs);
      return mesh;
    };
    const far = new THREE.Mesh(levels.far[pi], materials);
    if (style === "voxel") {
      // Each part's voxels, for the shader's ambient occlusion (set per draw: the materials are shared).
      const tex = occTexture(part.grid);
      textures.push(tex);
      far.onBeforeRender = (_r, _s, _c, _g, mat) => {
        const sh = (mat as THREE.Material).userData.shader;
        if (!sh) return;
        sh.uniforms.uOcc.value = tex;
        sh.uniforms.uDims.value.set(part.grid.w, part.grid.h, part.grid.d);
        (mat as THREE.Material & { uniformsNeedUpdate: boolean }).uniformsNeedUpdate = true;
      };
    }
    let shape: THREE.Object3D = place(far);
    if (levels.near) {
      const lod = new THREE.LOD();
      lod.addLevel(place(new THREE.Mesh(levels.near[pi], materials)), 0);
      lod.addLevel(shape, within);
      shape = lod;
    }
    const pivot = new THREE.Group();
    pivot.position.set(part.pivot[0] * vs, part.pivot[1] * vs, part.pivot[2] * vs);
    pivot.add(shape);
    const halos = glowHalos(levels.halos[pi]);
    if (halos.length) { const hg = place(new THREE.Group()); hg.add(...halos); pivot.add(hg); }
    pivot.userData.chain = part.chain ?? 0;
    pivots.push(pivot);
    // A chain segment hangs from the segment before it (positioned relative to that pivot).
    const parent = part.parent !== undefined ? pivots[part.parent] : undefined;
    if (parent) {
      const pp = model.parts[part.parent!].pivot;
      pivot.position.set((part.pivot[0] - pp[0]) * vs, (part.pivot[1] - pp[1]) * vs, (part.pivot[2] - pp[2]) * vs);
      parent.add(pivot);
    } else root.add(pivot);
    const role = part.anim ?? "static";
    parts.set(role, [...(parts.get(role) ?? []), pivot]);
    if (role === "lid") pivot.visible = false; // shown only while blinking
  }
  // What sits on the head moves with it: the jaw, ears, antennae and eyelids hang from the head's pivot.
  const headIndex = model.parts.findIndex((p) => p.anim === "head");
  if (headIndex >= 0) {
    const hp = model.parts[headIndex].pivot;
    for (const [pi, part] of model.parts.entries()) {
      if (part.parent !== undefined || !["jaw", "earL", "earR", "antenna", "lid"].includes(part.anim ?? "")) continue;
      pivots[pi].position.set((part.pivot[0] - hp[0]) * vs, (part.pivot[1] - hp[1]) * vs, (part.pivot[2] - hp[2]) * vs);
      pivots[headIndex].add(pivots[pi]);
    }
  }
  return { root, parts, materials, textures };
}

/**
 * Track how the object moves in the world (from its parent: the entity's group) and run the
 * springs. Nothing on the first call, or when time jumps (a viewer posing a still).
 */
const WORLD_POS = new THREE.Vector3();
function secondary(o: VoxelObject, t: number): { tail: number; tailUp: number; ears: number; head: number; lean: number; roll: number; turn: number } | null {
  const holder = o.root.parent;
  if (!holder) return null;
  // Where it is in the world (the entity's group may be a parent or two up).
  holder.updateWorldMatrix(true, false);
  const wp = holder.getWorldPosition(WORLD_POS);
  const x = wp.x, y = wp.y, z = wp.z, yaw = holder.rotation.y;
  const m = o.motion;
  const s0 = (): Spring => ({ x: 0, v: 0 });
  if (!m || t <= m.t || t - m.t > 0.25) {
    o.motion = { t, x, y, z, yaw, turn: 0, speed: 0, vy: 0, accel: 0, ay: 0, roll: m?.roll ?? 0, tail: s0(), tailUp: s0(), ears: s0(), head: s0(), lean: s0() };
    return null;
  }
  const dt = t - m.t;
  let dyaw = yaw - m.yaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  const speed = Math.hypot(x - m.x, z - m.z) / dt, vy = (y - m.y) / dt;
  // Rolling forward or back along where it faces (the model's front is +z, turned by yaw).
  m.roll += (x - m.x) * Math.sin(yaw) + (z - m.z) * Math.cos(yaw);
  // Smooth the raw rates (positions arrive in network steps), then the accelerations from them.
  const k = Math.min(1, dt * 10);
  const turn = m.turn + (dyaw / dt - m.turn) * k;
  const sp = m.speed + (speed - m.speed) * k, vys = m.vy + (vy - m.vy) * k;
  m.accel += ((sp - m.speed) / dt - m.accel) * k;
  m.ay += ((vys - m.vy) / dt - m.ay) * k;
  Object.assign(m, { t, x, y, z, yaw, turn, speed: sp, vy: vys });
  const clamp = (v: number, a: number) => Math.max(-a, Math.min(a, v));
  return {
    tail: spring(m.tail, clamp(-turn * 0.22, 0.55), dt, 40, 6),
    tailUp: spring(m.tailUp, clamp(-m.ay * 0.025 + vys * 0.03, 0.4), dt, 50, 6),
    ears: spring(m.ears, clamp(-m.accel * 0.05 - m.ay * 0.02 - sp * 0.03, 0.6), dt, 90, 7),
    head: spring(m.head, clamp(turn * 0.15, 0.35), dt, 60, 10),
    lean: spring(m.lean, clamp(-turn * sp * 0.025, 0.25), dt, 50, 9),
    roll: m.roll, turn,
  };
}

/**
 * Pose a voxel object for time t: tails sway, fins and wings flap, legs walk,
 * the body bobs or banks. `moving` (0..1) scales walk/swim motion.
 */
export function animateVoxelObject(o: VoxelObject, t: number, moving: number, kind: "swim" | "fly" | "walk" | "drift" | "hover" | "sail", windup = 0, gait?: string, attack?: { kind: string; active: boolean } | null, life?: { action?: string | null; look?: number; blink?: number }): void {
  const freq = kind === "swim" || kind === "fly" ? 5 : 3;
  const sway = Math.sin(t * freq);
  const idle = 1 - moving;
  const sec = secondary(o, t);
  // Tails swing with follow-through: each chain segment a beat behind the one before (and the
  // rotations add up down the chain, so the tip whips). A one-piece tail just sways. Serpents
  // travel a wave down the whole body; floaters trail their tendrils slowly.
  const tailFreq = gait === "slither" ? 3 + 2 * moving : gait === "float" ? 1.6 : freq;
  const tailAmp = gait === "slither" ? 0.4 + 0.25 * moving : gait === "float" ? 0.18 : 0.25 + 0.25 * moving;
  for (const p of o.parts.get("tail") ?? []) {
    const c = (p.userData.chain as number) ?? 0;
    p.rotation.y = Math.sin(t * tailFreq - c * (gait === "slither" ? 1.1 : 0.7)) * tailAmp * (c ? 0.6 : 1);
    if (c || gait === "float") p.rotation.x = Math.sin(t * tailFreq * 0.5 - c * 0.9) * (gait === "float" ? 0.15 : 0.08);
  }
  // Idle life: a slow breath, so nothing stands frozen. Floaters (jellyfish, spirits) pulse.
  if (gait === "float") {
    const pulse = Math.sin(t * 2.2);
    for (const p of o.parts.get("body") ?? []) p.scale.set(1 - pulse * 0.05, 1 + pulse * 0.07, 1 - pulse * 0.05);
  } else if (!o.parts.has("wheel")) { // (machines don't breathe)
    const breath = 1 + Math.sin(t * 1.6) * 0.012 * idle;
    for (const p of o.parts.get("body") ?? []) p.scale.set(breath, 1 + (breath - 1) * 1.6, breath);
  }
  // The head glances around now and then when standing still; serpents hold it steady against the wave.
  const glance = Math.sin(t * 0.37) * Math.sin(t * 0.23 + 1) * 0.5 * idle;
  for (const p of o.parts.get("head") ?? []) {
    p.rotation.y = gait === "slither" ? glance * 0.5 - Math.sin(t * tailFreq) * 0.12 : glance;
    // Long-legged striders and waddlers nod with each step.
    p.rotation.x = gait === "stride" ? Math.sin(t * 12) * 0.05 * moving : gait === "waddle" ? Math.sin(t * 12) * 0.08 * moving : 0;
  }
  for (const p of o.parts.get("finL") ?? []) p.rotation.z = -0.25 + Math.sin(t * 3) * 0.12;
  for (const p of o.parts.get("finR") ?? []) p.rotation.z = 0.25 - Math.sin(t * 3) * 0.12;
  // Wings: bees and butterflies flutter fast, big birds glide with slow beats, walkers flap when they hurry.
  let flap = 0;
  if (gait === "flutter") flap = Math.sin(t * 22) * 0.65;
  else if (gait === "glide") flap = Math.pow(Math.sin(t * 2.6), 3) * (0.35 + 0.25 * moving);
  else if (kind === "fly") flap = Math.sin(t * 6) * (0.4 + 0.3 * moving);
  else if (gait === "waddle") flap = 0.15 + Math.abs(Math.sin(t * 9)) * 0.35 * moving;
  for (const p of o.parts.get("wingL") ?? []) p.rotation.z = flap;
  for (const p of o.parts.get("wingR") ?? []) p.rotation.z = -flap;
  // Legs: crawlers scuttle (many quick, small steps), striders take long slow ones, hoppers tuck in the air.
  const legFreq = gait === "crawl" ? 15 : gait === "stride" ? 6 : gait === "waddle" ? 6 : 8;
  const legAmp = gait === "crawl" ? 0.35 : gait === "stride" ? 0.7 : gait === "waddle" ? 0.35 : 0.6;
  let step = Math.sin(t * legFreq) * legAmp * moving;
  // Root motion: hops, waddles, flutters, glides and banks move the whole model.
  const r = o.root;
  r.position.y = 0; r.position.z = 0; r.rotation.z = 0; r.rotation.x = 0;
  if (gait === "hop") {
    const ph = (t * 2.4) % 1;
    const air = Math.sin(ph * Math.PI);
    // Moving: a hop every beat. Standing: an occasional little bounce.
    r.position.y = moving > 0.05 ? air * 0.35 * moving : Math.pow(Math.max(0, Math.sin(t * 1.3)), 12) * 0.12;
    r.rotation.x = moving > 0.05 ? -Math.cos(ph * Math.PI) * 0.12 * moving : 0;
    step = moving > 0.05 ? -air * 0.6 * moving : 0;
  } else if (gait === "waddle") {
    r.rotation.z = Math.sin(t * 6) * (0.05 + 0.1 * moving);
  } else if (gait === "crawl") {
    r.rotation.z = Math.sin(t * 15) * 0.025 * moving;
  } else if (gait === "stride") {
    r.position.y = Math.abs(Math.sin(t * 6)) * 0.04 * moving;
  } else if (gait === "flutter") {
    r.position.y = Math.sin(t * 4.3) * 0.08 + Math.sin(t * 7.1) * 0.03;
    r.rotation.z = Math.sin(t * 3.1) * 0.08;
  } else if (gait === "glide") {
    r.rotation.z = Math.sin(t * 0.6) * 0.14; // banking turns
    r.position.y = Math.pow(Math.sin(t * 2.6), 3) * -0.05;
  } else if (gait === "float") {
    r.position.y = Math.sin(t * 2.2 - 0.6) * 0.1;
  }
  for (const p of o.parts.get("legL") ?? []) p.rotation.x = step;
  for (const p of o.parts.get("legR") ?? []) p.rotation.x = gait === "hop" ? step : -step;
  // Arms swing against the legs; while winding up an attack the sword arm (right) is raised overhead.
  for (const p of o.parts.get("armL") ?? []) p.rotation.x = -step * 0.8 - windup * 0.6;
  for (const p of o.parts.get("armR") ?? []) p.rotation.x = windup > 0 ? -2.6 * windup : step * 0.8;
  // Ships rock gently on the waves.
  if (kind === "sail") for (const p of [...(o.parts.get("body") ?? [])]) { p.rotation.z = Math.sin(t * 0.9) * 0.04; p.rotation.x = Math.sin(t * 0.7 + 1) * 0.02; }
  // Swimmers and flyers flex their body against the tail (bobbing is applied to the whole object by the caller).
  if (kind === "swim" || kind === "fly") for (const p of o.parts.get("body") ?? []) p.rotation.y = -sway * 0.06 * (0.5 + moving);

  // Smaller parts with a life of their own.
  // Jaw: a pant or yawn now and then; opens as it winds up to bite or breathe.
  const head = o.parts.get("head")?.[0];
  let jaw = idle * Math.max(0, Math.sin(t * 0.21) * Math.sin(t * 0.13 + 2) - 0.6) * 0.8;
  // Ears twitch now and then, and flatten back when it means to attack.
  const twitch = Math.pow(Math.max(0, Math.sin(t * 0.9) * Math.sin(t * 0.53 + 1)), 8) * 0.5;
  for (const p of o.parts.get("earL") ?? []) { p.rotation.z = -twitch; p.rotation.x = -windup * 0.7; }
  for (const p of o.parts.get("earR") ?? []) { p.rotation.z = twitch * 0.6; p.rotation.x = -windup * 0.7; }
  for (const p of o.parts.get("antenna") ?? []) { p.rotation.x = Math.sin(t * 2.3 + p.position.x) * 0.15; p.rotation.z = Math.sin(t * 1.7 + p.position.x * 3) * 0.12; }
  // Tentacles wave, each a little out of step with the next (and chained ones whip like tails).
  for (const [i, p] of (o.parts.get("tentacle") ?? []).entries()) {
    const c = (p.userData.chain as number) ?? 0, ph = i * 0.9 + p.position.x * 2;
    p.rotation.x = Math.sin(t * 2 - c * 0.8 + ph) * (0.18 + 0.12 * moving);
    p.rotation.z = Math.sin(t * 1.4 - c * 0.6 + ph * 1.3) * 0.15;
  }

  // Idle actions: graze (head to the grass, chewing), sniff (nose down, quick nods), sit, roar
  // (head up, jaw wide), sleep (lying down, head low, slow deep breaths). A glance at players close by.
  const action = attack ? null : life?.action;
  const heads = o.parts.get("head") ?? [];
  if (life?.look && !attack) for (const p of heads) p.rotation.y += life.look;
  if (action) {
    const legs = [...(o.parts.get("legL") ?? []), ...(o.parts.get("legR") ?? [])];
    const hip = Math.max(0.2, ...legs.map((p) => p.position.y));
    const biped = (o.parts.get("armL")?.length ?? 0) > 0;
    if (action === "graze") {
      for (const p of heads) p.rotation.x = 0.85 + Math.sin(t * 1.3) * 0.05;
      jaw = Math.max(0, Math.sin(t * 7)) * 0.2;
    } else if (action === "sniff") {
      for (const p of heads) { p.rotation.x = 0.5 + Math.sin(t * 13) * 0.07; p.rotation.y = Math.sin(t * 1.9) * 0.35; }
    } else if (action === "sit") {
      if (biped) {
        r.position.y = -hip * 0.55;
        for (const p of legs) p.rotation.x = -1.35;
        for (const p of o.parts.get("armL") ?? []) p.rotation.x = -0.4;
        for (const p of o.parts.get("armR") ?? []) p.rotation.x = -0.4;
      } else {
        // Haunches down, front legs straight: the body tilts back about its back feet.
        const th = -0.32, zr = Math.min(0, ...legs.map((p) => p.position.z));
        r.rotation.x = th;
        r.position.y = zr * Math.sin(th) - hip * 0.55;
        r.position.z = zr * (1 - Math.cos(th));
        for (const p of legs) p.rotation.x = p.position.z > 0 ? -th : -1.25;
      }
    } else if (action === "roar") {
      for (const p of heads) p.rotation.x = -0.55 + Math.sin(t * 40) * 0.03;
      r.rotation.x = -0.08;
      jaw = 0.8;
      for (const p of o.parts.get("armL") ?? []) p.rotation.x = -2.2;
      for (const p of o.parts.get("armR") ?? []) p.rotation.x = -2.2;
    } else if (action === "perch") {
      // Landed: wings folded in, still; it looks about.
      r.position.y = 0; r.rotation.z = 0; r.rotation.x = 0;
      for (const p of o.parts.get("wingL") ?? []) p.rotation.z = 0.05 + Math.max(0, Math.sin(t * 0.7) - 0.95) * 4;
      for (const p of o.parts.get("wingR") ?? []) p.rotation.z = -0.05 - Math.max(0, Math.sin(t * 0.7) - 0.95) * 4;
      for (const p of legs) p.rotation.x = 0;
      for (const p of heads) p.rotation.y = Math.sin(t * 0.8) * 0.6 * Math.sign(Math.sin(t * 0.31));
    } else if (action === "breach") {
      // Leaping clear of the water: body arched, tail beating.
      for (const p of o.parts.get("tail") ?? []) p.rotation.y = Math.sin(t * 14) * 0.5;
      for (const p of o.parts.get("body") ?? []) p.rotation.y = Math.sin(t * 14) * 0.08;
    } else if (action === "sleep") {
      for (const p of [...(o.parts.get("wingL") ?? []), ...(o.parts.get("wingR") ?? [])]) p.rotation.z = 0;
      r.rotation.z = 0;
      // Four legs: belly to the ground. Two: lying on its side (lifted so it rests on the ground, not in it).
      r.position.y = biped ? hip * 0.35 : -hip * 0.85;
      if (biped) r.rotation.z = 1.45;
      // Legs tucked under the body: front feet back, back feet forward.
      for (const p of legs) p.rotation.x = biped ? 0 : p.position.z > 0 ? 1.45 : -1.45;
      for (const p of heads) { p.rotation.x = 0.45; p.rotation.y = 0; }
      const deep = 1 + Math.sin(t * 0.9) * 0.035;
      for (const p of o.parts.get("body") ?? []) p.scale.set(deep, 1 + (deep - 1) * 1.6, deep);
      for (const p of [...(o.parts.get("tail") ?? []), ...(o.parts.get("wingL") ?? []), ...(o.parts.get("wingR") ?? [])]) p.rotation.z *= 0.1;
    }
  }

  // Attack poses: the warning is a readable pose (rear back to breathe, head down to charge, rear
  // up to stomp, draw back to shoot), and the attack itself the follow-through.
  if (attack) {
    const w = windup, act = attack.active;
    const legs = [...(o.parts.get("legL") ?? []), ...(o.parts.get("legR") ?? [])];
    if (attack.kind === "breath") {
      for (const p of heads) p.rotation.x = act ? 0.25 + Math.sin(t * 30) * 0.03 : -0.55 * w;
      r.rotation.x = act ? 0.06 : -0.08 * w;
      jaw = act ? 0.75 : 0.35 * w;
    } else if (attack.kind === "bite") {
      for (const p of heads) p.rotation.x = act ? 0.3 : -0.25 * w;
      jaw = act ? 0.1 : 0.6 * w;
    } else if (attack.kind === "shot") {
      r.rotation.x = act ? 0.08 : -0.1 * w;
      for (const p of heads) p.rotation.x = act ? 0.15 : -0.2 * w;
      // Bipeds draw a bow: both arms forward, the right drawn back.
      for (const p of o.parts.get("armL") ?? []) p.rotation.x = -1.5 * Math.max(w, act ? 1 : 0);
      for (const p of o.parts.get("armR") ?? []) p.rotation.x = act ? -1.2 : -1.6 * w;
      jaw = act ? 0.5 : 0.25 * w;
    } else if (attack.kind === "charge") {
      for (const p of heads) p.rotation.x = 0.45 * Math.max(w, act ? 1 : 0);
      r.rotation.x = 0.1 * Math.max(w, act ? 1 : 0);
      // Pawing the ground while it winds up; a full gallop when it goes.
      const paw = Math.sin(t * 14);
      for (const p of legs) p.rotation.x = act ? Math.sin(t * 20 + (p.position.z > 0 ? 0 : Math.PI)) * 0.8 : p.position.z > 0 && p.position.x > 0 ? -Math.max(0, paw) * 0.6 * w : p.rotation.x;
    } else if (attack.kind === "stomp") {
      // Rear up on the back legs, front legs high; then slam down.
      r.rotation.x = act ? 0.12 : -0.4 * w;
      r.position.y += act ? 0 : 0.25 * w;
      for (const p of legs) if (p.position.z > 0) p.rotation.x = act ? 0.3 : -0.9 * w;
      for (const p of o.parts.get("armL") ?? []) p.rotation.x = act ? 0.4 : -2.6 * w;
      for (const p of o.parts.get("armR") ?? []) p.rotation.x = act ? 0.4 : -2.6 * w;
    }
  }
  for (const p of o.parts.get("jaw") ?? []) p.rotation.x = jaw;

  // Secondary motion: ears and antennae flop back when it sets off and bounce when it stops or
  // lands, the tail swings out on turns, the head leads into a turn, and walkers lean into it
  // (flyers bank harder).
  if (sec) {
    for (const p of o.parts.get("tail") ?? []) {
      const c = (p.userData.chain as number) ?? 0;
      p.rotation.y += sec.tail * (c ? 0.5 : 1);
      p.rotation.x += sec.tailUp * (c ? 0.6 : 1);
    }
    for (const p of [...(o.parts.get("earL") ?? []), ...(o.parts.get("earR") ?? []), ...(o.parts.get("antenna") ?? [])]) p.rotation.x += sec.ears;
    for (const p of o.parts.get("tentacle") ?? []) p.rotation.x += sec.ears * 0.6;
    if (!action) for (const p of heads) p.rotation.y += sec.head;
    if (action !== "sleep" && action !== "sit" && !o.parts.has("wheel")) r.rotation.z += sec.lean * (kind === "fly" ? 2.2 : kind === "swim" ? 1.2 : 1);
  }

  // Wheels roll with the ground (the radius is the pivot's height); the front pair steers into turns.
  const wheelParts = o.parts.get("wheel");
  if (wheelParts && sec) wheelParts.forEach((p, i) => {
    p.rotation.x = sec.roll / Math.max(0.08, p.position.y);
    p.rotation.y = i === 0 && wheelParts.length > 1 ? Math.max(-0.45, Math.min(0.45, sec.turn * 0.25)) : 0;
  });

  // Blinks: a quick close every few seconds (now and then twice); eyes shut in sleep.
  const lids = o.parts.get("lid");
  if (lids) {
    const seed = (o.root.id * 0.618) % 1;
    const period = 2.6 + seed * 3.2;
    const u = (t + seed * 10) % period; // seconds into this period
    const twice = Math.sin(Math.floor((t + seed * 10) / period) * 12.9898) > 0.6;
    const one = (x: number) => (x > 0 && x < 0.16 ? Math.sin((x / 0.16) * Math.PI) : 0);
    const shut = action === "sleep" ? 1 : life?.blink ?? Math.max(one(u), twice ? one(u - 0.28) : 0);
    for (const p of lids) { p.visible = shut > 0.03; p.scale.y = Math.max(0.05, shut); }
  }
  // A neck carries half of the head's movement.
  for (const p of o.parts.get("neck") ?? []) { p.rotation.x = (head?.rotation.x ?? 0) * 0.5; p.rotation.y = (head?.rotation.y ?? 0) * 0.5; }
}
