import { CHUNK_SIZE, CHUNK_VOLUME, WORLD_HEIGHT, blockIndex } from "../chunk";
import { Simplex, hashFloat } from "../random";
import type { Registry } from "../registry";

export const SEA_LEVEL = 48;

export type Biome = "ocean" | "beach" | "plains" | "forest" | "desert" | "snowy" | "mountains";

export interface ColumnInfo {
  height: number;
  biome: Biome;
}

/**
 * Deterministic Minecraft-like terrain: oceans, beaches, plains, forests,
 * deserts, snowy plains and mountains, with caves, ores, trees and plants.
 * Pure function of (seed, x, y, z) so any chunk can be generated in any order.
 */
export class VanillaGenerator {
  private n: Simplex;
  private n2: Simplex;
  private n3: Simplex;
  private ids: Record<string, number>;

  constructor(readonly seed: number, reg: Registry) {
    this.n = new Simplex(seed);
    this.n2 = new Simplex(seed ^ 0x5bd1e995);
    this.n3 = new Simplex(seed ^ 0x27d4eb2f);
    const names = [
      "air", "stone", "grass", "dirt", "bedrock", "water", "sand", "gravel", "coal_ore", "iron_ore", "gold_ore",
      "diamond_ore", "log", "leaves", "sandstone", "snow", "snowy_grass", "ice", "cactus", "tall_grass", "dandelion", "poppy",
      "cobblestone", "stone_bricks", "chest", "torch",
    ];
    this.ids = Object.fromEntries(names.map((n) => [n, reg.blockId(n)]));
  }

  column(x: number, z: number): ColumnInfo {
    const n = this.n, n2 = this.n2;
    const continent = n.fbm2(x / 700, z / 700, 4);
    const hills = n.fbm2(x / 140 + 31, z / 140 - 17, 4);
    const ridge = Math.max(0, n2.fbm2(x / 380 - 70, z / 380 + 40, 3) - 0.1);
    const mountain = ridge * ridge * 120;
    let height = SEA_LEVEL + 5 + continent * 26 + hills * 7 + mountain;
    height = Math.max(6, Math.min(WORLD_HEIGHT - 12, Math.floor(height)));
    const temp = n2.fbm2(x / 900 + 300, z / 900 - 120, 2);
    const humid = n.fbm2(x / 700 - 500, z / 700 + 260, 2);
    let biome: Biome;
    if (height < SEA_LEVEL - 1) biome = "ocean";
    else if (height <= SEA_LEVEL + 1 && temp > -0.3) biome = "beach";
    else if (height > SEA_LEVEL + 38) biome = "mountains";
    else if (temp > 0.25 && humid < 0.05) biome = "desert";
    else if (temp < -0.3) biome = "snowy";
    else if (humid > 0.1) biome = "forest";
    else biome = "plains";
    return { height, biome };
  }

  private isCave(x: number, y: number, z: number, surface: number): boolean {
    if (y < 3 || y > surface - 3) return false;
    if (surface < SEA_LEVEL + 2 && y > surface - 8) return false; // don't breach the sea floor
    const a = this.n3.noise3(x / 48, y / 28, z / 48);
    const b = this.n3.noise3(x / 48 + 91.7, y / 28 - 13.3, z / 48 + 47.1);
    if (a * a + b * b < 0.006) return true; // spaghetti tunnels
    if (y < 40) {
      const c = this.n2.noise3(x / 80, y / 36, z / 80);
      if (c > 0.66) return true; // larger caverns deep down
    }
    return false;
  }

  private oreAt(x: number, y: number, z: number): number {
    const s = this.seed;
    // Ore veins: decide per 2×2×2 cell, then thin out inside the cell.
    const cx = x >> 1, cy = y >> 1, cz = z >> 1;
    const inner = hashFloat(s, x, y, z, 77) < 0.6;
    if (!inner) return 0;
    if (y <= 16 && hashFloat(s, cx, cy, cz, 4) < 0.012) return this.ids.diamond_ore;
    if (y <= 32 && hashFloat(s, cx, cy, cz, 3) < 0.02) return this.ids.gold_ore;
    if (y <= 64 && hashFloat(s, cx, cy, cz, 2) < 0.05) return this.ids.iron_ore;
    if (y <= 110 && hashFloat(s, cx, cy, cz, 1) < 0.08) return this.ids.coal_ore;
    if (y <= 60 && hashFloat(s, cx, cy, cz, 5) < 0.02) return this.ids.gravel;
    return 0;
  }

  /** Tree at this column? Returns trunk height or 0. */
  private treeAt(x: number, z: number, info: ColumnInfo): number {
    const chance = info.biome === "forest" ? 0.03 : info.biome === "plains" ? 0.004 : info.biome === "snowy" ? 0.012 : 0;
    if (chance === 0 || info.height < SEA_LEVEL) return 0;
    if (hashFloat(this.seed, x, z, 101) >= chance) return 0;
    return 4 + Math.floor(hashFloat(this.seed, x, z, 102) * 3);
  }

  /**
   * Ruins: the broken walls of an old shrine on open land, about one every 60 blocks, with a chest
   * in the middle (its loot is made the first time someone opens it). One possible ruin per 56×56
   * cell, at a spot chosen from the seed, so every chunk agrees where they are.
   */
  ruinIn(cellX: number, cellZ: number): { x: number; z: number; h: number; half: number; desert: boolean } | null {
    const RC = 56;
    if (hashFloat(this.seed, cellX, cellZ, 301) >= 0.42) return null;
    const x = cellX * RC + 8 + Math.floor(hashFloat(this.seed, cellX, cellZ, 302) * 40);
    const z = cellZ * RC + 8 + Math.floor(hashFloat(this.seed, cellX, cellZ, 303) * 40);
    const info = this.column(x, z);
    if (info.height <= SEA_LEVEL + 1 || info.biome === "ocean" || info.biome === "mountains" || info.biome === "beach") return null;
    if (this.isCave(x, info.height, z, info.height)) return null;
    // Only on ground that's fairly flat (the corners within 3 blocks of the middle).
    const half = hashFloat(this.seed, cellX, cellZ, 304) < 0.5 ? 3 : 4;
    for (const [dx, dz] of [[-half, -half], [half, -half], [-half, half], [half, half]]) if (Math.abs(this.column(x + dx, z + dz).height - info.height) > 3) return null;
    return { x, z, h: info.height, half, desert: info.biome === "desert" };
  }

  /** Is there a ruin's chest here (for filling it with loot the first time it's opened)? */
  ruinChestAt(x: number, y: number, z: number): boolean {
    const r = this.ruinIn(Math.floor(x / 56), Math.floor(z / 56));
    return !!r && r.x === x && r.z === z && r.h + 1 === y;
  }

  private placeRuins(out: Uint16Array, x0: number, y0: number, z0: number): void {
    const S = CHUNK_SIZE, id = this.ids;
    const put = (x: number, y: number, z: number, b: number) => {
      const lx = x - x0, ly = y - y0, lz = z - z0;
      if (lx < 0 || ly < 0 || lz < 0 || lx >= S || ly >= S || lz >= S) return;
      out[blockIndex(lx, ly, lz)] = b;
    };
    for (let cz = Math.floor((z0 - 10) / 56); cz <= Math.floor((z0 + S + 10) / 56); cz++)
      for (let cx = Math.floor((x0 - 10) / 56); cx <= Math.floor((x0 + S + 10) / 56); cx++) {
        const r = this.ruinIn(cx, cz);
        if (!r) continue;
        const { x, z, h, half } = r;
        if (x + half < x0 || x - half >= x0 + S || z + half < z0 || z - half >= z0 + S || h + 6 < y0 || h - 3 >= y0 + S) continue;
        const wall = (dx: number, dz: number) => (r.desert ? id.sandstone : hashFloat(this.seed, x + dx, z + dz, 311) < 0.55 ? id.stone_bricks : id.cobblestone);
        for (let dz = -half; dz <= half; dz++)
          for (let dx = -half; dx <= half; dx++) {
            // A paved floor (patchy), solid ground under it, and nothing growing inside.
            for (let y = h - 2; y < h; y++) put(x + dx, y, z + dz, r.desert ? id.sandstone : id.stone);
            const paved = hashFloat(this.seed, x + dx, z + dz, 312) < 0.8;
            put(x + dx, h, z + dz, paved ? wall(dx, dz) : r.desert ? id.sand : id.gravel);
            for (let y = h + 1; y <= h + 5; y++) put(x + dx, y, z + dz, 0);
            const edge = Math.abs(dx) === half || Math.abs(dz) === half;
            const corner = Math.abs(dx) === half && Math.abs(dz) === half;
            if (!edge) continue;
            // Walls, broken to different heights; a doorway on one side; tall corner pillars.
            const door = (dz === half || dz === -half) && Math.abs(dx) <= 0 && hashFloat(this.seed, x, z, 313) < 0.5 ? true : (dx === -half && dz === 0);
            if (door) continue;
            const height = corner ? 4 : Math.floor(hashFloat(this.seed, x + dx, z + dz, 314) * 3.4);
            for (let y = h + 1; y <= h + height; y++) put(x + dx, y, z + dz, wall(dx, dz));
            if (corner && hashFloat(this.seed, x + dx, z + dz, 315) < 0.5) put(x + dx, h + 5, z + dz, id.torch);
          }
        put(x, h + 1, z, id.chest);
      }
  }

  generate(cx: number, cy: number, cz: number): Uint16Array {
    const out = new Uint16Array(CHUNK_VOLUME);
    const S = CHUNK_SIZE;
    const x0 = cx * S, y0 = cy * S, z0 = cz * S;
    const id = this.ids;
    const cols: ColumnInfo[] = new Array(S * S);
    for (let lz = 0; lz < S; lz++) for (let lx = 0; lx < S; lx++) cols[lz * S + lx] = this.column(x0 + lx, z0 + lz);

    const put = (lx: number, ly: number, lz: number, b: number) => {
      if (lx < 0 || ly < 0 || lz < 0 || lx >= S || ly >= S || lz >= S) return;
      out[blockIndex(lx, ly, lz)] = b;
    };

    for (let lz = 0; lz < S; lz++) {
      for (let lx = 0; lx < S; lx++) {
        const x = x0 + lx, z = z0 + lz;
        const info = cols[lz * S + lx];
        const h = info.height;
        const b = info.biome;
        const top = b === "desert" || b === "beach" ? id.sand
          : b === "ocean" ? (hashFloat(this.seed, x, z, 9) < 0.3 ? id.gravel : id.sand)
          : b === "snowy" ? id.snowy_grass
          : b === "mountains" ? (h > 96 ? id.snow : id.stone)
          : id.grass;
        const filler = b === "desert" || b === "beach" || b === "ocean" ? id.sand : b === "mountains" ? id.stone : id.dirt;
        for (let ly = 0; ly < S; ly++) {
          const y = y0 + ly;
          let block = 0;
          if (y === 0) block = id.bedrock;
          else if (y <= 2 && hashFloat(this.seed, x, y, z, 8) < 0.5) block = id.bedrock;
          else if (y <= h) {
            if (this.isCave(x, y, z, h)) block = 0;
            else if (y === h) block = top;
            else if (y > h - 4) block = b === "desert" && y < h - 2 ? id.sandstone : filler;
            else block = this.oreAt(x, y, z) || id.stone;
          } else if (y <= SEA_LEVEL) {
            block = b === "snowy" && y === SEA_LEVEL ? id.ice : id.water;
          }
          if (block) out[blockIndex(lx, ly, lz)] = block;
        }
        // Plants on the surface.
        const ly = h + 1 - y0;
        if (ly >= 0 && ly < S && h >= SEA_LEVEL && !this.isCave(x, h, z, h)) {
          const r = hashFloat(this.seed, x, z, 55);
          if (b === "plains" || b === "forest") {
            const grassChance = b === "plains" ? 0.14 : 0.06;
            if (r < 0.008) put(lx, ly, lz, id.dandelion);
            else if (r < 0.014) put(lx, ly, lz, id.poppy);
            else if (r < 0.014 + grassChance) put(lx, ly, lz, id.tall_grass);
          } else if (b === "desert" && r < 0.005) {
            const ch = 1 + Math.floor(hashFloat(this.seed, x, z, 56) * 3);
            for (let k = 0; k < ch; k++) put(lx, ly + k, lz, id.cactus);
          }
        }
      }
    }

    // Trees, including ones rooted in neighbouring columns whose leaves reach into this chunk.
    const R = 3;
    for (let tz = z0 - R; tz < z0 + S + R; tz++) {
      for (let tx = x0 - R; tx < x0 + S + R; tx++) {
        const inside = tx >= x0 && tx < x0 + S && tz >= z0 && tz < z0 + S;
        const info = inside ? cols[(tz - z0) * S + (tx - x0)] : this.column(tx, tz);
        const trunk = this.treeAt(tx, tz, info);
        if (!trunk) continue;
        const base = info.height + 1;
        if (base + trunk + 2 < y0 || base > y0 + S) continue;
        if (this.isCave(tx, info.height, tz, info.height)) continue;
        const lx = tx - x0, lz = tz - z0;
        const topY = base + trunk;
        // Leaves: two wide layers then two narrow layers.
        for (let y = topY - 2; y <= topY + 1; y++) {
          const rad = y >= topY ? 1 : 2;
          for (let dz = -rad; dz <= rad; dz++)
            for (let dx = -rad; dx <= rad; dx++) {
              if (rad === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2 && hashFloat(this.seed, tx + dx, y, tz + dz, 3) < 0.6) continue;
              if (y === topY + 1 && Math.abs(dx) + Math.abs(dz) > 1) continue;
              const px = lx + dx, py = y - y0, pz = lz + dz;
              if (px < 0 || py < 0 || pz < 0 || px >= S || py >= S || pz >= S) continue;
              const i = blockIndex(px, py, pz);
              if (out[i] === 0 || out[i] === id.tall_grass) out[i] = id.leaves;
            }
        }
        for (let y = base; y < topY; y++) put(lx, y - y0, lz, id.log);
        put(lx, base - 1 - y0, lz, id.dirt);
      }
    }
    this.placeRuins(out, x0, y0, z0);
    return out;
  }

  /** A dry land spawn point near the origin. */
  findSpawn(): [number, number, number] {
    for (let r = 0; r < 2000; r += 16) {
      for (let a = 0; a < 8; a++) {
        const x = Math.round(Math.cos((a / 8) * Math.PI * 2) * r);
        const z = Math.round(Math.sin((a / 8) * Math.PI * 2) * r);
        const c = this.column(x, z);
        if (c.height > SEA_LEVEL + 1 && c.biome !== "mountains" && !this.isCave(x, c.height, z, c.height)) return [x + 0.5, c.height + 1, z + 0.5];
      }
    }
    return [0.5, WORLD_HEIGHT - 20, 0.5];
  }
}
