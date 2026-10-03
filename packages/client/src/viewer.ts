import * as THREE from "three";
import { DEFAULT_STANDARDS, shapeForSculpting, assetBudget, cloneStandards, meshModel, setRule, type ModelStyle, checkSummon, fitSpecToRules, generateModel, planScenario, planSummon, summonStats, modelStats, type SummonSpec } from "@lfg/shared";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { animateVoxelObject, buildVoxelObject, setEnvironment, setGlowStrength } from "./voxelMesh";

/**
 * Review page for generated summons (what an agent or a person looks at while
 * iterating): several angles, a silhouette at 20 m, and a scale check next to
 * a player and a tree. /viewer.html?prompt=a%20flying%20shark
 *
 * Scenario casts too: "<scenario> :: ship | grunt | brute | boss | final"
 * (e.g. "pirates raid in 5 waves with bosses :: final") shows that member.
 */
const params = new URLSearchParams(location.search);
const prompt = params.get("prompt") ?? "a flying shark";
// ?style=voxel|smooth|lowpoly draws it the way a world with that art.modelStyle would.
// #spec=<base64 JSON SummonSpec>&rules=<base64 JSON [path, value][]> shows a written design in a
// world's colours (the MCP render_design tool uses this; the hash never reaches a server).
const hash = new URLSearchParams(location.hash.slice(1));
const fromB64 = <T,>(v: string | null): T | undefined => {
  if (!v) return undefined;
  const bin = atob(v.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))) as T;
};
const std = cloneStandards(DEFAULT_STANDARDS);
for (const [path, value] of fromB64<[string, number | boolean | string][]>(hash.get("rules")) ?? []) {
  try { setRule(std, path, value); } catch { /* not a rule here */ }
}
const given = fromB64<SummonSpec>(hash.get("spec"));
// ?style= compares styles; otherwise the design's own style, then the world's.
const style = (params.get("style") ?? hash.get("style") ?? given?.style ?? (std.art as { modelStyle?: string }).modelStyle ?? "voxel") as ModelStyle;
setRule(std, "art.modelStyle", style);
const W = 1280, H = 800; // the report sits below the views
const canvas = document.getElementById("c") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setScissorTest(true);
setEnvironment(renderer, () => new RoomEnvironment());
setGlowStrength(0.12); // daylight: halos only hint
const labels = document.getElementById("labels")!;
const report = document.getElementById("report")!;

/** A member of a scenario's cast, as the scenario planner makes it. */
function scenarioMember(text: string, pick: string): { spec?: SummonSpec; notes: string[] } {
  const sc = planScenario(text, DEFAULT_STANDARDS).spec;
  if (!sc) return { notes: [`not a scenario: ${text}`] };
  const groups = sc.waves.flatMap((w) => w.groups.map((g) => g.spec));
  const bosses = sc.waves.flatMap((w) => (w.boss ? [w.boss] : []));
  const spec = pick === "ship" ? sc.ship : pick === "grunt" ? groups[0] : pick === "brute" ? groups.find((g) => g.length >= 3)
    : pick === "boss" ? bosses[0] : bosses[bosses.length - 1];
  return spec ? { spec: { ...spec, count: 1 }, notes: [`from the scenario "${text}"`] } : { notes: [`no ${pick} in that scenario`] };
}
const plan = given ? { spec: given, notes: [] as string[] } : prompt.includes(" :: ") ? scenarioMember(prompt.split(" :: ")[0], prompt.split(" :: ")[1].trim()) : planSummon(prompt);
if (!plan.spec) {
  report.textContent = plan.notes.join("\n");
  throw new Error("no spec");
}
const fitted = fitSpecToRules(plan.spec, std);
// Drawn (and checked) in the style being viewed; sculpted planned summons get their skill's shape, as in game.
const spec = style === "sculpted" && !given ? shapeForSculpting({ ...fitted.spec, style }, prompt, std) : { ...fitted.spec, style };
plan.notes.push(...fitted.notes.map((n) => `fitted to the rules: ${n}`));
const model = generateModel(spec, std);
const check = checkSummon(spec, model, std);
const budget = assetBudget(model, std)?.maxTris ?? Infinity;
const closeUp = { closeUpMultiplier: std.locked.closeUp.multiplier, closeUpBlocks: 1e6 };
const drawn = meshModel(model, style, budget, closeUp.closeUpMultiplier);
const stats = summonStats(spec, model, std);
const ms = modelStats(model);

const makeScene = (bg: number) => {
  const s = new THREE.Scene();
  s.background = new THREE.Color(bg);
  // Same lighting as the game at noon (see Renderer.setTime): ambient + sky/ground fill, sun, rim.
  s.add(new THREE.AmbientLight(0xffffff, Math.PI * 0.75 * 0.3));
  s.add(new THREE.HemisphereLight(0xdfeeff, 0x6b5a3a, Math.PI * 0.75 * 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, Math.PI * 0.55);
  sun.position.set(0.6, 1, 0.4);
  const rim = new THREE.DirectionalLight(0xfff2dc, Math.PI * 0.3);
  rim.position.set(-0.5, 0.8, -1);
  s.add(sun, rim);
  return s;
};

const scene = makeScene(0x8fb8e0);
const obj = buildVoxelObject(model, style, budget, closeUp);
const kind = spec.movement;
// ?t=<seconds> poses it mid-animation (moving), to check how it moves; otherwise a neutral pose.
const poseT = Number(params.get("t") ?? hash.get("t") ?? 0);
animateVoxelObject(obj, poseT, poseT ? 1 : 0, kind);
scene.add(obj.root);
/** A soft contact shadow under the model, as in game. */
const contactShadow = (size: number) => {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(0,0,0,0.55)"); grad.addColorStop(0.6, "rgba(0,0,0,0.3)"); grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.005;
  return m;
};
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshLambertMaterial({ color: 0x5da744 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.01;
scene.add(ground);
if (spec.movement === "walk" || spec.movement === "hover") scene.add(contactShadow(Math.max(ms.size[0], ms.size[2]) * 1.2));

// Silhouette scene: black shape on a light background, 20 m away.
const silScene = new THREE.Scene();
silScene.background = new THREE.Color(0xd9d6d4);
const sil = buildVoxelObject(model, style, budget);
animateVoxelObject(sil, 0, 0, kind);
sil.root.traverse((o) => { if (o instanceof THREE.Mesh) o.material = new THREE.MeshBasicMaterial({ color: 0x100f0e }); });
silScene.add(sil.root);

// Scale scene: a 1.8 m player and a 6-block tree next to it.
const scaleScene = makeScene(0x8fb8e0);
const big = buildVoxelObject(model, style, budget, closeUp);
animateVoxelObject(big, 0, 0, kind);
scaleScene.add(big.root);
const g2 = ground.clone();
scaleScene.add(g2);
const box = (w: number, h: number, d: number, color: number, x: number, y: number, z: number) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y + h / 2, z);
  scaleScene.add(m);
};
const [sx, sy, sz] = ms.size;
const px = sx / 2 + 1.2;
box(0.6, 0.75, 0.3, 0x2b5782, px, 0, 0); box(0.6, 0.6, 0.3, 0x3b75b0, px, 0.75, 0); box(0.5, 0.45, 0.5, 0xc4966e, px, 1.35, 0);
box(0.5, 4, 0.5, 0x503721, px + 2.2, 0, 0); box(3, 2.5, 3, 0x447b32, px + 2.2, 3.5, 0);

const R = Math.max(sx, sy, sz);
const centre = new THREE.Vector3(0, sy / 2, 0);
const views: { name: string; x: number; y: number; w: number; h: number; scene: THREE.Scene; cam: THREE.Camera }[] = [];
const persp = (pos: THREE.Vector3, target = centre, fov = 40) => {
  const c = new THREE.PerspectiveCamera(fov, 1, 0.05, 1000);
  c.position.copy(pos);
  c.lookAt(target);
  return c;
};
const d = R * 1.5 + 1.5;
views.push({ name: "3/4 front", x: 0, y: 400, w: 426, h: 400, scene, cam: persp(new THREE.Vector3(d * 0.7, sy / 2 + d * 0.35, d * 0.75)) });
views.push({ name: "side", x: 426, y: 400, w: 427, h: 400, scene, cam: persp(new THREE.Vector3(d, sy / 2, 0)) });
views.push({ name: "front (+Z)", x: 853, y: 400, w: 427, h: 400, scene, cam: persp(new THREE.Vector3(0, sy / 2, d)) });
views.push({ name: "top", x: 0, y: 0, w: 426, h: 400, scene, cam: persp(new THREE.Vector3(0.01, sy / 2 + d * 1.1, 0.01)) });
views.push({ name: "silhouette at 20 m", x: 426, y: 0, w: 427, h: 400, scene: silScene, cam: persp(new THREE.Vector3(14, sy / 2 + 2, 14), centre, 40) });
const scaleTarget = new THREE.Vector3(px / 2 + 1, Math.max(sy, 6) / 2, 0);
views.push({ name: "scale: player + tree", x: 853, y: 0, w: 427, h: 400, scene: scaleScene, cam: persp(new THREE.Vector3(px / 2 + 1, Math.max(sy, 6) / 2 + 1, Math.max(R, 7) * 1.9 + 4), scaleTarget) });

for (const v of views) {
  (v.cam as THREE.PerspectiveCamera).aspect = v.w / v.h;
  (v.cam as THREE.PerspectiveCamera).updateProjectionMatrix();
  const yTop = H - v.y - v.h;
  const l = document.createElement("div");
  l.textContent = v.name;
  l.style.cssText = `position:absolute;left:${v.x + 8}px;top:${yTop + 6}px;background:rgba(0,0,0,.5);padding:2px 6px;border-radius:3px`;
  labels.appendChild(l);
}

report.textContent = [
  given ? `${spec.name} (a written design${spec.shape ? `: ${spec.shape.parts.length} parts, ${spec.shape.parts.reduce((n, p) => n + (p.shapes?.length ?? 0), 0)} primitives` : ""})` : `"${prompt}"`,
  ...plan.notes,
  `${ms.size.map((v) => v.toFixed(1)).join(" × ")} blocks · voxel ${model.voxelSize} · ${model.parts.length} parts · ${style}${style !== "voxel" ? ` (${drawn.scale}× detail)` : ""}: ${drawn.triangles} tris (${check.stats.budget} ≤ ${check.stats.maxTriangles})${drawn.near ? ` · close up ${drawn.near.scale}×: ${drawn.near.triangles} tris (≤ ${check.stats.maxTriangles * std.locked.closeUp.multiplier})` : ""}`,
  `${stats.kind} · hp ${stats.health} · ${stats.slamRadius ? `slam ${stats.damage} in a ${stats.slamRadius}-block ring` : `bite ${stats.damage}`} after ${stats.telegraph}s warning · speed ${stats.speed.toFixed(1)} m/s`,
  `colours: ${ms.colors.join(" ")}`,
  ...check.errors.map((e) => `ERROR: ${e}`),
  ...check.warnings.map((w) => `warning: ${w}`),
  check.ok ? "checks: OK" : "checks: FAILED",
].join("\n");

for (const v of views) {
  renderer.setViewport(v.x, v.y, v.w, v.h);
  renderer.setScissor(v.x, v.y, v.w, v.h);
  renderer.render(v.scene, v.cam);
}
Object.assign(window, { viewerReady: true, viewerReport: { ok: check.ok, errors: check.errors, warnings: check.warnings, size: ms.size, style, detail: drawn.scale, triangles: drawn.triangles, closeUp: drawn.near ? { detail: drawn.near.scale, triangles: drawn.near.triangles } : null, budget: check.stats.budget, maxTriangles: check.stats.maxTriangles, stats } });
