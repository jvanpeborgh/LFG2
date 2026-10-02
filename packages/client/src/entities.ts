import * as THREE from "three";
import { generateModel, type BlockDef, type EntitySpawn, type EntityTypeDef, type ModelPart, type Registry, type Standards, type VoxelModel } from "@lfg/shared";
import { ATLAS_TILES, type Atlas } from "./atlas";
import { animateVoxelObject, buildVoxelObject, type VoxelObject } from "./voxelMesh";

interface View {
  id: number;
  type: EntityTypeDef;
  root: THREE.Group;
  body: THREE.Group;
  parts: Map<string, THREE.Object3D>;
  materials: THREE.MeshLambertMaterial[];
  pos: THREE.Vector3;
  target: THREE.Vector3;
  yaw: number;
  targetYaw: number;
  pitch: number;
  flags: number;
  walk: number;
  moving: number;
  swing: number;
  hurt: number;
  spin: number;
  name?: string;
  label?: THREE.Sprite;
  /** Generated summons. */
  voxel?: VoxelObject;
  age: number;
}

export interface EntityEffects {
  /** Rain falling from a cloud covering w × d blocks around (x, z), from height y. */
  rain(x: number, y: number, z: number, w: number, d: number): void;
}

const PX = 1 / 16;

/** Renders all entities the server tells us about, with interpolation and simple animations. */
export class EntityRenderer {
  readonly group = new THREE.Group();
  private views = new Map<number, View>();
  private faceTextures = new Map<string, THREE.Texture>();
  private get danger(): THREE.Color {
    return new THREE.Color(this.std.art.reserved.danger).multiplyScalar(0.8);
  }
  selfId = -1;

  private models = new Map<string, VoxelModel>();

  constructor(
    private reg: Registry,
    private atlas: Atlas,
    private atlasTexture: THREE.Texture,
    private std: Standards,
    private effects?: EntityEffects,
  ) {}

  spawn(list: EntitySpawn[]): void {
    for (const s of list) {
      if (this.views.has(s.id)) this.remove(s.id);
      const type = this.reg.entityTypes.get(s.type);
      if (!type) continue;
      const v = this.build(s, type);
      this.views.set(s.id, v);
      this.group.add(v.root);
    }
  }

  despawn(ids: number[]): void {
    for (const id of ids) this.remove(id);
  }

  private remove(id: number): void {
    const v = this.views.get(id);
    if (!v) return;
    this.group.remove(v.root);
    v.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    for (const m of v.materials) m.dispose();
    this.views.delete(id);
  }

  /** Apply a moves packet: [id, x, y, z, yaw, pitch, flags] × n */
  moves(e: number[]): void {
    for (let i = 0; i + 6 < e.length; i += 7) {
      const v = this.views.get(e[i]);
      if (!v) continue;
      v.target.set(e[i + 1], e[i + 2], e[i + 3]);
      v.targetYaw = e[i + 4];
      v.pitch = e[i + 5];
      v.flags = e[i + 6];
    }
  }

  event(id: number, event: string): void {
    const v = this.views.get(id);
    if (!v) return;
    if (event === "hurt") v.hurt = 0.35;
    if (event === "swing") v.swing = 0.35;
  }

  get(id: number): { x: number; y: number; z: number; type: EntityTypeDef; name?: string } | undefined {
    const v = this.views.get(id);
    return v ? { x: v.pos.x, y: v.pos.y, z: v.pos.z, type: v.type, name: v.name } : undefined;
  }

  /** Entities as boxes, for targeting with the crosshair. */
  *boxes(): Generator<{ id: number; minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number; kind: string }> {
    for (const v of this.views.values()) {
      const hw = v.type.width / 2;
      yield { id: v.id, minX: v.pos.x - hw, minY: v.pos.y, minZ: v.pos.z - hw, maxX: v.pos.x + hw, maxY: v.pos.y + v.type.height, maxZ: v.pos.z + hw, kind: v.type.kind };
    }
  }

  get count(): number {
    return this.views.size;
  }

  update(dt: number, camera: THREE.Camera): void {
    const k = 1 - Math.exp(-dt * 14);
    for (const v of this.views.values()) {
      const before = v.pos.clone();
      v.pos.lerp(v.target, k);
      let dy = v.targetYaw - v.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      v.yaw += dy * k;
      v.root.position.copy(v.pos);
      const speed = before.distanceTo(v.pos) / Math.max(dt, 1e-3);
      v.moving += ((v.flags & 2 || speed > 0.5 ? Math.min(1, speed / 4 + 0.3) : 0) - v.moving) * Math.min(1, dt * 8);
      v.walk += dt * (4 + speed * 2.5) * (v.moving > 0.05 ? 1 : 0);

      if (v.type.kind === "item") {
        v.spin += dt * 1.6;
        v.body.rotation.y = v.spin;
        v.body.position.y = 0.15 + Math.sin(v.spin * 1.5) * 0.06;
        continue;
      }
      v.age += dt;
      if (v.voxel && v.type.summon) {
        const spec = v.type.summon;
        v.body.rotation.order = "YXZ";
        v.body.rotation.y = v.yaw + Math.PI;
        v.body.rotation.x = spec.movement === "walk" ? 0 : -v.pitch; // flyers and swimmers tilt up and down
        animateVoxelObject(v.voxel, v.age, v.moving, spec.movement);
        // Floaters bob gently.
        v.body.position.y = spec.movement === "drift" ? Math.sin(v.age * 0.5) * 0.25 : spec.movement === "hover" ? Math.sin(v.age * 1.6) * 0.15 : 0;
        // Telegraph: hunters flash in the danger colour (docs/standards: reserved "danger" means "this hurts").
        // Clouds glow softly (they scatter light), so their undersides aren't dull grey.
        // A steady 2 Hz pulse that never goes fully dark: readable, and under the 3-flashes-per-second
        // photosensitivity limit (docs/standards/ux-accessibility-and-comfort.md, locked).
        const warning = (v.flags & 4) !== 0;
        const pulse = 0.55 + 0.3 * Math.sin((performance.now() / 1000) * Math.PI * 2 * 2);
        const glow = spec.body === "cloud" ? (spec.features.includes("storm") ? 0.12 : 0.4) : 0;
        for (const m of v.materials) {
          if (v.hurt > 0) m.emissive.setRGB(0.55, 0, 0);
          else if (warning) m.emissive.copy(this.danger).multiplyScalar(pulse);
          else m.emissive.setScalar(glow);
        }
        v.hurt = Math.max(0, v.hurt - dt);
        if ((v.flags & 8) && this.effects) this.effects.rain(v.pos.x, v.pos.y, v.pos.z, spec.length * 0.8, spec.length * 0.4);
        continue;
      }
      v.body.rotation.y = v.yaw + Math.PI; // models face +Z; yaw 0 faces -Z
      const swingA = Math.sin(v.walk) * 0.75 * v.moving;
      for (const [name, part] of v.parts) {
        if (name === "legL") part.rotation.x = swingA;
        else if (name === "legR") part.rotation.x = -swingA;
        else if (name === "armL") part.rotation.x = v.type.tags.includes("armsForward") ? -Math.PI / 2 + swingA * 0.15 : -swingA;
        else if (name === "armR") {
          const base = v.type.tags.includes("armsForward") ? -Math.PI / 2 - swingA * 0.15 : swingA;
          part.rotation.x = v.swing > 0 ? base - Math.sin((v.swing / 0.35) * Math.PI) * 1.4 : base;
        } else if (name === "head") part.rotation.x = -v.pitch * 0.8;
        else if (name === "wingL") part.rotation.z = v.moving > 0.1 ? -Math.abs(Math.sin(v.walk * 3)) * 0.8 : 0;
        else if (name === "wingR") part.rotation.z = v.moving > 0.1 ? Math.abs(Math.sin(v.walk * 3)) * 0.8 : 0;
      }
      v.swing = Math.max(0, v.swing - dt);
      v.hurt = Math.max(0, v.hurt - dt);
      // Creeper fuse / primed TNT: flash white and swell.
      const fusing = (v.flags & 4) !== 0;
      const blink = fusing && Math.floor(performance.now() / 200) % 2 === 0;
      for (const m of v.materials) m.emissive.setRGB(v.hurt > 0 ? 0.55 : blink ? 0.7 : 0, blink ? 0.7 : 0, blink ? 0.7 : 0);
      const swell = fusing && v.type.kind === "hostile" ? 1.08 : 1;
      v.body.scale.setScalar(swell * ((v.body.userData.scale as number) ?? 1));
      if (v.label) {
        // Hide name tags right next to the camera (e.g. two players on the same spot).
        v.label.visible = v.pos.distanceTo(camera.position) > 2.5;
        v.label.lookAt(camera.position);
      }
    }
  }

  private build(s: EntitySpawn, type: EntityTypeDef): View {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const parts = new Map<string, THREE.Object3D>();
    const materials: THREE.MeshLambertMaterial[] = [];
    const v: View = {
      id: s.id, type, root, body, parts, materials,
      pos: new THREE.Vector3(s.x, s.y, s.z), target: new THREE.Vector3(s.x, s.y, s.z),
      yaw: s.yaw, targetYaw: s.yaw, pitch: 0, flags: 0, walk: 0, moving: 0, swing: 0, hurt: 0, spin: Math.random() * 6, name: s.name,
      age: Math.random() * 10,
    };
    root.position.copy(v.pos);

    if (type.kind === "item" && s.item !== undefined) {
      const item = this.reg.itemById(s.item);
      const block = item?.block !== undefined ? this.reg.blockById(item.block) : undefined;
      if (block && block.render !== "cross") {
        const mesh = this.blockCube(block, 0.28, materials);
        body.add(mesh);
      } else {
        const tex = new THREE.TextureLoader().load(this.atlas.icon(s.item));
        tex.magFilter = THREE.NearestFilter;
        tex.colorSpace = THREE.SRGBColorSpace;
        const mat = new THREE.MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
        materials.push(mat);
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), mat);
        plane.position.y = 0.2;
        body.add(plane);
      }
      return v;
    }
    if (type.summon) {
      // Same spec + same palette → the same model the server checked.
      let model = this.models.get(type.name);
      if (!model) { model = generateModel(type.summon, this.std); this.models.set(type.name, model); }
      v.voxel = buildVoxelObject(model);
      materials.push(...v.voxel.materials);
      body.add(v.voxel.root);
      return v;
    }
    if (type.tags.includes("block") && s.block !== undefined) {
      const mesh = this.blockCube(this.reg.blockById(s.block), 0.98, materials);
      mesh.position.y = 0.49;
      body.add(mesh);
      return v;
    }

    // Box model from the shared definition.
    const modelHeight = Math.max(...type.model.map((p) => p.pivot[1] + p.offset[1] + p.size[1]));
    const scale = type.height / (modelHeight * PX);
    body.userData.scale = scale;
    body.scale.setScalar(scale);
    for (const part of type.model) {
      const pivot = new THREE.Group();
      pivot.position.set(part.pivot[0] * PX, part.pivot[1] * PX, part.pivot[2] * PX);
      const mats = this.partMaterials(type, part);
      materials.push(...mats);
      const box = new THREE.Mesh(new THREE.BoxGeometry(part.size[0] * PX, part.size[1] * PX, part.size[2] * PX), mats);
      box.position.set((part.offset[0] + part.size[0] / 2) * PX, (part.offset[1] + part.size[1] / 2) * PX, (part.offset[2] + part.size[2] / 2) * PX);
      pivot.add(box);
      body.add(pivot);
      if (part.anim) parts.set(part.anim, pivot);
    }
    if (s.name) {
      v.label = this.nameTag(s.name);
      v.label.position.y = type.height + 0.45;
      root.add(v.label);
    }
    return v;
  }

  private partMaterials(type: EntityTypeDef, part: ModelPart): THREE.MeshLambertMaterial[] {
    const base = new THREE.MeshLambertMaterial({ color: part.color });
    const shadeTop = new THREE.MeshLambertMaterial({ color: new THREE.Color(part.color).multiplyScalar(1.08) });
    const list = [base, base, shadeTop, base, base, base];
    if (part.frontColor) {
      const face = new THREE.MeshLambertMaterial({ map: this.faceTexture(type, part) });
      list[4] = face; // +Z face
    }
    return list;
  }

  /** A tiny pixel face: eyes, plus a snout for animals and the classic creeper frown. */
  private faceTexture(type: EntityTypeDef, part: ModelPart): THREE.Texture {
    const key = `${type.name}:${part.name}`;
    const have = this.faceTextures.get(key);
    if (have) return have;
    const c = document.createElement("canvas");
    c.width = c.height = 8;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = part.color;
    ctx.fillRect(0, 0, 8, 8);
    const px = (x: number, y: number, w: number, h: number, color: string) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
    if (type.name === "creeper") {
      px(1, 2, 2, 2, "#111"); px(5, 2, 2, 2, "#111"); px(3, 4, 2, 2, "#111"); px(2, 5, 1, 2, "#111"); px(5, 5, 1, 2, "#111");
    } else if (type.kind === "passive") {
      px(1, 2, 1, 1, "#111"); px(6, 2, 1, 1, "#111");
      if (type.name === "chicken") { px(2, 4, 4, 1, part.frontColor!); px(3, 5, 2, 1, "#c33"); }
      else { px(2, 4, 4, 3, part.frontColor!); px(3, 5, 1, 1, "#4a2a2a"); px(5, 5, 1, 1, "#4a2a2a"); }
    } else {
      px(1, 3, 2, 1, "#fff"); px(5, 3, 2, 1, "#fff"); px(2, 3, 1, 1, "#2b4a8a"); px(5, 3, 1, 1, "#2b4a8a");
      px(3, 5, 2, 1, part.frontColor!);
      if (type.name === "player") px(0, 0, 8, 2, "#3b2a1c");
    }
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    this.faceTextures.set(key, tex);
    return tex;
  }

  private blockCube(block: BlockDef, size: number, materials: THREE.MeshLambertMaterial[]): THREE.Mesh {
    const g = new THREE.BoxGeometry(size, size, size);
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z; 4 vertices each.
    const faces = [block.faces.side, block.faces.side, block.faces.top, block.faces.bottom, block.faces.front ?? block.faces.side, block.faces.side];
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    for (let f = 0; f < 6; f++) {
      const t = this.atlas.tile(faces[f]);
      const u0 = (t % ATLAS_TILES) / ATLAS_TILES, v0 = Math.floor(t / ATLAS_TILES) / ATLAS_TILES, d = 1 / ATLAS_TILES;
      for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        uv.setXY(i, u0 + uv.getX(i) * d, v0 + (1 - uv.getY(i)) * d);
      }
    }
    uv.needsUpdate = true;
    const mat = new THREE.MeshLambertMaterial({ map: this.atlasTexture, alphaTest: 0.5, transparent: block.render === "translucent" });
    materials.push(mat);
    return new THREE.Mesh(g, mat);
  }

  private nameTag(text: string): THREE.Sprite {
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d")!;
    ctx.font = "bold 28px system-ui, sans-serif";
    const w = Math.ceil(ctx.measureText(text).width) + 20;
    c.width = w;
    c.height = 40;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, 0, w, 40);
    ctx.font = "bold 28px system-ui, sans-serif";
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 10, 21);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
    sprite.scale.set(w / 80, 0.5, 1);
    return sprite;
  }
}
