import type { Standards } from "./standards";

/**
 * Epic builds (docs/standards/progression-and-power.md §5): houses, towers,
 * villages, castles and whole cities raised into the real terrain, with
 * villagers. Pure and deterministic: a spec plus the terrain gives the same
 * blocks every time, so the server can check a build before it arrives and
 * restore the land exactly when it fades.
 */

export type BuildKind = "hut" | "house" | "tower" | "village" | "castle" | "city";

export interface BuildSpec {
  kind: BuildKind;
  title: string;
  tier: number;
  /** Side of the square region it claims (blocks). */
  size: number;
  style: "wood" | "stone" | "sandstone" | "brick";
  /** Built into a slope (terraces) rather than on flat land. */
  mountain: boolean;
  villagers: number;
  seed: number;
}

interface KindDef { kind: BuildKind; words: RegExp; tier: number; size: number; villagers: number; title: string }

const KINDS: KindDef[] = [
  { kind: "city", words: /\b(city|cities|metropolis|kingdom|civili[sz]ation|empire|capital|citadel)\b/, tier: 5, size: 96, villagers: 12, title: "City" },
  { kind: "castle", words: /\b(castle|fortress|fort|stronghold|palace)\b/, tier: 4, size: 44, villagers: 4, title: "Castle" },
  { kind: "village", words: /\b(village|town|hamlet|settlement)\b/, tier: 4, size: 44, villagers: 6, title: "Village" },
  { kind: "tower", words: /\b(tower|lighthouse|watchtower|spire|wizard'?s? tower)\b/, tier: 3, size: 14, villagers: 0, title: "Tower" },
  { kind: "house", words: /\b(house|home|cottage|manor|mansion)\b/, tier: 2, size: 14, villagers: 0, title: "House" },
  { kind: "hut", words: /\b(hut|cabin|shack|shed|shelter)\b/, tier: 2, size: 10, villagers: 0, title: "Hut" },
];

/** The kinds of build the planner knows. */
export function buildCatalog(): { kind: BuildKind; tier: number; size: number; villagers: number }[] {
  return KINDS.map((k) => ({ kind: k.kind, tier: k.tier, size: k.size, villagers: k.villagers }));
}

export function looksLikeBuild(text: string): boolean {
  const t = text.toLowerCase();
  return KINDS.some((k) => k.words.test(t));
}

export function planBuild(text: string, std: Standards): BuildSpec | null {
  const t = text.toLowerCase();
  const def = KINDS.find((k) => k.words.test(t));
  if (!def) return null;
  const style: BuildSpec["style"] = /\b(desert|sand(stone)?)\b/.test(t) ? "sandstone" : /\b(brick|red)\b/.test(t) ? "brick"
    : /\b(stone|castle|fort|grey|gray|dwar\w*)\b/.test(t) || def.kind === "castle" || def.kind === "tower" ? "stone" : "wood";
  const mountain = /\b(mountain\w*|hill\w*|cliff\w*|slope|terrace\w*)\b/.test(t);
  const area = std.progression.epicBuild.maxAreaByTier[def.tier - 1] || def.size;
  const name = t.match(/\b(?:called|named) ([a-z][a-z ]{1,20})$/)?.[1];
  let h = 2166136261;
  for (const c of t) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const adjective = mountain && (def.kind === "city" || def.kind === "village" || def.kind === "castle") ? "Mountain " : style === "sandstone" ? "Desert " : "";
  return {
    kind: def.kind, tier: def.tier, size: Math.min(def.size, area), style, mountain,
    villagers: def.villagers, seed: h >>> 0,
    title: name ? name.replace(/\b\w/g, (c) => c.toUpperCase()) : `${adjective}${def.title}`,
  };
}

/** The biggest build a tier allows instead (a village becomes a house at tier 2). */
export function scaleBuildToTier(spec: BuildSpec, tier: number, std: Standards): BuildSpec | null {
  if (spec.tier <= tier) return spec;
  const lesser = [...KINDS].filter((k) => k.tier <= tier).sort((a, b) => b.tier - a.tier)[0];
  if (!lesser) return null;
  const s = planBuild(lesser.title, std)!;
  return { ...s, style: spec.style, seed: spec.seed, title: `${spec.style === "sandstone" ? "Desert " : ""}${lesser.title}` };
}

// ------------------------------------------------------------------ generation

export interface BuildTerrain {
  /** y of the highest natural ground block (not trees or plants), or -1. */
  ground(x: number, z: number): number;
  /** y of the highest block of any kind (trees included). */
  top(x: number, z: number): number;
  /** The ground is under water here. */
  water(x: number, z: number): boolean;
}

export interface BuildPlan {
  /** Blocks to set: x, y, z, block id (later entries win). */
  blocks: Map<string, number>;
  /** Doors (outside the door, on the ground) for villagers to walk between. */
  doors: [number, number, number][];
  /** Where the build's centre is, on the ground. */
  center: [number, number, number];
}

type Ids = Record<"air" | "grass" | "dirt" | "stone" | "cobblestone" | "planks" | "log" | "glass" | "torch" | "stone_bricks" | "bricks" | "sandstone" | "gravel" | "water" | "wool" | "sand", number>;

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

/** Generate a build whose region's north-west corner is (x0, z0). */
export function generateBuild(spec: BuildSpec, x0: number, z0: number, terrain: BuildTerrain, ids: Ids): BuildPlan {
  let r = spec.seed || 1;
  const rand = () => ((r = Math.imul(r ^ (r >>> 15), 2246822519) + 0x9e3779b9 | 0) >>> 0) / 4294967296;
  const blocks = new Map<string, number>();
  const set = (x: number, y: number, z: number, id: number) => blocks.set(key(x, y, z), id);
  const doors: [number, number, number][] = [];
  const S = spec.size;
  const wall = spec.style === "stone" ? ids.stone_bricks : spec.style === "brick" ? ids.bricks : spec.style === "sandstone" ? ids.sandstone : ids.planks;
  const corner = spec.style === "wood" ? ids.log : spec.style === "sandstone" ? ids.sandstone : ids.stone_bricks;
  const roofId = spec.style === "sandstone" ? ids.sandstone : spec.style === "wood" ? ids.log : ids.bricks;
  const found = spec.style === "sandstone" ? ids.sandstone : ids.cobblestone;

  // ---- the land: level it (terraces on slopes) and clear trees
  const H = new Map<string, number>();
  const hk = (x: number, z: number) => `${x},${z}`;
  const ground = (x: number, z: number) => terrain.ground(x, z);
  let minG = Infinity, maxG = -Infinity;
  for (let x = x0; x < x0 + S; x++) for (let z = z0; z < z0 + S; z++) { const g = ground(x, z); minG = Math.min(minG, g); maxG = Math.max(maxG, g); }
  const step = spec.mountain || maxG - minG > 8 ? 4 : 0;
  const flatLevel = Math.round([...Array(9)].map((_, i) => ground(x0 + ((i % 3) + 0.5) * S / 3 | 0, z0 + ((Math.floor(i / 3)) + 0.5) * S / 3 | 0)).sort((a, b) => a - b)[4]);
  const level = (x: number, z: number) => {
    const g = ground(x, z);
    if (step) return minG + Math.round((g - minG) / step) * step;
    return flatLevel;
  };
  // Smooth terraces into blocks of 6×6 cells so houses sit on flat ground.
  for (let x = x0; x < x0 + S; x++) for (let z = z0; z < z0 + S; z++) {
    const cx = x0 + Math.floor((x - x0) / 6) * 6 + 3, cz = z0 + Math.floor((z - z0) / 6) * 6 + 3;
    H.set(hk(x, z), step ? level(Math.min(x0 + S - 1, cx), Math.min(z0 + S - 1, cz)) : flatLevel);
  }
  const h = (x: number, z: number) => H.get(hk(x, z)) ?? flatLevel;
  for (let x = x0; x < x0 + S; x++) for (let z = z0; z < z0 + S; z++) {
    const target = h(x, z), g = ground(x, z), top = Math.max(terrain.top(x, z), g);
    // Fill up to the level (retaining walls show at terrace edges), clear everything above.
    // Raised ground gets a retaining wall where it drops to a lower terrace; the top is grass (sand in the desert).
    const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => h(x + dx, z + dz) < target);
    const retain = wall === ids.planks ? ids.cobblestone : wall;
    for (let y = g + 1; y < target; y++) set(x, y, z, edge ? retain : ids.dirt);
    if (target > g && edge) set(x, target, z, retain);
    else set(x, target, z, spec.style === "sandstone" ? ids.sand : ids.grass);
    for (let y = target + 1; y <= Math.max(top, target + 1); y++) set(x, y, z, ids.air);
    if (g > target) for (let y = target + 1; y <= g; y++) set(x, y, z, ids.air);
  }

  // ---- pieces
  const house = (hx: number, hz: number, w: number, d: number, facing: 0 | 1 | 2 | 3, floors = 1) => {
    const y0 = h(hx + (w >> 1), hz + (d >> 1));
    const height = 4 * floors;
    for (let x = hx; x < hx + w; x++) for (let z = hz; z < hz + d; z++) {
      for (let y = y0 - 3; y <= y0; y++) if (y <= y0 && (y === y0 || !blocks.has(key(x, y, z)) || blocks.get(key(x, y, z)) === ids.air)) set(x, y, z, found);
      set(x, y0, z, ids.planks);
      const edgeX = x === hx || x === hx + w - 1, edgeZ = z === hz || z === hz + d - 1;
      for (let y = y0 + 1; y <= y0 + height; y++) {
        if (edgeX && edgeZ) set(x, y, z, corner);
        else if (edgeX || edgeZ) {
          const window = (y - y0) % 4 === 2 && ((edgeX && (z - hz) % 3 === 1) || (edgeZ && (x - hx) % 3 === 1));
          set(x, y, z, window ? ids.glass : wall);
        } else set(x, y, z, (y - y0) % 4 === 0 ? ids.planks : ids.air);
      }
    }
    // Roof: a stepped pyramid.
    for (let k = 0; k <= Math.ceil(Math.min(w, d) / 2); k++)
      for (let x = hx - 1 + k; x <= hx + w - k; x++) for (let z = hz - 1 + k; z <= hz + d - k; z++)
        if (x === hx - 1 + k || x === hx + w - k || z === hz - 1 + k || z === hz + d - k) set(x, y0 + height + 1 + k, z, roofId);
    // Door (2 high) in the middle of the facing side, a torch inside.
    const [dx, dz, ox, oz] = facing === 0 ? [hx + (w >> 1), hz + d - 1, 0, 1] : facing === 1 ? [hx + (w >> 1), hz, 0, -1] : facing === 2 ? [hx + w - 1, hz + (d >> 1), 1, 0] : [hx, hz + (d >> 1), -1, 0];
    set(dx, y0 + 1, dz, ids.air); set(dx, y0 + 2, dz, ids.air);
    set(hx + 1, y0 + 1, hz + 1, ids.torch);
    doors.push([dx + ox + 0.5, h(dx + ox, dz + oz) + 1, dz + oz + 0.5]);
  };
  const tower = (tx: number, tz: number, w: number, height: number) => {
    const y0 = h(tx + (w >> 1), tz + (w >> 1));
    for (let x = tx; x < tx + w; x++) for (let z = tz; z < tz + w; z++) {
      for (let y = y0 - 3; y <= y0; y++) set(x, y, z, found);
      const edge = x === tx || x === tx + w - 1 || z === tz || z === tz + w - 1;
      for (let y = y0 + 1; y <= y0 + height; y++) set(x, y, z, edge ? ((y - y0) % 5 === 3 && (x === tx + (w >> 1) || z === tz + (w >> 1)) ? ids.glass : ids.stone_bricks) : ids.air);
      if (edge && (x + z) % 2 === 0) set(x, y0 + height + 1, z, ids.stone_bricks); // battlements
      set(x, y0 + height, z, edge ? ids.stone_bricks : ids.planks);
    }
    // A spiral of steps up the inside (each 1 higher), then a hatch to the roof.
    const inner: [number, number][] = [];
    for (let x = tx + 1; x < tx + w - 1; x++) inner.push([x, tz + 1]);
    for (let z = tz + 2; z < tz + w - 1; z++) inner.push([tx + w - 2, z]);
    for (let x = tx + w - 3; x > tx; x--) inner.push([x, tz + w - 2]);
    for (let z = tz + w - 3; z > tz + 1; z--) inner.push([tx + 1, z]);
    for (let y = 1, i = 0; y < height; y++, i++) { const [sx, sz] = inner[i % inner.length]; set(sx, y0 + y, sz, ids.cobblestone); }
    const [lx, lz] = inner[(height - 2) % inner.length];
    set(lx, y0 + height, lz, ids.air);
    set(tx + (w >> 1), y0 + 1, tz + w - 1, ids.air); set(tx + (w >> 1), y0 + 2, tz + w - 1, ids.air);
    set(tx + (w >> 1), y0 + 1, tz + 1, ids.torch);
    doors.push([tx + (w >> 1) + 0.5, h(tx + (w >> 1), tz + w) + 1, tz + w + 0.5]);
  };
  const well = (cx: number, cz: number) => {
    const y = h(cx, cz);
    for (let x = cx - 1; x <= cx + 1; x++) for (let z = cz - 1; z <= cz + 1; z++) {
      set(x, y, z, x === cx && z === cz ? ids.water : ids.cobblestone);
      if (x !== cx || z !== cz) set(x, y + 1, z, ids.cobblestone);
    }
    set(cx, y - 1, cz, ids.cobblestone);
  };
  const lamp = (x: number, z: number) => { const y = h(x, z); set(x, y + 1, z, ids.log); set(x, y + 2, z, ids.log); set(x, y + 3, z, ids.torch); };
  const path = (ax: number, az: number, bx: number, bz: number) => {
    // An L-shaped gravel path on the ground (with a step every block where terraces change).
    const pts: [number, number][] = [];
    for (let x = ax; x !== bx; x += Math.sign(bx - ax)) pts.push([x, az]);
    for (let z = az; z !== bz + Math.sign(bz - az || 1); z += Math.sign(bz - az || 1)) pts.push([bx, z]);
    for (const [x, z] of pts) {
      if (x < x0 || z < z0 || x >= x0 + S || z >= z0 + S) continue;
      const y = h(x, z);
      if (blocks.get(key(x, y + 1, z)) && blocks.get(key(x, y + 1, z)) !== ids.air) continue; // don't cut through houses
      set(x, y, z, spec.style === "sandstone" ? ids.sand : ids.gravel);
    }
  };
  const walls = (inset: number, height: number) => {
    const a = x0 + inset, b = x0 + S - 1 - inset, c = z0 + inset, d = z0 + S - 1 - inset;
    const mid = (a + b) >> 1;
    for (let x = a; x <= b; x++) for (let z = c; z <= d; z++) {
      if (x !== a && x !== b && z !== c && z !== d) continue;
      const y0 = h(x, z);
      const gate = z === d && Math.abs(x - mid) <= 1;
      for (let y = y0 + 1; y <= y0 + height; y++) set(x, y, z, gate && y <= y0 + 3 ? ids.air : ids.stone_bricks);
      if ((x + z) % 2 === 0) set(x, y0 + height + 1, z, ids.stone_bricks);
    }
    for (const [tx, tz] of [[a - 1, c - 1], [b - 3, c - 1], [a - 1, d - 3], [b - 3, d - 3]]) tower(tx, tz, 5, height + 4);
    return { gate: [mid, d + 1] as [number, number] };
  };

  // ---- layouts
  const cx = x0 + (S >> 1), cz = z0 + (S >> 1);
  const ring = (n: number, radius: number, w: number, d: number) => {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand() * 0.3;
      const hx = Math.round(cx + Math.cos(a) * radius - w / 2), hz = Math.round(cz + Math.sin(a) * radius - d / 2);
      if (hx < x0 + 1 || hz < z0 + 1 || hx + w > x0 + S - 1 || hz + d > z0 + S - 1) continue;
      // Face the centre.
      const facing: 0 | 1 | 2 | 3 = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a)) ? (Math.cos(a) > 0 ? 3 : 2) : (Math.sin(a) > 0 ? 1 : 0);
      house(hx, hz, w + (rand() < 0.3 ? 2 : 0), d, facing, rand() < 0.2 ? 2 : 1);
      const door = doors[doors.length - 1];
      path(Math.floor(door[0]), Math.floor(door[2]), cx, cz);
    }
  };
  if (spec.kind === "hut") house(cx - 2, cz - 2, 5, 5, 0);
  else if (spec.kind === "house") house(cx - 4, cz - 3, 8, 7, 0, 2);
  else if (spec.kind === "tower") tower(cx - 3, cz - 3, 7, 18);
  else if (spec.kind === "village") {
    well(cx, cz);
    ring(7, 14, 6, 6);
    for (let i = 0; i < 4; i++) lamp(cx + [4, -4, 0, 0][i], cz + [0, 0, 4, -4][i]);
  } else if (spec.kind === "castle") {
    const { gate } = walls(2, 6);
    house(cx - 6, cz - 6, 12, 12, 0, 3); // the keep
    house(x0 + 6, z0 + 6, 6, 5, 0); house(x0 + S - 12, z0 + 6, 6, 5, 0);
    path(gate[0], gate[1] - 2, cx, cz + 7);
    well(cx, z0 + S - 10);
  } else if (spec.kind === "city") {
    const { gate } = walls(2, 7);
    // A temple at the heart (on the highest terrace on a mountain), houses in rings, lamps along the roads.
    let tx = cx, tz = cz;
    if (spec.mountain) { let best = -1; for (let x = x0 + 14; x < x0 + S - 14; x += 6) for (let z = z0 + 14; z < z0 + S - 14; z += 6) if (h(x, z) > best) { best = h(x, z); tx = x; tz = z; } }
    house(tx - 7, tz - 7, 14, 14, 0, 3);
    tower(tx - 11, tz - 11, 5, 22);
    ring(10, 22, 7, 6);
    ring(16, 36, 6, 6);
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; lamp(Math.round(cx + Math.cos(a) * 29), Math.round(cz + Math.sin(a) * 29)); }
    path(gate[0], gate[1] - 3, tx, tz + 8);
    well(cx + 12, cz + 12); well(cx - 12, cz - 12);
    for (let i = 0; i < 6; i++) { const a = rand() * Math.PI * 2; tower(Math.round(cx + Math.cos(a) * 30), Math.round(cz + Math.sin(a) * 30), 5, 12 + Math.round(rand() * 6)); }
  }
  // Banners of the builder's colour don't exist yet; wool marks the centre.
  if (spec.kind === "village" || spec.kind === "city") set(cx, h(cx, cz) + 2, cz + 4, ids.wool);
  if (!doors.length) doors.push([cx + 0.5, h(cx, cz) + 1, cz + 0.5]);
  return { blocks, doors, center: [cx + 0.5, h(cx, cz) + 1, cz + 0.5] };
}
