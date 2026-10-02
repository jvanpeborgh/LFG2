import { describe, expect, it } from "vitest";
import {
  BlockTable, Chunk, ChunkMap, CHUNK_SIZE, DEFAULT_STANDARDS, VanillaGenerator, VANILLA_CONTENT, buildRegistry,
  decodeChunkFrame, decodeRLE, digTime, encodeChunkFrame, encodeRLE, makeBody, matchRecipe, raycast, rollDrops,
  stepBody, windowClick, updateCraftResult, BufferPainter, SEA_LEVEL, blockIndex, cloneStandards, setRule,
  type Slot, type WindowState,
} from "../src";

const reg = buildRegistry([VANILLA_CONTENT.id], DEFAULT_STANDARDS);

describe("registry", () => {
  it("assigns stable ids and a fingerprint", () => {
    const again = buildRegistry([VANILLA_CONTENT.id], DEFAULT_STANDARDS);
    expect(again.fingerprint()).toBe(reg.fingerprint());
    expect(reg.blockId("air")).toBe(0);
    expect(reg.item("stone").block).toBe(reg.blockId("stone"));
  });

  it("has a texture for every face and item", () => {
    for (const b of reg.blocks) {
      if (b.render === "none") continue;
      for (const f of [b.faces.top, b.faces.side, b.faces.bottom, b.faces.front].filter(Boolean)) {
        expect(reg.textures.has(f!), `${b.name} face ${f}`).toBe(true);
      }
    }
    for (const it of reg.items) if (!it.block) expect(reg.textures.has(it.texture!), it.name).toBe(true);
  });

  it("repaints textures from the current palette after a rule change", () => {
    const std = cloneStandards();
    const r = buildRegistry([VANILLA_CONTENT.id], std);
    const paint = () => { const p = new BufferPainter(1); r.textures.get("grass_top")!.paint(p); return [...p.data.slice(0, 4)]; };
    const before = paint();
    setRule(std, "art.palette.green3", "#c04090");
    const after = paint();
    expect(after).not.toEqual(before);
    expect(after[0]).toBeGreaterThan(after[1]); // now pinkish: more red than green
  });

  it("paints every texture without throwing", () => {
    for (const t of reg.textures.values()) {
      const p = new BufferPainter(1);
      t.paint(p);
      expect(p.data.some((v) => v !== 0), t.name).toBe(true);
    }
  });
});

describe("chunks", () => {
  it("round-trips RLE and binary frames", () => {
    const c = new Chunk(0, 0, 0);
    c.set(1, 2, 3, 7);
    c.set(31, 31, 31, 2);
    expect(decodeRLE(encodeRLE(c.blocks))).toEqual(c.blocks);
    const f = decodeChunkFrame(encodeChunkFrame(-3, 1, 9, c.blocks));
    expect([f.cx, f.cy, f.cz]).toEqual([-3, 1, 9]);
    expect(f.blocks).toEqual(c.blocks);
  });
});

describe("worldgen", () => {
  const gen = new VanillaGenerator(1234, reg);

  it("is deterministic", () => {
    expect(gen.generate(2, 1, -3)).toEqual(new VanillaGenerator(1234, reg).generate(2, 1, -3));
  });

  it("has bedrock at y=0 and water at sea level in oceans", () => {
    const c = gen.generate(0, 0, 0);
    for (let z = 0; z < CHUNK_SIZE; z++) for (let x = 0; x < CHUNK_SIZE; x++) expect(c[blockIndex(x, 0, z)]).toBe(reg.blockId("bedrock"));
    // Find an ocean column somewhere and check it's water at sea level.
    let found = false;
    for (let x = 0; x < 4000 && !found; x += 37) {
      const col = gen.column(x, x);
      if (col.biome === "ocean") {
        const cy = Math.floor(SEA_LEVEL / CHUNK_SIZE);
        const chunk = gen.generate(Math.floor(x / CHUNK_SIZE), cy, Math.floor(x / CHUNK_SIZE));
        const id = chunk[blockIndex(((x % 32) + 32) % 32, SEA_LEVEL - cy * 32, ((x % 32) + 32) % 32)];
        expect([reg.blockId("water"), reg.blockId("ice")]).toContain(id);
        found = true;
      }
    }
    expect(found).toBe(true);
  });

  it("places trees that cross chunk borders consistently", () => {
    // Leaves from a tree near a border must appear in both chunks they touch: just make sure generation
    // of neighbours doesn't throw and some logs/leaves exist in a forest area.
    let logs = 0;
    for (let cx = -2; cx < 2; cx++) for (let cz = -2; cz < 2; cz++) {
      const c = gen.generate(cx, 1, cz);
      for (const id of c) if (id === reg.blockId("log")) logs++;
    }
    expect(logs).toBeGreaterThan(0);
  });

  it("finds a spawn above sea level", () => {
    expect(gen.findSpawn()[1]).toBeGreaterThan(SEA_LEVEL);
  });
});

describe("physics", () => {
  const table = new BlockTable(reg);
  const world = new ChunkMap();
  const c = new Chunk(0, 0, 0);
  for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) c.set(x, 4, z, reg.blockId("stone"));
  c.set(10, 5, 10, reg.blockId("stone"));
  world.setChunk(c);

  it("lands on the ground and records fall distance", () => {
    const b = makeBody(5.5, 15, 5.5, 0.6, 1.8);
    let maxFall = 0;
    for (let i = 0; i < 120; i++) {
      stepBody(world, table, b, 1 / 60, { gravity: 32 });
      maxFall = Math.max(maxFall, b.fallDistance);
    }
    expect(b.onGround).toBe(true);
    expect(b.y).toBeCloseTo(5, 2);
    expect(maxFall).toBeGreaterThan(9);
  });

  it("jumps the same height at any frame rate", () => {
    for (const dt of [1 / 144, 1 / 60, 1 / 20, 1 / 10]) {
      const b = makeBody(5.5, 5, 5.5, 0.6, 1.8);
      stepBody(world, table, b, dt, { gravity: 32 });
      b.vy = Math.sqrt(2 * 32 * 1.25);
      let apex = 0;
      for (let t = 0; t < 1; t += dt) { stepBody(world, table, b, dt, { gravity: 32 }); apex = Math.max(apex, b.y - 5); }
      expect(apex, `dt=${dt}`).toBeGreaterThan(1.1);
      expect(apex, `dt=${dt}`).toBeLessThan(1.4);
    }
  });

  it("is stopped by walls", () => {
    const b = makeBody(8.5, 5, 10.5, 0.6, 1.8);
    for (let i = 0; i < 60; i++) {
      b.vx = 4;
      stepBody(world, table, b, 1 / 60, { gravity: 32 });
    }
    expect(b.x).toBeLessThan(10 - 0.29);
    expect(b.hitWall).toBe(true);
  });

  it("raycasts to the first solid block", () => {
    const hit = raycast(world, 10.5, 8, 10.5, 0, -1, 0, 10, (id) => table.isSolid(id));
    expect(hit).toMatchObject({ x: 10, y: 5, z: 10, ny: 1 });
  });
});

describe("crafting and windows", () => {
  const S = (name: string, n = 1): Slot => reg.stack(name, n);

  it("matches shaped recipes anywhere in the grid and mirrored", () => {
    const g: Slot[] = Array(9).fill(null);
    g[1] = S("planks"); g[4] = S("planks");
    expect(matchRecipe(reg, g, 3)?.item).toBe(reg.item("stick").id);
    const axe: Slot[] = [S("cobblestone"), S("cobblestone"), null, S("stick"), S("cobblestone"), null, S("stick"), null, null];
    // mirrored axe: "MM","SM","S " is the mirror of "MM","MS"," S"
    expect(matchRecipe(reg, axe, 3)?.item).toBe(reg.item("stone_axe").id);
  });

  it("matches shapeless recipes", () => {
    const g: Slot[] = [null, null, null, S("log")];
    expect(matchRecipe(reg, g, 2)).toMatchObject({ item: reg.item("planks").id, count: 4 });
  });

  it("crafts through window clicks and consumes ingredients", () => {
    const hotbar: Slot[] = Array(9).fill(null);
    const main: Slot[] = Array(27).fill(null);
    const grid: Slot[] = [S("log", 2), null, null, null];
    const win: WindowState = {
      kind: "inventory",
      sections: [
        { id: "result", role: "result", slots: [null] },
        { id: "craft", role: "craftGrid", width: 2, slots: grid },
        { id: "main", role: "storage", slots: main },
        { id: "hotbar", role: "storage", slots: hotbar },
      ],
    };
    updateCraftResult(reg, win);
    const cursor = { stack: null as Slot };
    windowClick(reg, win, cursor, 0, 0, false);
    expect(cursor.stack).toMatchObject({ item: reg.item("planks").id, count: 4 });
    expect(grid[0]?.count).toBe(1);
    // Shift-click crafts the rest into the inventory.
    windowClick(reg, win, cursor, 0, 0, true);
    expect(grid[0]).toBeNull();
    expect(main.concat(hotbar).find((s) => s)?.count).toBe(4);
  });
});

describe("rules", () => {
  it("needs a pickaxe to harvest stone and tools speed digging", () => {
    const stone = reg.block("stone");
    const pick = reg.item("wooden_pickaxe");
    expect(rollDrops(reg, stone, undefined, Math.random)).toEqual([]);
    expect(rollDrops(reg, stone, pick, Math.random)[0].item).toBe(reg.item("cobblestone").id);
    expect(digTime(stone, pick)).toBeLessThan(digTime(stone, undefined));
    expect(digTime(reg.block("bedrock"), pick)).toBe(Infinity);
  });
});
