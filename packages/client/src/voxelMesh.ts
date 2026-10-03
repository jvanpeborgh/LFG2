import * as THREE from "three";
import { FINISHES, meshModel, type MeshData, type ModelStyle, type VoxelModel } from "@lfg/shared";

/** Materials that can be tinted (hurt flash, warning pulse): all of them have an emissive colour. */
export type LitMaterial = THREE.MeshLambertMaterial | THREE.MeshPhongMaterial | THREE.MeshStandardMaterial;

export interface VoxelObject {
  root: THREE.Group;
  /** Pivot groups by animation role. */
  parts: Map<string, THREE.Group[]>;
  materials: LitMaterial[];
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

function finishMaterials(style: ModelStyle, vs = 0.0625, surface: BuildOptions["surface"] = "hide"): LitMaterial[] {
  const flatShading = style === "lowpoly";
  const glow = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading });
  glow.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace("vec3 totalEmissiveRadiance = emissive;", "vec3 totalEmissiveRadiance = emissive + vColor.rgb * 0.85;");
  };
  glow.customProgramCacheKey = () => "finish-glow";
  const matte = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading });
  const gloss = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading, roughness: 0.38, metalness: 0, envMap, envMapIntensity: 0.75 });
  if ((style === "sculpted" || style === "smooth") && surface !== "smooth") { withDetail(matte, vs, surface, 1, "detail-matte"); withDetail(gloss, vs, surface, 0.5, "detail-gloss"); }
  return [
    matte,
    gloss,
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading, roughness: 0.42, metalness: 0.85, envMap, envMapIntensity: 0.8 }),
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
  for (const [pi, part] of model.parts.entries()) {
    const place = (mesh: THREE.Object3D) => {
      mesh.scale.setScalar(vs);
      mesh.position.set((part.origin[0] - part.pivot[0]) * vs, (part.origin[1] - part.pivot[1]) * vs, (part.origin[2] - part.pivot[2]) * vs);
      return mesh;
    };
    let shape: THREE.Object3D = place(new THREE.Mesh(levels.far[pi], materials));
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
  }
  return { root, parts, materials };
}

/**
 * Pose a voxel object for time t: tails sway, fins and wings flap, legs walk,
 * the body bobs or banks. `moving` (0..1) scales walk/swim motion.
 */
export function animateVoxelObject(o: VoxelObject, t: number, moving: number, kind: "swim" | "fly" | "walk" | "drift" | "hover" | "sail", windup = 0, gait?: string): void {
  const freq = kind === "swim" || kind === "fly" ? 5 : 3;
  const sway = Math.sin(t * freq);
  const idle = 1 - moving;
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
  } else {
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
  r.position.y = 0; r.rotation.z = 0; r.rotation.x = 0;
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
}
