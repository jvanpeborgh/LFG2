import { describe, expect, it } from "vitest";
import { CHUNK_SIZE, DEFAULT_STANDARDS, VANILLA_CONTENT, VanillaGenerator, blockIndex, buildRegistry } from "../src";

const reg = buildRegistry([VANILLA_CONTENT.id], DEFAULT_STANDARDS);

describe("ruins", () => {
  const gen = new VanillaGenerator(7, reg);
  const ruins: NonNullable<ReturnType<typeof gen.ruinIn>>[] = [];
  for (let cz = -6; cz <= 6; cz++) for (let cx = -6; cx <= 6; cx++) { const r = gen.ruinIn(cx, cz); if (r) ruins.push(r); }

  it("dots the land with ruins, about one every few hundred blocks", () => {
    expect(ruins.length).toBeGreaterThan(8);
    expect(ruins.length).toBeLessThan(13 * 13 * 0.5);
  });

  it("generates a ruin's walls and its chest, the same in every chunk", () => {
    const r = ruins[0];
    const at = (x: number, y: number, z: number) => {
      const cx = Math.floor(x / CHUNK_SIZE), cy = Math.floor(y / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
      return gen.generate(cx, cy, cz)[blockIndex(x - cx * CHUNK_SIZE, y - cy * CHUNK_SIZE, z - cz * CHUNK_SIZE)];
    };
    expect(reg.blockById(at(r.x, r.h + 1, r.z)).name).toBe("chest");
    expect(gen.ruinChestAt(r.x, r.h + 1, r.z)).toBe(true);
    expect(gen.ruinChestAt(r.x + 1, r.h + 1, r.z)).toBe(false);
    // A corner pillar.
    const corner = reg.blockById(at(r.x + r.half, r.h + 2, r.z + r.half)).name;
    expect(["stone_bricks", "cobblestone", "sandstone"]).toContain(corner);
  });
});
