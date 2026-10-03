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
function finishMaterials(style: ModelStyle): LitMaterial[] {
  const flatShading = style === "lowpoly";
  const glow = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading });
  glow.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace("vec3 totalEmissiveRadiance = emissive;", "vec3 totalEmissiveRadiance = emissive + vColor.rgb * 0.85;");
  };
  glow.customProgramCacheKey = () => "finish-glow";
  return [
    new THREE.MeshLambertMaterial({ vertexColors: true, flatShading }),
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading, roughness: 0.38, metalness: 0, envMap, envMapIntensity: 0.75 }),
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
  const materials = finishMaterials(style);
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
export function animateVoxelObject(o: VoxelObject, t: number, moving: number, kind: "swim" | "fly" | "walk" | "drift" | "hover" | "sail", windup = 0): void {
  const freq = kind === "swim" || kind === "fly" ? 5 : 3;
  const sway = Math.sin(t * freq);
  // Tails swing with follow-through: each chain segment a beat behind the one before (and the
  // rotations add up down the chain, so the tip whips). A one-piece tail just sways.
  for (const p of o.parts.get("tail") ?? []) {
    const c = (p.userData.chain as number) ?? 0;
    p.rotation.y = Math.sin(t * freq - c * 0.7) * (0.25 + 0.25 * moving) * (c ? 0.6 : 1);
    if (c) p.rotation.x = Math.sin(t * freq * 0.5 - c * 0.9) * 0.08;
  }
  // Idle life: a slow breath, so nothing stands frozen.
  const breath = 1 + Math.sin(t * 1.6) * 0.012 * (1 - moving);
  for (const p of o.parts.get("body") ?? []) p.scale.set(breath, 1 + (breath - 1) * 1.6, breath);
  // The head glances around now and then when standing still.
  const glance = Math.sin(t * 0.37) * Math.sin(t * 0.23 + 1) * 0.5 * (1 - moving);
  for (const p of o.parts.get("head") ?? []) p.rotation.y = glance;
  for (const p of o.parts.get("finL") ?? []) p.rotation.z = -0.25 + Math.sin(t * 3) * 0.12;
  for (const p of o.parts.get("finR") ?? []) p.rotation.z = 0.25 - Math.sin(t * 3) * 0.12;
  const flap = kind === "fly" ? Math.sin(t * 6) * (0.4 + 0.3 * moving) : 0;
  for (const p of o.parts.get("wingL") ?? []) p.rotation.z = flap;
  for (const p of o.parts.get("wingR") ?? []) p.rotation.z = -flap;
  const step = Math.sin(t * 8) * 0.6 * moving;
  for (const p of o.parts.get("legL") ?? []) p.rotation.x = step;
  for (const p of o.parts.get("legR") ?? []) p.rotation.x = -step;
  // Arms swing against the legs; while winding up an attack the sword arm (right) is raised overhead.
  for (const p of o.parts.get("armL") ?? []) p.rotation.x = -step * 0.8 - windup * 0.6;
  for (const p of o.parts.get("armR") ?? []) p.rotation.x = windup > 0 ? -2.6 * windup : step * 0.8;
  // Ships rock gently on the waves.
  if (kind === "sail") for (const p of [...(o.parts.get("body") ?? [])]) { p.rotation.z = Math.sin(t * 0.9) * 0.04; p.rotation.x = Math.sin(t * 0.7 + 1) * 0.02; }
  // Swimmers and flyers flex their body against the tail (bobbing is applied to the whole object by the caller).
  if (kind === "swim" || kind === "fly") for (const p of o.parts.get("body") ?? []) p.rotation.y = -sway * 0.06 * (0.5 + moving);
}
