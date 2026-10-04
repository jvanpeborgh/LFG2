import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import {
  DEFAULT_STANDARDS, actionFromFlags, actionsFor, assetBudget, attackFromFlags, cloneStandards, elementOf, fitSpecToRules, generateModel, makeBody,
  newSummonState, personalityOf, planCreature, startAction, stepSummon, styleFor, summonStats,
  type AttackFx, type Body, type BrainCtx, type BrainPlayer, type IdleAction, type Neighbour, type SummonSpec, type SummonState, type SummonStats,
} from "@lfg/shared";
import { Audio } from "./audio";
import { animateVoxelObject, buildVoxelObject, setEnvironment, setGlowStrength, type VoxelObject } from "./voxelMesh";

/**
 * The Creature Lab: a meadow with a pond, running the game's own creature code in the browser
 * (the same planner, models, behaviour and animation as the server and the game client), so you
 * can watch summons live their lives without a server: add any creature by name, change the time
 * of day, stand in the meadow yourself, and make a creature show its poses and attacks.
 */
const std = cloneStandards(DEFAULT_STANDARDS);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ------------------------------------------------------------------ the meadow (blocks)
// Stone below y = 10 (the grass is the top of it); a pond; a few trees (trunks and leaf crowns).
const SOLID = 1, WATER = 2, LOG = 3, LEAVES = 4;
const POND = { x0: -16, x1: -5, z0: -15, z1: -5 };
const TREES: [number, number][] = [[9, -11], [14, 6], [-12, 11], [3, 15], [-17, -1]];
const inPond = (x: number, z: number) => x >= POND.x0 && x <= POND.x1 && z >= POND.z0 && z <= POND.z1;
function getBlock(x: number, y: number, z: number): number {
  if (y < 0) return SOLID;
  if (inPond(x, z)) return y < 5 ? SOLID : y < 10 ? WATER : 0;
  if (y < 10) return SOLID;
  for (const [tx, tz] of TREES) {
    if (x === tx && z === tz && y < 14) return LOG;
    if (y >= 13 && y <= 15 && Math.abs(x - tx) + Math.abs(z - tz) + Math.abs(y - 14) <= 2) return LEAVES;
  }
  return 0;
}
const world = { getBlock };
const table = {
  solid: Uint8Array.from([0, 1, 0, 1, 1]), liquid: Uint8Array.from([0, 0, 1, 0, 0]),
  opaque: Uint8Array.from([0, 1, 0, 1, 1]), replaceable: new Uint8Array(5), light: new Uint8Array(5),
} as unknown as BrainCtx["table"];
const groundY = (x: number, z: number) => { for (let y = 20; y >= 0; y--) if (table.solid[getBlock(x, y, z)]) return y; return -1; };

// ------------------------------------------------------------------ rendering
const canvas = $<HTMLCanvasElement>("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
setEnvironment(renderer, () => new RoomEnvironment());
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
camera.position.set(16, 22, 24);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 10.5, 0);
controls.maxPolarAngle = Math.PI * 0.48;
controls.minDistance = 4; controls.maxDistance = 70;
controls.enableDamping = true;

const hemi = new THREE.HemisphereLight(0xdfeeff, 0x5b4a2a, 1);
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.castShadow = false;
scene.add(hemi, sun, new THREE.AmbientLight(0xffffff, 0.25));

/** A small pixel texture, so the ground reads as blocks. */
function blockTexture(base: string, spots: string[], seed: number): THREE.Texture {
  const c = document.createElement("canvas"); c.width = c.height = 16;
  const g = c.getContext("2d")!;
  g.fillStyle = base; g.fillRect(0, 0, 16, 16);
  let r = seed;
  const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) { g.fillStyle = spots[Math.floor(rand() * spots.length)]; g.fillRect(Math.floor(rand() * 16), Math.floor(rand() * 16), 1, 1); }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const P = std.art.palette as Record<string, string>;
{
  // Grass blocks out to 30 around, dirt sides at the pond's edge, water, trees.
  const box = new THREE.BoxGeometry(1, 1, 1);
  const grass = new THREE.MeshLambertMaterial({ map: blockTexture("#5fae3e", ["#4f9a33", "#6cbd48", "#57a439"], 7) });
  const dirt = new THREE.MeshLambertMaterial({ map: blockTexture("#8a5d3b", ["#7a5233", "#97683f"], 9) });
  const sand = new THREE.MeshLambertMaterial({ map: blockTexture("#d8c58a", ["#cdb97c", "#e2d197"], 11) });
  const cells: [number, number, number, THREE.Material][] = [];
  for (let x = -30; x <= 30; x++) for (let z = -30; z <= 30; z++) {
    if (Math.hypot(x, z) > 31) continue;
    if (inPond(x, z)) { cells.push([x, 4, z, sand]); continue; }
    const edge = inPond(x + 1, z) || inPond(x - 1, z) || inPond(x, z + 1) || inPond(x, z - 1);
    cells.push([x, 9, z, edge ? sand : grass]);
    if (edge) for (let y = 5; y < 9; y++) cells.push([x, y, z, dirt]);
  }
  for (const mat of [grass, dirt, sand]) {
    const mine = cells.filter((c) => c[3] === mat);
    const inst = new THREE.InstancedMesh(box, mat, mine.length);
    const m = new THREE.Matrix4();
    mine.forEach(([x, y, z], i) => inst.setMatrixAt(i, m.makeTranslation(x + 0.5, y + 0.5, z + 0.5)));
    scene.add(inst);
  }
  const water = new THREE.Mesh(new THREE.BoxGeometry(POND.x1 - POND.x0 + 1, 5, POND.z1 - POND.z0 + 1),
    new THREE.MeshLambertMaterial({ color: 0x3f7fd0, transparent: true, opacity: 0.62, depthWrite: false }));
  water.position.set((POND.x0 + POND.x1 + 1) / 2, 7.4, (POND.z0 + POND.z1 + 1) / 2);
  scene.add(water);
  const log = new THREE.MeshLambertMaterial({ map: blockTexture("#6b4a2b", ["#5a3d22", "#7a5634"], 3) });
  const leaves = new THREE.MeshLambertMaterial({ map: blockTexture("#3f8a2e", ["#357a26", "#4c9a38", "#2f6e22"], 5) });
  for (const [tx, tz] of TREES) {
    for (let y = 10; y < 14; y++) { const b = new THREE.Mesh(box, log); b.position.set(tx + 0.5, y + 0.5, tz + 0.5); scene.add(b); }
    for (let x = -2; x <= 2; x++) for (let y = -1; y <= 1; y++) for (let z = -2; z <= 2; z++)
      if (Math.abs(x) + Math.abs(z) + Math.abs(y) <= 2) { const b = new THREE.Mesh(box, leaves); b.position.set(tx + x + 0.5, 14 + y + 0.5, tz + z + 0.5); scene.add(b); }
  }
}

// ------------------------------------------------------------------ you (an observer in the meadow)
const you = { id: 1, x: 3.5, y: 10, z: 4.5, huntable: false, placed: true, health: 100 } as BrainPlayer & { placed: boolean; health: number };
const youMesh = new THREE.Group();
{
  const skin = new THREE.MeshLambertMaterial({ color: 0xd8a27a }), shirt = new THREE.MeshLambertMaterial({ color: 0x3b75b0 }), legs = new THREE.MeshLambertMaterial({ color: 0x2c3a5a });
  const part = (w: number, h: number, d: number, y: number, m: THREE.Material) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.y = y; youMesh.add(b); };
  part(0.5, 0.75, 0.3, 0.375, legs); part(0.55, 0.65, 0.32, 1.07, shirt); part(0.45, 0.45, 0.45, 1.62, skin);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.7, 32), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; youMesh.add(ring);
  scene.add(youMesh);
}

// ------------------------------------------------------------------ creatures
interface Creature {
  id: number; spec: SummonSpec; stats: SummonStats; body: Body; state: SummonState; group: number;
  obj: VoxelObject; root: THREE.Group; prev: THREE.Vector3; age: number; swing: number; moving: number; look: number;
  action: IdleAction | null; nextCall: number; showing?: { kind: string; t: number; warn: number };
}
const creatures: Creature[] = [];
let nextId = 10, nextGroup = 1;
const MAX = 30;
const audio = new Audio();
let soundOn = false;

function voiceOf(spec: SummonSpec): string | null {
  const words = `${spec.name} ${spec.prompt}`.toLowerCase();
  if (spec.body === "cloud" || spec.body === "ship") return null;
  if (/\b(ghost|spirit|wraith|phantom|wisp)\b/.test(words)) return "spirit";
  if (spec.gait === "flutter" || /\b(bee|bees|wasp|beetle|ant|ants)\b/.test(words)) return "insect";
  if (spec.body === "fish" || spec.movement === "swim") return "fish";
  if (spec.body === "blob") return "slime";
  if (spec.body === "bird") return spec.length > 2.5 ? "growl" : "bird";
  if (spec.body === "biped") return spec.temperament === "hostile" ? "growl" : "person";
  if (spec.temperament === "hostile") return "growl";
  return spec.length < 1 ? "small" : "beast";
}

/** Add what a prompt describes (several, for "three rabbits"), near a spot that suits it. */
function add(prompt: string): string {
  const plan = planCreature(prompt, std);
  if (!plan.spec) return plan.notes.join(" ") || `No idea how to make "${prompt}"`;
  const spec = fitSpecToRules(plan.spec, std).spec;
  if (spec.body === "ship" || spec.movement === "sail") return "Ships need the sea: try them in the full game";
  const model = generateModel(spec, std);
  const stats = summonStats(spec, model, std);
  const group = nextGroup++;
  const n = Math.min(spec.count, MAX - creatures.length);
  if (n <= 0) return `The meadow is full (${MAX}); clear some first`;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 6;
    let x = Math.cos(a) * r + 2, z = Math.sin(a) * r + 2, y = 10.05;
    if (spec.movement === "swim") { x = (POND.x0 + POND.x1) / 2 + (Math.random() - 0.5) * 6; z = (POND.z0 + POND.z1) / 2 + (Math.random() - 0.5) * 6; y = 7; }
    else if (spec.movement === "fly" || spec.movement === "hover") y = 13 + Math.random() * 3;
    else if (spec.movement === "drift") y = 26;
    const body = makeBody(x, y, z, stats.width, stats.height);
    const state = newSummonState(x, y, z, Math.random);
    const obj = buildVoxelObject(model, styleFor(spec, std), assetBudget(model, std)?.maxTris, { closeUpMultiplier: std.locked.closeUp.multiplier, closeUpBlocks: std.locked.closeUp.withinBlocks, surface: spec.surface });
    const root = new THREE.Group(); root.add(obj.root); scene.add(root);
    const c: Creature = { id: nextId++, spec: { ...spec, seed: spec.seed + i * 97 }, stats, body, state, group, obj, root, prev: new THREE.Vector3(x, y, z), age: Math.random() * 10, swing: 0, moving: 0, look: 0, action: null, nextCall: 3 + Math.random() * 10 };
    root.userData.creature = c.id;
    creatures.push(c);
  }
  renderList();
  return `Added ${plan.notes[0] ?? spec.name}${n > 1 ? ` (×${n})` : ""}`;
}

function remove(c: Creature): void {
  scene.remove(c.root);
  creatures.splice(creatures.indexOf(c), 1);
  if (selected === c) select(null);
  renderList();
}

// ------------------------------------------------------------------ effects
const sparks: { mesh: THREE.Mesh; v: THREE.Vector3; life: number }[] = [];
const sparkGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
const ELEMENT_COLORS: Record<string, [string, string]> = {
  fire: ["#ff7a1a", "#ffd04a"], frost: ["#bfe8ff", "#ffffff"], poison: ["#7ad14a", "#c8f06a"], lightning: ["#e8f0ff", "#9ad0ff"],
  water: ["#4aa0ff", "#bfe0ff"], web: ["#f4f4f0", "#cfcfc8"], stone: ["#8a7a60", "#c4b496"], magic: ["#c070ff", "#ffd0ff"],
};
function burst(x: number, y: number, z: number, color: string, n = 6, speed = 2): void {
  for (let i = 0; i < n && sparks.length < 900; i++) {
    const mesh = new THREE.Mesh(sparkGeo, new THREE.MeshBasicMaterial({ color, transparent: true }));
    mesh.position.set(x, y, z);
    scene.add(mesh);
    sparks.push({ mesh, v: new THREE.Vector3((Math.random() - 0.5) * speed, Math.random() * speed * 0.8, (Math.random() - 0.5) * speed), life: 0.6 + Math.random() * 0.5 });
  }
}
const rings: { mesh: THREE.Mesh; t: number; seconds: number }[] = [];
function fx(f: AttackFx): void {
  const [c1, c2] = ELEMENT_COLORS[f.element] ?? ELEMENT_COLORS.fire;
  const [x0, y0, z0] = f.from, [x1, y1, z1] = f.to;
  if (f.kind === "stomp") {
    if (f.phase === "warn") {
      const ring = new THREE.Mesh(new THREE.RingGeometry((f.radius ?? 3) - 0.25, f.radius ?? 3, 48), new THREE.MeshBasicMaterial({ color: std.art.reserved.danger, transparent: true, opacity: 0.8, depthTest: false, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(x0, y0 + 0.05, z0); scene.add(ring);
      rings.push({ mesh: ring, t: 0, seconds: f.seconds });
    } else for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; burst(x0 + Math.cos(a) * (f.radius ?? 3) * 0.8, y0 + 0.2, z0 + Math.sin(a) * (f.radius ?? 3) * 0.8, i % 2 ? "#8a7a60" : "#c4b496", 4, 4); }
    return;
  }
  if (f.phase === "warn") { for (let i = 0; i < 5; i++) setTimeout(() => burst(x0, y0, z0, i % 2 ? c1 : c2, 2, 0.8), i * f.seconds * 180); return; }
  if (f.phase === "end") { for (let i = 0; i < 5; i++) setTimeout(() => burst(x0, y0 + 1.2, z0, "#fff4b0", 2, 1), i * 250); return; }
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  if (f.kind === "breath") {
    for (let i = 0; i < Math.round(f.seconds * 14); i++) setTimeout(() => { for (let j = 0; j < 5; j++) { const t = Math.random(), s = t * 0.45; burst(x0 + dx * t + (Math.random() - 0.5) * s * 4, y0 + dy * t + (Math.random() - 0.5) * s * 2, z0 + dz * t + (Math.random() - 0.5) * s * 4, (i + j) % 3 ? c1 : c2, 1, 0.8); } }, i * 70);
  } else if (f.kind === "shot") {
    const n = Math.max(6, Math.round(f.seconds * 30));
    for (let i = 0; i <= n; i++) setTimeout(() => burst(x0 + (dx * i) / n, y0 + (dy * i) / n, z0 + (dz * i) / n, i % 2 ? c1 : c2, 2, 0.3), (i / n) * f.seconds * 1000);
  } else if (f.kind === "charge") {
    const n = Math.max(4, Math.round(f.seconds * 10));
    for (let i = 0; i < n; i++) setTimeout(() => burst(x0 + (dx * i) / n * 0.6, y0 + 0.1, z0 + (dz * i) / n * 0.6, i % 2 ? "#8a7a60" : "#c4b496", 3, 2), (i / n) * f.seconds * 1000);
  }
}

// ------------------------------------------------------------------ simulation (20 ticks a second, like the server)
let dayPhase = 0.18;
let timeRunning = true;
const isNight = () => dayPhase > 0.55 && dayPhase < 0.95;
function tick(dt: number): void {
  if (timeRunning) dayPhase = (dayPhase + dt / 240) % 1; // a day in 4 minutes
  const players: BrainPlayer[] = you.placed ? [you] : [];
  const everyone: Neighbour[] = creatures.map((c) => ({ id: c.id, x: c.body.x, y: c.body.y, z: c.body.z, hostile: c.stats.kind === "hostile" || c.state.target !== null }));
  for (const c of creatures) {
    c.prev.set(c.body.x, c.body.y, c.body.z);
    const ctx: BrainCtx = {
      world, table, gravity: std.balance.player.gravity, rand: Math.random, players, groundY,
      bite: (_id, dmg) => { you.health = Math.max(0, you.health - dmg); hurtFlash = 0.4; if (you.health <= 0) { you.health = 100; say("You were knocked out, and got back up"); } },
      warn: () => { if (soundOn) audio.fuse([c.body.x, c.body.y, c.body.z]); },
      fx: (f) => { fx(f); if (soundOn && f.phase === "hit") (f.kind === "stomp" ? audio.explosion(10) : audio.stinger("gathering")); },
      night: isNight(),
      kin: creatures.filter((o) => o.group === c.group && o !== c).map((o) => [o.body.x, o.body.y, o.body.z] as [number, number, number]),
      others: everyone.filter((o) => o.id !== c.id && Math.abs(o.x - c.body.x) < 16 && Math.abs(o.z - c.body.z) < 16),
    };
    stepSummon(c.spec, c.stats, c.body, c.state, ctx, dt);
    // Out of the meadow (or the world): back to its home.
    if (Math.hypot(c.body.x, c.body.z) > 34 || c.body.y < 0) { c.body.x = c.state.home[0]; c.body.z = c.state.home[2]; c.body.y = Math.max(c.state.home[1], 11); c.body.vx = c.body.vy = c.body.vz = 0; c.prev.set(c.body.x, c.body.y, c.body.z); }
  }
}

// ------------------------------------------------------------------ the frame
const clock = new THREE.Clock();
let acc = 0, hurtFlash = 0;
const danger = new THREE.Color(std.art.reserved.danger).multiplyScalar(0.8);
const skyDay = new THREE.Color(0x8fc3ea), skyDusk = new THREE.Color(0xe39a6b), skyNight = new THREE.Color(0x0d1630);
scene.fog = new THREE.Fog(0x8fc3ea, 40, 110);
function frame(): void {
  const dt = Math.min(0.1, clock.getDelta());
  acc += dt;
  while (acc >= 0.05) { tick(0.05); acc -= 0.05; }
  const k = acc / 0.05;
  // Sky and light by the time of day.
  const sunAngle = dayPhase * Math.PI * 2;
  const daylight = Math.max(0, Math.min(1, Math.sin(sunAngle) * 2.2 + 0.25));
  const dusk = Math.max(0, 1 - Math.abs(Math.sin(sunAngle)) * 4) * (daylight > 0 ? 1 : 0);
  const sky = skyNight.clone().lerp(skyDay, daylight).lerp(skyDusk, dusk * 0.6);
  scene.background = sky; (scene.fog as THREE.Fog).color.copy(sky);
  sun.position.set(Math.cos(sunAngle) * 40, Math.sin(sunAngle) * 50, 20);
  sun.intensity = 0.15 + daylight * 2.1;
  hemi.intensity = 0.25 + daylight * 0.85;
  setGlowStrength(1 - daylight * 0.85);
  for (const c of creatures) {
    const pos = c.prev.clone().lerp(new THREE.Vector3(c.body.x, c.body.y, c.body.z), k);
    const speed = c.prev.distanceTo(new THREE.Vector3(c.body.x, c.body.y, c.body.z)) / 0.05;
    c.root.position.copy(pos);
    c.root.rotation.order = "YXZ";
    c.root.rotation.y = c.state.yaw + Math.PI;
    c.root.rotation.x = c.spec.movement === "walk" ? 0 : -c.state.pitch;
    c.age += dt;
    let flags = c.state.flags;
    // A pose being shown on request: its warning, then the attack.
    let shownAttack: { kind: string; active: boolean } | null = null;
    if (c.showing) {
      c.showing.t += dt;
      if (c.showing.t > c.showing.warn + 1.2) c.showing = undefined;
      else { shownAttack = { kind: c.showing.kind, active: c.showing.t > c.showing.warn }; flags |= 4; }
    }
    const attack = shownAttack ?? attackFromFlags(flags);
    c.moving += (((flags & 2) || speed > 0.4 ? Math.min(1, speed / 4 + 0.3) : 0) - c.moving) * Math.min(1, dt * 8);
    c.swing += (((flags & 4) ? 1 : 0) - c.swing) * Math.min(1, dt * 6);
    const action = shownAttack ? null : actionFromFlags(flags);
    if (action !== c.action) { if (action === "roar" && soundOn) audio.roar(c.spec.length, [pos.x, pos.y, pos.z]); c.action = action; }
    // Looks at you when you're close and it's not busy.
    let look = 0;
    if (you.placed && (!action || action === "sit")) {
      const dx = you.x - pos.x, dz = you.z - pos.z, d = Math.hypot(dx, dz);
      if (d < 7 && d > 0.5) { let rel = Math.atan2(-dx, -dz) - c.state.yaw; while (rel > Math.PI) rel -= Math.PI * 2; while (rel < -Math.PI) rel += Math.PI * 2; if (Math.abs(rel) < 1.6) look = Math.max(-0.8, Math.min(0.8, rel)); }
    }
    c.look += (look - c.look) * Math.min(1, dt * 4);
    animateVoxelObject(c.obj, c.age, c.moving, c.spec.movement, c.swing, c.spec.gait, attack, { action, look: c.look });
    const warning = (flags & 4) !== 0;
    const pulse = 0.55 + 0.3 * Math.sin(performance.now() / 1000 * Math.PI * 4);
    for (const m of c.obj.materials) { if (warning) m.emissive.copy(danger).multiplyScalar(pulse); else m.emissive.setScalar(0); }
    if (action === "sleep" && Math.random() < dt * 0.8) burst(pos.x, pos.y + c.stats.height + 0.3, pos.z, "#ffffff", 1, 0.3);
    // Voices, now and then.
    if (soundOn && c.age > c.nextCall) {
      c.nextCall = c.age + (action === "sleep" ? 4 + Math.random() * 3 : 8 + Math.random() * 18);
      const voice = action === "sleep" ? "snore" : voiceOf(c.spec);
      if (voice) audio.call(voice, c.spec.length, [pos.x, pos.y, pos.z]);
    }
  }
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.life -= dt; s.v.y -= dt * 2;
    s.mesh.position.addScaledVector(s.v, dt);
    (s.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, s.life * 1.5);
    if (s.life <= 0) { scene.remove(s.mesh); (s.mesh.material as THREE.Material).dispose(); sparks.splice(i, 1); }
  }
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i]; r.t += dt;
    (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.35 * Math.sin(r.t * Math.PI * 4);
    if (r.t > r.seconds + 0.1) { scene.remove(r.mesh); rings.splice(i, 1); }
  }
  youMesh.visible = you.placed;
  youMesh.position.set(you.x, you.y, you.z);
  hurtFlash = Math.max(0, hurtFlash - dt);
  $("hurt").style.opacity = String(hurtFlash * 1.5);
  audio.listener = { x: controls.target.x, y: controls.target.y, z: controls.target.z, yaw: Math.atan2(-(controls.target.x - camera.position.x), -(controls.target.z - camera.position.z)) };
  controls.update();
  resize();
  renderer.render(scene, camera);
  updatePanel();
  requestAnimationFrame(frame);
}
function resize(): void {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
  }
}

// ------------------------------------------------------------------ picking, placing yourself
const raycaster = new THREE.Raycaster();
let selected: Creature | null = null;
let placing = false;
let downAt: [number, number] | null = null;
canvas.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener("pointerup", (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return; // a drag, not a click
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  if (placing) {
    // Where the ray meets the grass (y = 10).
    const t = (10 - raycaster.ray.origin.y) / raycaster.ray.direction.y;
    if (t > 0) {
      const p = raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, t);
      if (!inPond(Math.floor(p.x), Math.floor(p.z)) && Math.hypot(p.x, p.z) < 30) { you.x = p.x; you.z = p.z; you.y = 10; you.placed = true; say("You're standing in the meadow"); }
    }
    placing = false; $("place").setAttribute("aria-pressed", "false"); canvas.style.cursor = "";
    return;
  }
  const hits = raycaster.intersectObjects(creatures.map((c) => c.root), true);
  let hit: Creature | null = null;
  for (const h of hits) { let o: THREE.Object3D | null = h.object; while (o && o.userData.creature === undefined) o = o.parent; if (o) { hit = creatures.find((c) => c.id === o!.userData.creature) ?? null; break; } }
  select(hit);
});

// ------------------------------------------------------------------ the panel
function say(text: string): void { const el = $("status"); el.textContent = text; }
function doing(c: Creature): string {
  const s = c.state;
  if (c.showing) return c.showing.t > c.showing.warn ? `${c.showing.kind}!` : `warning: ${c.showing.kind}`;
  if (s.mode === "windup") return s.attack ? `warning: ${s.attack}` : "warning: bite";
  if (s.mode === "attack") return `${s.attack}!`;
  if (s.mode === "lunge") return "lunging";
  const a = actionFromFlags(s.flags);
  if (a) return ({ graze: "grazing", sniff: "sniffing about", sit: "sitting", roar: "roaring", sleep: "asleep", perch: "perched", breach: "leaping" } as Record<string, string>)[a];
  if (s.mode === "flee") return "running away";
  if (s.mode === "retreat") return "backing off";
  if (s.target !== null) return "hunting you";
  if (s.follow != null) return "following you";
  return (s.flags & 2) ? "wandering" : "resting";
}
function select(c: Creature | null): void {
  selected = c;
  $("notes").hidden = !c;
  $("notes-empty").hidden = !!c;
  if (!c) return;
  $("n-name").textContent = c.spec.name;
  const attacks = c.spec.abilities.filter((a) => a !== "rain");
  $("n-facts").innerHTML = [
    ["Character", c.spec.temperament === "hostile" ? "a hunter" : personalityOf(c.spec)],
    ["Temperament", c.spec.temperament],
    ["Moves", `${c.spec.movement}${c.spec.gait ? `, ${c.spec.gait}` : ""}`],
    ["Size", `${c.spec.length.toFixed(1)} blocks`],
    ["Attacks", attacks.length ? `${attacks.join(", ")}${attacks.some((a) => a === "breath" || a === "shot") ? ` (${elementOf(c.spec)})` : ""}` : "none"],
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  const actions = actionsFor(c.spec);
  $("n-actions").innerHTML = actions.length ? actions.map((a) => `<button type="button" class="chip" data-action="${a}">${a}</button>`).join("") : `<span class="muted">It drifts, swims or flies about; it has no idle poses of its own.</span>`;
  const shows = ["bite", "breath", "shot", "charge", "stomp"].filter((a) => c.spec.abilities.includes(a) || (a === "bite" && attacks.length === 0 && c.spec.temperament !== "passive"));
  $("n-attacks").innerHTML = (shows.length ? shows : ["bite", "breath", "shot", "charge", "stomp"]).map((a) => `<button type="button" class="chip warn" data-show="${a}">${a}</button>`).join("");
  $("n-attacks-note").textContent = shows.length ? "Its own attacks: the warning pose, then the strike." : "It has no attacks; these just show the poses.";
}
function updatePanel(): void {
  if (selected) $("n-doing").textContent = doing(selected);
  const hh = Math.round(((dayPhase + 0.25) % 1) * 24), mm = Math.floor(((((dayPhase + 0.25) % 1) * 24) % 1) * 60);
  $("clock").textContent = `${String(hh % 24).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  $<HTMLInputElement>("time").value = String(Math.round(dayPhase * 1000));
  $("health").style.width = `${you.health}%`;
  $("health-label").textContent = `${Math.round(you.health)} / 100`;
}
function renderList(): void {
  const counts = new Map<string, number>();
  for (const c of creatures) counts.set(c.spec.name, (counts.get(c.spec.name) ?? 0) + 1);
  $("count").textContent = `${creatures.length} / ${MAX}`;
  $("list").innerHTML = [...counts].map(([n, k]) => `<li><button type="button" class="link" data-pick="${n}">${n}</button>${k > 1 ? ` <span class="muted">×${k}</span>` : ""}</li>`).join("") || `<li class="muted">Nothing yet: add something above.</li>`;
}

$("n-actions").addEventListener("click", (e) => {
  const a = (e.target as HTMLElement).dataset.action as IdleAction | undefined;
  if (!a || !selected) return;
  const s = selected.state;
  if (a === "perch" || a === "breach") { s.left = 0; say(`${selected.spec.name} will ${a === "perch" ? "land" : "leap"} when it next gets the chance`); return; }
  startAction(s, a, a === "sleep" ? 12 : a === "roar" ? 1.2 : 5);
  s.left = 0; s.mode = "idle"; selected.body.vx = selected.body.vz = 0;
});
$("n-attacks").addEventListener("click", (e) => {
  const a = (e.target as HTMLElement).dataset.show;
  if (!a || !selected) return;
  const c = selected;
  c.showing = { kind: a, t: 0, warn: 1.1 };
  if (soundOn) audio.fuse([c.body.x, c.body.y, c.body.z]);
  const fwd = new THREE.Vector3(-Math.sin(c.state.yaw), 0, -Math.cos(c.state.yaw));
  const from: [number, number, number] = [c.body.x + fwd.x * c.stats.width * 0.6, c.body.y + c.stats.height * 0.75, c.body.z + fwd.z * c.stats.width * 0.6];
  const to: [number, number, number] = [from[0] + fwd.x * 7, from[1] - 0.6, from[2] + fwd.z * 7];
  const element = elementOf(c.spec);
  if (a === "stomp") fx({ kind: "stomp", element, phase: "warn", from: [c.body.x, c.body.y, c.body.z], to: [c.body.x, c.body.y, c.body.z], seconds: 1.1, radius: 3 });
  else if (a !== "bite") fx({ kind: a as AttackFx["kind"], element, phase: "warn", from, to, seconds: 1.1 });
  setTimeout(() => {
    if (a === "stomp") fx({ kind: "stomp", element, phase: "hit", from: [c.body.x, c.body.y, c.body.z], to: [c.body.x, c.body.y, c.body.z], seconds: 0, radius: 3 });
    else if (a !== "bite") fx({ kind: a as AttackFx["kind"], element, phase: "hit", from, to: a === "charge" ? [c.body.x + fwd.x * 6, c.body.y, c.body.z + fwd.z * 6] : to, seconds: a === "shot" ? 0.5 : 1 });
    if (soundOn) (a === "stomp" ? audio.explosion(8) : audio.stinger("gathering"));
  }, 1100);
});
$("n-follow").addEventListener("click", () => {
  if (!selected) return;
  if (!you.placed) { say("Stand in the meadow first (Place me)"); return; }
  selected.state.follow = selected.state.follow != null ? null : you.id;
  say(selected.state.follow != null ? `${selected.spec.name} follows you` : `${selected.spec.name} stays here`);
});
$("n-remove").addEventListener("click", () => { if (selected) remove(selected); });
$("list").addEventListener("click", (e) => {
  const n = (e.target as HTMLElement).dataset.pick;
  const c = n ? creatures.find((x) => x.spec.name === n) : null;
  if (c) { select(c); controls.target.set(c.body.x, c.body.y + 0.5, c.body.z); }
});
$<HTMLFormElement>("add").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>("prompt");
  const text = input.value.trim();
  if (!text) return;
  say(add(text));
  input.value = "";
});
$("examples").addEventListener("click", (e) => {
  const p = (e.target as HTMLElement).dataset.prompt;
  if (p) say(add(p));
});
$("time").addEventListener("input", (e) => { dayPhase = Number((e.target as HTMLInputElement).value) / 1000; });
$("pause").addEventListener("click", () => {
  timeRunning = !timeRunning;
  $("pause").setAttribute("aria-pressed", String(!timeRunning));
  $("pause").textContent = timeRunning ? "Pause time" : "Run time";
});
$("night").addEventListener("click", () => { dayPhase = isNight() ? 0.2 : 0.7; });
$("sound").addEventListener("click", () => {
  soundOn = !soundOn;
  if (soundOn) audio.unlock();
  $("sound").setAttribute("aria-pressed", String(soundOn));
  $("sound").textContent = soundOn ? "Sound on" : "Sound off";
});
$("place").addEventListener("click", () => {
  placing = !placing;
  $("place").setAttribute("aria-pressed", String(placing));
  canvas.style.cursor = placing ? "crosshair" : "";
  say(placing ? "Click the grass where you want to stand" : "");
});
$("hunt").addEventListener("change", (e) => {
  you.huntable = (e.target as HTMLInputElement).checked;
  say(you.huntable ? "Hunters can come for you now: watch for the warning flash and step aside" : "Hunters leave you alone");
});
$("clear").addEventListener("click", () => { for (const c of [...creatures]) remove(c); });

// A meadow to start with.
for (const p of ["four cows", "two eagles", "a fox", "three rabbits", "a dolphin", "an owl", "a dog"]) add(p);
say("A meadow with a herd, eagles, a fox, rabbits, a dolphin in the pond, an owl and a dog. Click a creature to see what it's up to.");
select(null);
frame();
