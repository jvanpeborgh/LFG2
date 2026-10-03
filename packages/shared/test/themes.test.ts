import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BufferPainter, DEFAULT_STANDARDS, VANILLA_CONTENT, buildRegistry, cloneStandards, dominantColors, hexToHsl, planBuild, planScenario, planTheme,
  rampOf, setRule, setupRules, themeRules,
} from "../src/index";

const textureHashes = (std = cloneStandards(DEFAULT_STANDARDS)) => {
  const reg = buildRegistry([VANILLA_CONTENT.id], std);
  const out = new Map<string, string>();
  for (const [name, t] of reg.textures) { const p = new BufferPainter(16); t.paint(p); out.set(name, createHash("sha1").update(p.data).digest("hex")); }
  return out;
};

describe("world themes", () => {
  it("reads 'cyberpunk sci-fi samurai' as a blend, with the first words leading", () => {
    const t = planTheme("a cyberpunk sci-fi samurai inspired world");
    expect(t.title).toBe("Cyberpunk Sci-fi Samurai");
    expect(t.startTime).toBe("night");
    expect(t.materials).toMatchObject({ leaves: "pink4", grass: "teal2", sky: "violet1", wood: "red2" });
    expect(t.build).toMatchObject({ neon: true, roof: "eaves", walls: "stone" });
    expect(t.raidTheme).toBe("ninjas");
    expect(t.creatures).toEqual(expect.arrayContaining(["a samurai", "a ninja", "a cyborg"]));
    expect(t.music).toEqual({ key: "A", mode: "minor", bpm: 112 });
  });

  it("takes reference colours over words: saturated ones set their hue, a dark one tints the greys", () => {
    const t = planTheme("samurai", ["#00e5ff", "#0b0f1e"]);
    expect(t.ramps.teal).toBe("#00e5ff");
    expect(t.neutral!.hue).toBeCloseTo(hexToHsl("#0b0f1e")[0], 0);
    expect(rampOf("#ff2fb3")).toBe("pink");
    expect(rampOf("#3f7a3a")).toBe("green");
  });

  it("finds the dominant colours of an image", () => {
    // Half magenta, 30% cyan, 20% near-black.
    const w = 40, h = 20, px = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = x < 20 ? [255, 31, 143] : x < 32 ? [0, 229, 255] : [11, 15, 30];
      px.set([...c, 255], (y * w + x) * 4);
    }
    const colors = dominantColors(px, w, h, 3);
    expect(colors.map((c) => c.hex)).toEqual(["#ff1f8f", "#00e5ff", "#0b0f1e"]);
    expect(colors[0].share).toBeCloseTo(0.5, 1);
  });

  it("only makes rule changes the rules allow, and keeps every palette colour clear of the danger colour", () => {
    const std = cloneStandards(DEFAULT_STANDARDS);
    const r = themeRules(planTheme("volcanic", ["#ff4a1c"]), std);
    expect(r.errors).toEqual([]);
    expect(r.notes.join(" ")).toMatch(/moved away from the danger colour/);
    const setup = setupRules({ theme: "cyberpunk samurai", rules: { "locked.maxWorldwideHazards": 9 } }, std);
    expect(setup.errors.join(" ")).toMatch(/locked/);
  });

  it("material slots let a theme recolour leaves without touching grass (and the base world is unchanged)", () => {
    const base = textureHashes();
    const std = cloneStandards(DEFAULT_STANDARDS);
    setRule(std, "art.materials.leaves", "pink4");
    const themed = textureHashes(std);
    const changed = [...base.keys()].filter((k) => base.get(k) !== themed.get(k));
    expect(changed).toEqual(["leaves"]);
  });

  it("gives the planners the world's defaults: builds in its style, raids in its theme", () => {
    const t = planTheme("cyberpunk samurai");
    expect(planBuild("a village", DEFAULT_STANDARDS, t.build)).toMatchObject({ roof: "eaves", neon: true, style: "stone" });
    expect(planBuild("a wooden village", DEFAULT_STANDARDS, t.build)!.style).toBe("wood");
    const raid = planScenario("enemies attack in waves with bosses", DEFAULT_STANDARDS, 1, t.raidTheme).spec!;
    expect(raid.title).toBe("Ninja Raid");
    expect(raid.waves.at(-1)!.boss!.name).toBe("Oni King");
    expect(planScenario("pirates attack in waves", DEFAULT_STANDARDS, 1, t.raidTheme).spec!.title).toBe("Pirate Raid");
  });
});
