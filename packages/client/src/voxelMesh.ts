import * as THREE from "three";
import { greedyMesh, type VoxelModel } from "@lfg/shared";

export interface VoxelObject {
  root: THREE.Group;
  /** Pivot groups by animation role. */
  parts: Map<string, THREE.Group[]>;
  materials: THREE.MeshLambertMaterial[];
}

const tmp = new THREE.Color();

/** Turn a generated voxel model into Three.js meshes: one pivot group per part, greedy-meshed. */
export function buildVoxelObject(model: VoxelModel): VoxelObject {
  const root = new THREE.Group();
  const parts = new Map<string, THREE.Group[]>();
  const materials: THREE.MeshLambertMaterial[] = [];
  const vs = model.voxelSize;
  for (const part of model.parts) {
    const m = greedyMesh(part.grid);
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
    g.setIndex(new THREE.BufferAttribute(m.indices, 1));
    g.computeBoundingSphere();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    materials.push(mat);
    const mesh = new THREE.Mesh(g, mat);
    mesh.scale.setScalar(vs);
    mesh.position.set((part.origin[0] - part.pivot[0]) * vs, (part.origin[1] - part.pivot[1]) * vs, (part.origin[2] - part.pivot[2]) * vs);
    const pivot = new THREE.Group();
    pivot.position.set(part.pivot[0] * vs, part.pivot[1] * vs, part.pivot[2] * vs);
    pivot.add(mesh);
    root.add(pivot);
    const role = part.anim ?? "static";
    parts.set(role, [...(parts.get(role) ?? []), pivot]);
  }
  return { root, parts, materials };
}

/**
 * Pose a voxel object for time t: tails sway, fins and wings flap, legs walk,
 * the body bobs or banks. `moving` (0..1) scales walk/swim motion.
 */
export function animateVoxelObject(o: VoxelObject, t: number, moving: number, kind: "swim" | "fly" | "walk" | "drift" | "hover"): void {
  const sway = Math.sin(t * (kind === "swim" || kind === "fly" ? 5 : 3));
  for (const p of o.parts.get("tail") ?? []) p.rotation.y = sway * (0.25 + 0.25 * moving);
  for (const p of o.parts.get("finL") ?? []) p.rotation.z = -0.25 + Math.sin(t * 3) * 0.12;
  for (const p of o.parts.get("finR") ?? []) p.rotation.z = 0.25 - Math.sin(t * 3) * 0.12;
  const flap = kind === "fly" ? Math.sin(t * 6) * (0.4 + 0.3 * moving) : 0;
  for (const p of o.parts.get("wingL") ?? []) p.rotation.z = flap;
  for (const p of o.parts.get("wingR") ?? []) p.rotation.z = -flap;
  const step = Math.sin(t * 8) * 0.6 * moving;
  for (const p of o.parts.get("legL") ?? []) p.rotation.x = step;
  for (const p of o.parts.get("legR") ?? []) p.rotation.x = -step;
  // Swimmers and flyers flex their body against the tail (bobbing is applied to the whole object by the caller).
  if (kind === "swim" || kind === "fly") for (const p of o.parts.get("body") ?? []) p.rotation.y = -sway * 0.06 * (0.5 + moving);
}
