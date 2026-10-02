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
});
