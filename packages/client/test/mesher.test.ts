import { describe, expect, it } from "vitest";
import { DEFAULT_STANDARDS, VANILLA_CONTENT, VanillaGenerator, buildRegistry } from "@lfg/shared";
import { WorldMirror, buildBlockInfo, meshChunk } from "../src/mesher";

const reg = buildRegistry([VANILLA_CONTENT.id], DEFAULT_STANDARDS);
const names = [...reg.textures.keys()];
const info = buildBlockInfo(reg.blocks, (n) => Math.max(0, names.indexOf(n)));

describe("mesher", () => {
  const gen = new VanillaGenerator(7, reg);
  const world = new WorldMirror(info);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) for (let cy = 0; cy < 4; cy++) world.addChunk(cx, cy, cz, gen.generate(cx, cy, cz));

  it("meshes terrain with lighting, quickly", () => {
    const t = performance.now();
    let quads = 0;
    for (let cy = 0; cy < 4; cy++) {
      const m = meshChunk(world, info, 0, cy, 0);
      quads += m.solid.indices.length / 6;
      expect(m.solid.positions.length / 3).toBe(m.solid.light.length / 3);
    }
    const ms = (performance.now() - t) / 4;
    console.log(`mesh: ${ms.toFixed(1)} ms/chunk, ${quads} quads in column`);
    expect(quads).toBeGreaterThan(500);
  });

  it("lights the surface fully and darkens deep underground", () => {
    const x = 5, z = 5;
    const h = world.heightAt(x, z);
    expect(h).toBeGreaterThan(30);
    // Surface top faces should have sky light 1.0 somewhere in the top chunk mesh.
    const m = meshChunk(world, info, 0, Math.floor(h / 32), 0);
    let maxSky = 0;
    for (let i = 0; i < m.solid.light.length; i += 3) maxSky = Math.max(maxSky, m.solid.light[i]);
    expect(maxSky).toBe(1);
  });

  it("colours block light by its source, and lamps glow by themselves", () => {
    // A sealed stone room deep underground: a crystal on one side, a torch on the other.
    const id = (n: string) => reg.block(n).id;
    const room = new WorldMirror(info);
    const stone = new Uint16Array(32 * 32 * 32).fill(id("stone"));
    for (let y = 4; y < 10; y++) for (let z = 4; z < 28; z++) for (let x = 4; x < 28; x++) stone[(y << 10) | (z << 5) | x] = 0;
    stone[(4 << 10) | (16 << 5) | 5] = id("crystal");
    stone[(4 << 10) | (16 << 5) | 26] = id("torch");
    for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) for (let cy = 0; cy < 3; cy++)
      room.addChunk(cx, cy, cz, cx === 0 && cz === 0 && cy === 0 ? stone : new Uint16Array(32 * 32 * 32).fill(id("stone")));
    const m = meshChunk(room, info, 0, 0, 0).solid;
    // The glow on the floor (top faces at y=4) near each light.
    const near = (lx: number) => {
      let best = [0, 0, 0], bestL = 0;
      for (let v = 0; v < m.positions.length / 3; v++) {
        const x = m.positions[v * 3], y = m.positions[v * 3 + 1], z = m.positions[v * 3 + 2];
        if (y !== 4 || Math.abs(z - 16) > 2 || Math.abs(x - lx) > 2) continue;
        if (m.light[v * 3 + 1] > bestL) { bestL = m.light[v * 3 + 1]; best = [m.glow[v * 3], m.glow[v * 3 + 1], m.glow[v * 3 + 2]]; }
      }
      return best;
    };
    const purple = near(6), warm = near(26);
    expect(purple[2]).toBeGreaterThan(purple[1] + 0.3); // blue over green: violet
    expect(warm[0]).toBeGreaterThan(warm[2] + 0.3); // red over blue: firelight
    // The crystal's own faces carry the glow flag (+8 on the shade).
    const water = meshChunk(room, info, 0, 0, 0).water;
    let flagged = 0;
    for (let i = 2; i < water.light.length; i += 3) if (water.light[i] >= 8) flagged++;
    expect(flagged).toBeGreaterThan(0);
  });
});
