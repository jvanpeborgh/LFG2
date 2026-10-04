import type { Registry, TexturePainter, ToolTier, ToolType, ModelPart } from "../registry";
import type { Standards } from "../standards";

/**
 * Vanilla content: the Minecraft-like base game, registered exactly like an
 * agent's module would register its content. Colours come from the world
 * palette (docs/standards) so a palette change restyles everything.
 */
export function registerVanillaContent(reg: Registry, std: Standards): void {
  const P = std.art.palette as Record<string, string>;
  const R = std.art.reserved;
  // Materials name which palette colour each natural material uses (art.materials), so a world's
  // theme can recolour leaves without recolouring grass. tone() steps along the same ramp
  // (green3 → green4) for highlights and shadows.
  const mat = (name: string) => (std.art.materials as Record<string, string>)[name];
  const tone = (name: string, d: number) => {
    const key = mat(name);
    const ramp = key.replace(/\d+$/, ""), n = Number(key.slice(ramp.length));
    const max = ramp === "neutral" ? 8 : 5;
    return P[`${ramp}${Math.max(1, Math.min(max, n + d))}`];
  };
  const M = (name: string) => P[mat(name)];

  // ------------------------------------------------------------ texture helpers
  const tex = (name: string, paint: (p: TexturePainter) => void) => reg.addTexture({ name, paint });

  const noisy = (p: TexturePainter, base: string, amount = 0.12, salt = 0) => {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) p.set(x, y, p.shade(base, 1 - amount + p.rand(x, y, salt) * amount * 2));
  };
  const speckle = (p: TexturePainter, color: string, chance: number, salt = 1) => {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) if (p.rand(x, y, salt) < chance) p.set(x, y, p.shade(color, 0.9 + p.rand(x, y, salt + 1) * 0.2));
  };
  const ore = (p: TexturePainter, color: string, salt: number) => {
    noisy(p, P.neutral5, 0.1, 3);
    for (let k = 0; k < 5; k++) {
      const cx = 2 + Math.floor(p.rand(k, 0, salt) * 12);
      const cy = 2 + Math.floor(p.rand(k, 1, salt) * 12);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (p.rand(cx + dx, cy + dy, salt + 7) < 0.7) p.set(cx + dx, cy + dy, p.shade(color, 0.85 + p.rand(dx, dy, k) * 0.3));
    }
  };
  /** Draw from an ASCII mask; legend maps chars to colours. */
  const mask = (p: TexturePainter, rows: string[], legend: Record<string, string>) => {
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const c = legend[row[x]];
        if (c) p.set(x, y, p.shade(c, 0.92 + p.rand(x, y, 9) * 0.16));
      }
    });
  };
  const blob = (p: TexturePainter, color: string, cx: number, cy: number, rx: number, ry: number, highlight?: string) => {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
        if (d <= 1) {
          const light = highlight && x < cx && y < cy && d < 0.35 ? highlight : color;
          p.set(x, y, p.shade(light, 1.08 - d * 0.25 + (p.rand(x, y, 4) - 0.5) * 0.08));
        }
      }
  };

  // ------------------------------------------------------------ block textures
  // Read through getters so textures repainted after a palette rule change pick up the new colours.
  const C = {
    get DIRT() { return M("dirt"); },
    get GRASS() { return M("grass"); },
    get STONE() { return M("stone"); },
    get WOOD() { return M("wood"); },
    get BARK() { return M("bark"); },
  };
  tex("dirt", (p) => { noisy(p, C.DIRT, 0.15); speckle(p, tone("dirt", -1), 0.08); speckle(p, tone("dirt", 2), 0.04, 5); });
  tex("grass_top", (p) => { noisy(p, C.GRASS, 0.16); speckle(p, tone("grass", 1), 0.08); speckle(p, tone("grass", -1), 0.08, 7); });
  tex("grass_side", (p) => {
    noisy(p, C.DIRT, 0.15); speckle(p, tone("dirt", -1), 0.08);
    for (let x = 0; x < 16; x++) {
      const h = 3 + Math.floor(p.rand(x, 0, 11) * 2.5);
      for (let y = 0; y < h; y++) p.set(x, y, p.shade(C.GRASS, 0.85 + p.rand(x, y, 12) * 0.3));
    }
  });
  tex("snow", (p) => { noisy(p, M("snow"), 0.04); speckle(p, P.blue5, 0.05); });
  tex("snowy_grass_side", (p) => {
    noisy(p, C.DIRT, 0.15);
    for (let x = 0; x < 16; x++) {
      const h = 3 + Math.floor(p.rand(x, 0, 13) * 3);
      for (let y = 0; y < h; y++) p.set(x, y, p.shade(M("snow"), 0.94 + p.rand(x, y, 14) * 0.06));
    }
  });
  tex("stone", (p) => { noisy(p, C.STONE, 0.08); speckle(p, tone("stone", -1), 0.12); speckle(p, tone("stone", 1), 0.05, 3); });
  tex("cobblestone", (p) => {
    noisy(p, C.STONE, 0.12);
    // Rounded stones separated by dark mortar lines.
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const cellX = Math.floor((x + (Math.floor(y / 5) % 2) * 3) / 5);
        const cellY = Math.floor(y / 5);
        const edge = (x + (Math.floor(y / 5) % 2) * 3) % 5 === 0 || y % 5 === 0;
        if (edge) p.set(x, y, p.shade(tone("stone", -2), 0.9 + p.rand(x, y, 2) * 0.2));
        else p.set(x, y, p.shade(C.STONE, 0.85 + p.rand(cellX, cellY, 3) * 0.3 + (p.rand(x, y, 4) - 0.5) * 0.08));
      }
  });
  tex("stone_bricks", (p) => {
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const row = Math.floor(y / 8);
        const xs = (x + row * 4) % 8;
        const mortar = y % 8 === 7 || xs === 7;
        p.set(x, y, mortar ? p.shade(tone("stone", -2), 1) : p.shade(C.STONE, 0.92 + p.rand(x, y, 6) * 0.14));
      }
  });
  tex("bedrock", (p) => { noisy(p, P.neutral3, 0.3); speckle(p, P.neutral1, 0.25); speckle(p, P.neutral5, 0.08, 9); });
  tex("sand", (p) => { noisy(p, M("sand"), 0.06); speckle(p, tone("sand", -1), 0.15); speckle(p, P.orange5, 0.06, 4); });
  tex("sandstone_side", (p) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const band = y < 3 ? 1.05 : y > 12 ? 0.88 : 0.97;
      p.set(x, y, p.shade(M("sand"), band - p.rand(x, y, 2) * 0.06));
    }
  });
  tex("sandstone_top", (p) => { noisy(p, M("sand"), 0.05); });
  tex("gravel", (p) => {
    noisy(p, P.neutral5, 0.1);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = p.rand(Math.floor(x / 2), Math.floor(y / 2), 5);
      if (r < 0.3) p.set(x, y, p.shade(P.neutral4, 0.9 + r));
      else if (r > 0.8) p.set(x, y, p.shade(P.orange4, 0.85 + (r - 0.8)));
    }
  });
  tex("coal_ore", (p) => ore(p, P.neutral1, 21));
  tex("iron_ore", (p) => ore(p, P.orange4, 22));
  tex("gold_ore", (p) => ore(p, P.yellow4, 23));
  tex("diamond_ore", (p) => ore(p, P.teal4, 24));
  tex("log_side", (p) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const stripe = p.rand(x, 0, 30) < 0.3 ? 0.78 : 1;
      p.set(x, y, p.shade(C.BARK, stripe * (0.9 + p.rand(x, y, 31) * 0.2)));
    }
  });
  tex("log_top", (p) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (d > 6.5) p.set(x, y, p.shade(C.BARK, 0.95 + p.rand(x, y, 2) * 0.1));
      else p.set(x, y, p.shade(C.WOOD, Math.floor(d) % 2 === 0 ? 1.08 : 0.92));
    }
  });
  tex("planks", (p) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const board = Math.floor(y / 4);
      const seam = y % 4 === 3 || (x + board * 5) % 16 === 0;
      p.set(x, y, seam ? p.shade(C.WOOD, 0.7) : p.shade(C.WOOD, 0.95 + p.rand(x >> 2, y, board) * 0.1 + (p.rand(x, y, 3) - 0.5) * 0.05));
    }
  });
  tex("leaves", (p) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const r = p.rand(x, y, 40);
      if (r < 0.14) continue; // holes → cutout
      p.set(x, y, p.shade(M("leaves"), 0.8 + p.rand(x, y, 41) * 0.45));
    }
  });
  tex("glass", (p) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const edge = x === 0 || y === 0 || x === 15 || y === 15;
      const glint = (x - y === 4 || x - y === 6) && x > 3 && x < 12;
      if (edge) p.set(x, y, M("glass"));
      else if (glint) p.set(x, y, tone("glass", 1));
    }
  });
  tex("water", (p) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const wave = Math.sin((x + y * 0.5) * 0.8 + p.rand(0, y, 2) * 2) * 0.06;
      p.set(x, y, p.shade(R.water, 1 + wave + (p.rand(x, y, 50) - 0.5) * 0.05), 170);
    }
  });
  tex("ice", (p) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const crack = (x * 3 + y * 5) % 17 === 0;
      p.set(x, y, p.shade(R.ice, crack ? 1.12 : 0.95 + p.rand(x, y, 3) * 0.08), 200);
    }
  });
  tex("cactus_side", (p) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const rib = x % 4 === 1;
      p.set(x, y, p.shade(P.green2, rib ? 1.2 : 0.9 + p.rand(x, y, 2) * 0.1));
      if (rib && y % 5 === 2) p.set(x, y, P.yellow5);
    }
  });
  tex("cactus_top", (p) => { noisy(p, P.green2, 0.08); for (let i = 3; i < 13; i++) p.set(i, i, P.green3); });
  tex("crafting_table_top", (p) => {
    noisy(p, C.WOOD, 0.08);
    for (let i = 0; i < 16; i++) { p.set(i, 0, P.orange1); p.set(i, 15, P.orange1); p.set(0, i, P.orange1); p.set(15, i, P.orange1); }
    for (let i = 2; i < 14; i++) { p.set(i, 5, P.orange2); p.set(i, 10, P.orange2); p.set(5, i, P.orange2); p.set(10, i, P.orange2); }
  });
  tex("crafting_table_side", (p) => {
    noisy(p, C.WOOD, 0.08);
    for (let x = 0; x < 16; x++) for (let y = 0; y < 3; y++) p.set(x, y, p.shade(C.BARK, 1.1));
    mask(p, [
      "", "", "", "",
      "..nn........hh..",
      "..nn.......hhh..",
      "..ss......hhh...",
      "..ss.....sh.....",
      "..ss....ss......",
      "..ss...ss.......",
      "..ss..ss........",
      "..ss............",
    ], { n: P.neutral5, s: P.orange1, h: P.neutral6 });
  });
  tex("furnace_side", (p) => { noisy(p, C.STONE, 0.08); speckle(p, P.neutral4, 0.1); });
  tex("furnace_top", (p) => { noisy(p, P.neutral4, 0.08); });
  tex("furnace_front", (p) => {
    noisy(p, C.STONE, 0.08);
    for (let y = 7; y < 14; y++) for (let x = 3; x < 13; x++) p.set(x, y, y > 11 ? p.shade(R.danger, 0.8 + p.rand(x, y, 2) * 0.4) : P.neutral1);
    for (let x = 3; x < 13; x++) p.set(x, 6, P.neutral3);
  });
  tex("chest_side", (p) => {
    noisy(p, C.WOOD, 0.08);
    for (let x = 0; x < 16; x++) { p.set(x, 0, P.orange1); p.set(x, 15, P.orange1); p.set(x, 6, P.orange1); }
    for (let y = 0; y < 16; y++) { p.set(0, y, P.orange1); p.set(15, y, P.orange1); }
  });
  tex("chest_front", (p) => {
    noisy(p, C.WOOD, 0.08);
    for (let x = 0; x < 16; x++) { p.set(x, 0, P.orange1); p.set(x, 15, P.orange1); p.set(x, 6, P.orange1); }
    for (let y = 0; y < 16; y++) { p.set(0, y, P.orange1); p.set(15, y, P.orange1); }
    for (let y = 5; y < 9; y++) for (let x = 7; x < 9; x++) p.set(x, y, R.interact);
  });
  tex("chest_top", (p) => {
    noisy(p, C.WOOD, 0.08);
    for (let i = 0; i < 16; i++) { p.set(i, 0, P.orange1); p.set(i, 15, P.orange1); p.set(0, i, P.orange1); p.set(15, i, P.orange1); }
  });
  tex("torch", (p) => {
    for (let y = 6; y < 16; y++) { p.set(7, y, C.WOOD); p.set(8, y, p.shade(C.WOOD, 0.8)); }
    for (let y = 3; y < 6; y++) for (let x = 7; x < 9; x++) p.set(x, y, y === 3 ? P.yellow5 : R.interact);
    p.set(7, 2, P.yellow5);
  });
  tex("tall_grass", (p) => {
    for (let b = 0; b < 7; b++) {
      const x0 = 1 + b * 2 + Math.floor(p.rand(b, 0, 60) * 2);
      const h = 6 + Math.floor(p.rand(b, 1, 60) * 9);
      for (let y = 15; y > 15 - h; y--) {
        const x = x0 + Math.round((15 - y) * (p.rand(b, 2, 60) - 0.5) * 0.4);
        p.set(x, y, p.shade(P.green3, 0.8 + (15 - y) / h * 0.4));
      }
    }
  });
  tex("dandelion", (p) => {
    for (let y = 8; y < 16; y++) p.set(7, y, P.green2);
    p.set(6, 12, P.green3); p.set(8, 11, P.green3);
    blob(p, P.yellow4, 7.5, 6, 2.5, 2.5, P.yellow5);
  });
  tex("poppy", (p) => {
    for (let y = 8; y < 16; y++) p.set(7, y, P.green2);
    p.set(8, 12, P.green3);
    blob(p, R.danger, 7.5, 6, 3, 2.6);
    p.set(7, 6, P.neutral1);
  });
  tex("sapling", (p) => {
    for (let y = 9; y < 16; y++) p.set(7, y, C.BARK);
    blob(p, P.green2, 7.5, 6.5, 4.5, 4, P.green3);
  });
  tex("tnt_side", (p) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const band = y >= 5 && y <= 10;
      p.set(x, y, band ? P.neutral8 : p.shade(R.danger, x % 4 === 0 ? 0.8 : 1));
    }
    mask(p, ["", "", "", "", "", "", ".xxx.x..x.xxx..", "..x..xx.x..x...", "..x..x.xx..x...", "..x..x..x..x..."], { x: P.neutral1 });
  });
  tex("tnt_top", (p) => { noisy(p, R.danger, 0.06); blob(p, P.neutral7, 8, 8, 2.5, 2.5); p.set(8, 8, P.neutral1); });
  tex("bricks", (p) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const row = Math.floor(y / 4);
      const mortar = y % 4 === 3 || (x + (row % 2) * 4) % 8 === 7;
      p.set(x, y, mortar ? P.neutral6 : p.shade(P.red3, 0.85 + p.rand(x >> 1, row, 7) * 0.25));
    }
  });
  // Lamps: a bright core in a frame. Their light has its own colour (see lightColor below).
  const lamp = (p: TexturePainter, frame: string, core: string, glow: string) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const edge = x < 2 || y < 2 || x > 13 || y > 13;
      const bar = !edge && (x === 7 || x === 8 || y === 7 || y === 8);
      const d = Math.hypot(x - 7.5, y - 7.5) / 7;
      p.set(x, y, edge || bar ? p.shade(frame, 0.9 + p.rand(x, y, 61) * 0.2) : p.shade(d < 0.5 ? glow : core, 1.05 - d * 0.15));
    }
  };
  tex("lantern", (p) => lamp(p, P.neutral2, P.orange4, P.yellow5));
  tex("frost_lamp", (p) => lamp(p, P.neutral6, P.blue4, P.teal5));
  tex("crystal", (p) => {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const facet = ((x + y) % 7 === 0 || (x - y + 16) % 9 === 0);
      p.set(x, y, p.shade(facet ? P.violet5 : P.violet3, 0.9 + p.rand(x, y, 62) * 0.25));
    }
  });
  const neon = (name: string, c: string, hi: string) => tex(name, (p) => {
    noisy(p, P.neutral1, 0.1, 63);
    for (let i = 2; i < 14; i++) for (const [x, y] of [[i, 2], [i, 13], [2, i], [13, i], [i, 7], [i, 8]] as const) p.set(x, y, y === 7 || y === 8 ? hi : c);
  });
  neon("neon_pink", P.pink4, P.pink5);
  neon("neon_blue", P.blue4, P.blue5);
  neon("neon_green", P.green4, P.green5);
  neon("neon_yellow", P.yellow4, P.yellow5);
  tex("wool", (p) => { noisy(p, M("wool"), 0.06); speckle(p, tone("wool", -1), 0.15); });

  // ------------------------------------------------------------ item textures
  const toolMasks: Record<ToolType, string[]> = {
    pickaxe: [
      "................",
      "....mmmmmmmm....",
      "...mmmmmmmmmm...",
      "..mm....hh..mm..",
      "..m....hh....m..",
      "......hh........",
      ".....hh.........",
      "....hh..........",
      "...hh...........",
      "..hh............",
      ".hh.............",
      "hh..............",
    ],
    axe: [
      "................",
      "........mmm.....",
      ".......mmmmm....",
      "......mmmmmm....",
      "......hmmmm.....",
      ".....hh.mm......",
      "....hh..........",
      "...hh...........",
      "..hh............",
      ".hh.............",
      "hh..............",
    ],
    shovel: [
      ".............mm.",
      "............mmmm",
      "...........mmmm.",
      "..........mmmm..",
      ".........hmm....",
      "........hh......",
      ".......hh.......",
      "......hh........",
      ".....hh.........",
      "....hh..........",
      "...hh...........",
      "..hh............",
      ".hh.............",
      "hh..............",
    ],
    sword: [
      "..............mm",
      ".............mmm",
      "............mmm.",
      "...........mmm..",
      "..........mmm...",
      ".........mmm....",
      "........mmm.....",
      "...g...mmm......",
      "...gg.mmm.......",
      "....ggmm........",
      ".....hg.........",
      "....h.gg........",
      "...hh..g........",
      "..hh............",
      ".hh.............",
      "hh..............",
    ],
  };
  const materials: { name: string; tier: ToolTier; color: string; speed: number; durability: number; repair: string }[] = [
    { name: "wooden", tier: 1, get color() { return C.WOOD; }, speed: 2, durability: 59, repair: "planks" },
    { name: "stone", tier: 2, get color() { return P.neutral5; }, speed: 4, durability: 131, repair: "cobblestone" },
    { name: "iron", tier: 3, get color() { return P.neutral7; }, speed: 6, durability: 250, repair: "iron_ingot" },
    { name: "diamond", tier: 4, get color() { return P.teal4; }, speed: 8, durability: 1561, repair: "diamond" },
  ];
  const damageBy: Record<ToolType, number[]> = {
    sword: [10, 13, 16, 20],
    axe: [8, 11, 14, 18],
    pickaxe: [6, 7, 8, 9],
    shovel: [5, 6, 7, 8],
  };

  const itemTex = (name: string, paint: (p: TexturePainter) => void) => tex(`item_${name}`, paint);
  itemTex("stick", (p) => { for (let i = 2; i < 14; i++) { p.set(i, 15 - i, C.WOOD); p.set(i + 1, 15 - i, p.shade(C.WOOD, 0.75)); } });
  itemTex("coal", (p) => blob(p, P.neutral2, 8, 8.5, 5, 4.5, P.neutral4));
  itemTex("iron_ingot", (p) => mask(p, ["", "", "", "", "", ".....mmmmmm.....", "....mmmmmmmm....", "...mmmmmmmmmm...", "..mmmmmmmmmmmm..", "..dddddddddddd.."], { m: P.neutral7, d: P.neutral5 }));
  itemTex("gold_ingot", (p) => mask(p, ["", "", "", "", "", ".....mmmmmm.....", "....mmmmmmmm....", "...mmmmmmmmmm...", "..mmmmmmmmmmmm..", "..dddddddddddd.."], { m: P.yellow4, d: P.yellow2 }));
  itemTex("diamond", (p) => mask(p, ["", "", "", ".....hhhhhh.....", "....hmmmmmmh....", "...hmmmlmmmmh...", "..hmmmllmmmmmh..", "...mmmmmmmmmm...", "....mmmmmmmm....", ".....mmmmmm.....", "......mmmm......", ".......mm......."], { m: P.teal4, h: P.teal5, l: P.neutral8 }));
  itemTex("flint", (p) => blob(p, P.neutral2, 8, 8, 3.5, 5, P.neutral4));
  itemTex("gunpowder", (p) => { for (let i = 0; i < 40; i++) { const x = 3 + Math.floor(p.rand(i, 0, 70) * 10); const y = 5 + Math.floor(p.rand(i, 1, 70) * 9); p.set(x, y, p.shade(P.neutral4, 0.7 + p.rand(i, 2, 70) * 0.6)); } });
  itemTex("flint_and_steel", (p) => { mask(p, ["", "", "...mmmm.........", "..m....m........", "..m....m........", "...m..m.........", "....mm.........."], { m: P.neutral6 }); blob(p, P.neutral2, 11, 11, 3, 3.5); });
  itemTex("apple", (p) => { blob(p, P.red3, 8, 9, 5, 5, P.red4); p.set(8, 3, C.BARK); p.set(8, 4, C.BARK); p.set(9, 3, P.green3); p.set(10, 3, P.green3); });
  itemTex("porkchop", (p) => { blob(p, P.pink4, 8, 8, 6, 4.5, P.pink5); blob(p, P.neutral8, 11, 8, 1.5, 2); });
  itemTex("cooked_porkchop", (p) => { blob(p, P.orange3, 8, 8, 6, 4.5, P.orange4); blob(p, P.yellow5, 11, 8, 1.5, 2); });
  itemTex("beef", (p) => { blob(p, P.red3, 8, 8, 6, 5, P.red4); speckle(p, P.neutral8, 0.0); });
  itemTex("steak", (p) => { blob(p, P.orange2, 8, 8, 6, 5, P.orange3); });
  itemTex("chicken", (p) => { blob(p, P.pink5, 9, 7, 4.5, 4, P.neutral8); for (let i = 0; i < 5; i++) p.set(4 - (i >> 1), 10 + i, P.neutral7); });
  itemTex("cooked_chicken", (p) => { blob(p, P.orange3, 9, 7, 4.5, 4, P.orange4); for (let i = 0; i < 5; i++) p.set(4 - (i >> 1), 10 + i, P.orange5); });
  itemTex("rotten_flesh", (p) => { blob(p, P.red2, 8, 8, 6, 4, P.green3); speckle(p, P.green2, 0.06); });
  itemTex("feather", (p) => { for (let i = 2; i < 14; i++) { p.set(i, 15 - i, P.neutral7); p.set(i + 1, 15 - i, P.neutral8); p.set(i - 1, 15 - i, P.neutral8); } });
  itemTex("leather", (p) => blob(p, P.orange2, 8, 8, 6, 5.5, P.orange3));
  for (const m of materials)
    for (const t of Object.keys(toolMasks) as ToolType[])
      itemTex(`${m.name}_${t}`, (p) => mask(p, toolMasks[t], { m: m.color, h: C.WOOD, g: P.neutral4 }));

  // Creature gear (loot.ts): drawn in marker colours, main #ff0000 and accent #0000ff, that the
  // client repaints with the creature's own colours for each piece.
  const GEAR_MASKS: Record<string, string[]> = {
    helm: ["", "", "....mmmmmmmm....", "...mmmmmmmmmm...", "..mmmaaaaaammm..", "..mmaaaaaaaamm..", "..mm........mm..", "..mm..d..d..mm..", "..mm........mm..", "..mmm......mmm..", "...mm......mm...", "...aa......aa..."],
    plate: ["", "..mm........mm..", ".mmmm......mmmm.", ".mmmmmmmmmmmmmm.", ".mmmmaaaaaammmm.", "..mmmaaaaaammm..", "...mmmmmmmmmm...", "...mmmmmmmmmm...", "...mmmaaaammm...", "...mmmmmmmmmm...", "...mmmmmmmmmm...", "....aaaaaaaa...."],
    legs: ["", "...aaaaaaaaaa...", "...mmmmmmmmmm...", "...mmmmmmmmmm...", "...mmmm..mmmm...", "...mmmm..mmmm...", "...mmm....mmm...", "...mmm....mmm...", "...mmm....mmm...", "...mmm....mmm...", "...aaa....aaa...", "...aaa....aaa..."],
    boots: ["", "", "", "", "...mmm....mmm...", "...mmm....mmm...", "...mmm....mmm...", "...mmm....mmm...", "..mmmm...mmmm...", ".mmmmm..mmmmm...", ".aaaaa..aaaaa...", ""],
    sword: ["..............mm", ".............mmm", "............mmm.", "...........mmm..", "..........mmm...", ".........mmm....", "........mmm.....", "...d...mmm......", "....d.mmm.......", ".....aaa........", "....aaad........", "...aa..d........", "..aa............", ".dd............."],
    spear: ["..............mm", ".............mmm", "............mmm.", "...........ma...", "..........dd....", ".........dd.....", "........dd......", ".......dd.......", "......dd........", ".....dd.........", "....dd..........", "...dd...........", "..dd............", ".dd............."],
    staff: [".........aaaa...", "........aammaa..", "........ammmma..", "........aammaa..", ".........aaaa...", "........dd......", ".......dd.......", "......dd........", ".....dd.........", "....dd..........", "...dd...........", "..dd............", ".dd............."],
    charm: [".......dd.......", "......d..d......", ".....dddddd.....", "....dmmmmmmd....", "....dmaaaamd....", "....dmaaaamd....", "....dmaaaamd....", "....dmmmmmmd....", ".....dddddd.....", "......dddd......"],
  };
  for (const [kind, rows] of Object.entries(GEAR_MASKS))
    itemTex(`relic_${kind}`, (p) => mask(p, rows.map((r) => r.padEnd(16, ".")), { m: "#ff0000", a: "#0000ff", d: P.neutral2 }));

  // ------------------------------------------------------------ blocks
  const pick = { tool: "pickaxe" as const };
  reg.addBlock("stone", { displayName: "Stone", faces: "stone", hardness: 1.5, ...pick, minTier: 1, drops: [{ item: "cobblestone" }], color: C.STONE, tags: ["stone"] });
  reg.addBlock("grass", { displayName: "Grass Block", faces: { top: "grass_top", side: "grass_side", bottom: "dirt" }, hardness: 0.6, tool: "shovel", drops: [{ item: "dirt" }], color: C.GRASS, tags: ["soil"] });
  reg.addBlock("dirt", { displayName: "Dirt", faces: "dirt", hardness: 0.5, tool: "shovel", color: C.DIRT, tags: ["soil"] });
  reg.addBlock("cobblestone", { displayName: "Cobblestone", faces: "cobblestone", hardness: 2, ...pick, minTier: 1, color: C.STONE, tags: ["stone"] });
  reg.addBlock("planks", { displayName: "Oak Planks", faces: "planks", hardness: 2, tool: "axe", color: C.WOOD, tags: ["wood", "flammable"] });
  reg.addBlock("bedrock", { displayName: "Bedrock", faces: "bedrock", hardness: -1, drops: [], color: P.neutral2 });
  reg.addBlock("water", {
    displayName: "Water", faces: "water", solid: false, opaque: false, render: "liquid", hardness: -1,
    replaceable: true, liquid: true, drops: [], color: R.water,
  });
  reg.addBlock("sand", { displayName: "Sand", faces: "sand", hardness: 0.5, tool: "shovel", gravity: true, color: P.yellow5 });
  reg.addBlock("gravel", { displayName: "Gravel", faces: "gravel", hardness: 0.6, tool: "shovel", gravity: true, drops: [{ item: "gravel", chance: 0.9 }, { item: "flint", chance: 0.1 }], color: P.neutral5 });
  reg.addBlock("coal_ore", { displayName: "Coal Ore", faces: "coal_ore", hardness: 3, ...pick, minTier: 1, drops: [{ item: "coal" }], color: P.neutral2, tags: ["ore"] });
  reg.addBlock("iron_ore", { displayName: "Iron Ore", faces: "iron_ore", hardness: 3, ...pick, minTier: 2, color: P.orange4, tags: ["ore"] });
  reg.addBlock("gold_ore", { displayName: "Gold Ore", faces: "gold_ore", hardness: 3, ...pick, minTier: 3, color: P.yellow4, tags: ["ore"] });
  reg.addBlock("diamond_ore", { displayName: "Diamond Ore", faces: "diamond_ore", hardness: 3, ...pick, minTier: 3, drops: [{ item: "diamond" }], color: P.teal4, tags: ["ore"] });
  reg.addBlock("log", { displayName: "Oak Log", faces: { top: "log_top", bottom: "log_top", side: "log_side" }, hardness: 2, tool: "axe", color: C.BARK, tags: ["wood", "log", "flammable"] });
  reg.addBlock("leaves", {
    displayName: "Oak Leaves", faces: "leaves", opaque: false, render: "cutout", hardness: 0.2,
    drops: [{ item: "sapling", chance: 0.06 }, { item: "apple", chance: 0.02 }], color: P.green2, tags: ["leaves", "flammable"],
  });
  reg.addBlock("glass", { displayName: "Glass", faces: "glass", opaque: false, render: "cutout", hardness: 0.3, drops: [], color: P.neutral7 });
  reg.addBlock("sandstone", { displayName: "Sandstone", faces: { top: "sandstone_top", bottom: "sandstone_top", side: "sandstone_side" }, hardness: 0.8, ...pick, minTier: 1, color: P.yellow5 });
  reg.addBlock("snow", { displayName: "Snow Block", faces: "snow", hardness: 0.2, tool: "shovel", color: P.neutral8 });
  reg.addBlock("snowy_grass", { displayName: "Snowy Grass", faces: { top: "snow", side: "snowy_grass_side", bottom: "dirt" }, hardness: 0.6, tool: "shovel", drops: [{ item: "dirt" }], color: P.neutral8, tags: ["soil"] });
  reg.addBlock("ice", { displayName: "Ice", faces: "ice", opaque: false, render: "translucent", hardness: 0.5, ...pick, drops: [], color: R.ice });
  reg.addBlock("cactus", { displayName: "Cactus", faces: { top: "cactus_top", bottom: "cactus_top", side: "cactus_side" }, hardness: 0.4, needsSupport: true, color: P.green2, tags: ["plant", "hurts"] });
  reg.addBlock("tall_grass", { displayName: "Tall Grass", faces: "tall_grass", solid: false, opaque: false, render: "cross", hardness: 0, replaceable: true, needsSupport: true, drops: [], color: P.green3, tags: ["plant"] });
  reg.addBlock("dandelion", { displayName: "Dandelion", faces: "dandelion", solid: false, opaque: false, render: "cross", hardness: 0, needsSupport: true, color: P.yellow4, tags: ["plant", "flower"] });
  reg.addBlock("poppy", { displayName: "Poppy", faces: "poppy", solid: false, opaque: false, render: "cross", hardness: 0, needsSupport: true, color: R.danger, tags: ["plant", "flower"] });
  reg.addBlock("sapling", { displayName: "Oak Sapling", faces: "sapling", solid: false, opaque: false, render: "cross", hardness: 0, needsSupport: true, color: P.green2, tags: ["plant", "sapling"] });
  reg.addBlock("crafting_table", { displayName: "Crafting Table", faces: { top: "crafting_table_top", bottom: "planks", side: "crafting_table_side" }, hardness: 2.5, tool: "axe", container: "crafting", color: C.WOOD, tags: ["wood", "flammable"] });
  reg.addBlock("furnace", { displayName: "Furnace", faces: { top: "furnace_top", bottom: "furnace_top", side: "furnace_side", front: "furnace_front" }, hardness: 3.5, ...pick, minTier: 1, container: "furnace", color: C.STONE });
  reg.addBlock("chest", { displayName: "Chest", faces: { top: "chest_top", bottom: "chest_top", side: "chest_side", front: "chest_front" }, hardness: 2.5, tool: "axe", container: "chest", color: C.WOOD, tags: ["wood"] });
  reg.addBlock("torch", { displayName: "Torch", faces: "torch", solid: false, opaque: false, render: "cross", hardness: 0, light: 14, needsSupport: true, color: R.interact, tags: ["light"] });
  reg.addBlock("tnt", { displayName: "TNT", faces: { top: "tnt_top", bottom: "tnt_top", side: "tnt_side" }, hardness: 0, color: R.danger, tags: ["explosive"] });
  reg.addBlock("stone_bricks", { displayName: "Stone Bricks", faces: "stone_bricks", hardness: 1.5, ...pick, minTier: 1, color: C.STONE });
  reg.addBlock("bricks", { displayName: "Bricks", faces: "bricks", hardness: 2, ...pick, minTier: 1, color: P.red3 });
  reg.addBlock("wool", { displayName: "White Wool", faces: "wool", hardness: 0.8, color: P.neutral8, tags: ["flammable"] });
  // Lights in colour. Torches stay warm; these tint the world around them.
  const lit = (name: string, displayName: string, light: number, lightColor: [number, number, number], color: string, extra: Record<string, unknown> = {}) =>
    reg.addBlock(name, { displayName, faces: name, hardness: 0.6, ...pick, light, lightColor, color, tags: ["light"], ...extra });
  lit("lantern", "Lantern", 15, [1, 0.74, 0.42], P.orange4);
  lit("frost_lamp", "Frost Lamp", 14, [0.55, 0.82, 1], P.blue4);
  lit("crystal", "Crystal", 11, [0.72, 0.42, 1], P.violet3, { opaque: false, render: "translucent" });
  lit("neon_pink", "Pink Neon", 12, [1, 0.32, 0.7], P.pink4);
  lit("neon_blue", "Blue Neon", 12, [0.3, 0.55, 1], P.blue4);
  lit("neon_green", "Green Neon", 12, [0.35, 1, 0.5], P.green4);
  lit("neon_yellow", "Yellow Neon", 12, [1, 0.9, 0.35], P.yellow4);

  // ------------------------------------------------------------ items
  reg.addItem("stick", { displayName: "Stick", texture: "item_stick", fuel: 5 });
  reg.addItem("coal", { displayName: "Coal", texture: "item_coal", fuel: 80 });
  reg.addItem("iron_ingot", { displayName: "Iron Ingot", texture: "item_iron_ingot" });
  reg.addItem("gold_ingot", { displayName: "Gold Ingot", texture: "item_gold_ingot" });
  reg.addItem("diamond", { displayName: "Diamond", texture: "item_diamond" });
  reg.addItem("flint", { displayName: "Flint", texture: "item_flint" });
  reg.addItem("gunpowder", { displayName: "Gunpowder", texture: "item_gunpowder" });
  reg.addItem("flint_and_steel", { displayName: "Flint and Steel", texture: "item_flint_and_steel", maxStack: 1, tags: ["igniter"] });
  reg.addItem("apple", { displayName: "Apple", texture: "item_apple", food: 4 });
  reg.addItem("porkchop", { displayName: "Raw Porkchop", texture: "item_porkchop", food: 3 });
  reg.addItem("cooked_porkchop", { displayName: "Cooked Porkchop", texture: "item_cooked_porkchop", food: 8 });
  reg.addItem("beef", { displayName: "Raw Beef", texture: "item_beef", food: 3 });
  reg.addItem("steak", { displayName: "Steak", texture: "item_steak", food: 8 });
  reg.addItem("chicken", { displayName: "Raw Chicken", texture: "item_chicken", food: 2 });
  reg.addItem("cooked_chicken", { displayName: "Cooked Chicken", texture: "item_cooked_chicken", food: 6 });
  reg.addItem("rotten_flesh", { displayName: "Rotten Flesh", texture: "item_rotten_flesh", food: 4 });
  reg.addItem("feather", { displayName: "Feather", texture: "item_feather" });
  reg.addItem("leather", { displayName: "Leather", texture: "item_leather" });
  // Creature gear: one base item per kind; what each piece is lives on its stack (meta, loot.ts).
  for (const [kind, name] of [["helm", "Helm"], ["plate", "Chest Plate"], ["legs", "Greaves"], ["boots", "Boots"], ["sword", "Fang Sword"], ["spear", "Horn Spear"], ["staff", "Staff"], ["charm", "Lantern"]])
    reg.addItem(`relic_${kind}`, { displayName: name, texture: `item_relic_${kind}`, maxStack: 1, tags: ["gear"] });
  for (const [k, m] of materials.entries()) {
    for (const t of Object.keys(toolMasks) as ToolType[]) {
      const pretty = `${m.name[0].toUpperCase()}${m.name.slice(1)} ${t[0].toUpperCase()}${t.slice(1)}`;
      reg.addItem(`${m.name}_${t}`, {
        displayName: pretty,
        texture: `item_${m.name}_${t}`,
        tool: { type: t, tier: m.tier, speed: m.speed, durability: m.durability },
        damage: damageBy[t][k],
        fuel: m.name === "wooden" ? 10 : undefined,
      });
    }
  }
  // Fuel values for blocks.
  for (const name of ["log", "planks", "crafting_table", "chest", "sapling"]) reg.item(name).fuel = name === "sapling" ? 5 : 15;

  // ------------------------------------------------------------ recipes
  reg.addRecipe({ kind: "shapeless", ingredients: ["log"], result: { item: "planks", count: 4 } });
  reg.addRecipe({ kind: "shaped", pattern: ["P", "P"], key: { P: "planks" }, result: { item: "stick", count: 4 } });
  reg.addRecipe({ kind: "shaped", pattern: ["PP", "PP"], key: { P: "planks" }, result: { item: "crafting_table", count: 1 } });
  reg.addRecipe({ kind: "shaped", pattern: ["CCC", "C C", "CCC"], key: { C: "cobblestone" }, result: { item: "furnace", count: 1 } });
  reg.addRecipe({ kind: "shaped", pattern: ["PPP", "P P", "PPP"], key: { P: "planks" }, result: { item: "chest", count: 1 } });
  reg.addRecipe({ kind: "shaped", pattern: ["C", "S"], key: { C: "coal", S: "stick" }, result: { item: "torch", count: 4 } });
  reg.addRecipe({ kind: "shaped", pattern: ["GSG", "SGS", "GSG"], key: { G: "gunpowder", S: "sand" }, result: { item: "tnt", count: 1 } });
  reg.addRecipe({ kind: "shapeless", ingredients: ["iron_ingot", "flint"], result: { item: "flint_and_steel", count: 1 } });
  reg.addRecipe({ kind: "shaped", pattern: ["SS", "SS"], key: { S: "sand" }, result: { item: "sandstone", count: 1 } });
  reg.addRecipe({ kind: "shaped", pattern: ["SS", "SS"], key: { S: "stone" }, result: { item: "stone_bricks", count: 4 } });
  reg.addRecipe({ kind: "shaped", pattern: ["SS", "SS"], key: { S: "snow" }, result: { item: "ice", count: 1 } });
  reg.addRecipe({ kind: "shaped", pattern: ["FF", "FF"], key: { F: "feather" }, result: { item: "wool", count: 1 } });
  reg.addRecipe({ kind: "shapeless", ingredients: ["iron_ingot", "torch"], result: { item: "lantern", count: 1 } });
  reg.addRecipe({ kind: "shapeless", ingredients: ["ice", "torch"], result: { item: "frost_lamp", count: 1 } });
  reg.addRecipe({ kind: "shapeless", ingredients: ["glass", "diamond"], result: { item: "crystal", count: 4 } });
  for (const [name, dye] of [["neon_pink", "poppy"], ["neon_blue", "ice"], ["neon_green", "cactus"], ["neon_yellow", "dandelion"]])
    reg.addRecipe({ kind: "shapeless", ingredients: ["glass", dye, "torch"], result: { item: name, count: 2 } });
  for (const m of materials) {
    const key = { M: m.repair, S: "stick" };
    reg.addRecipe({ kind: "shaped", pattern: ["MMM", " S ", " S "], key, result: { item: `${m.name}_pickaxe`, count: 1 } });
    reg.addRecipe({ kind: "shaped", pattern: ["MM", "MS", " S"], key, result: { item: `${m.name}_axe`, count: 1 } });
    reg.addRecipe({ kind: "shaped", pattern: ["M", "S", "S"], key, result: { item: `${m.name}_shovel`, count: 1 } });
    reg.addRecipe({ kind: "shaped", pattern: ["M", "M", "S"], key, result: { item: `${m.name}_sword`, count: 1 } });
  }

  const smelt = (input: string, output: string) => reg.addSmelting({ input, output, seconds: 10 });
  smelt("cobblestone", "stone");
  smelt("sand", "glass");
  smelt("iron_ore", "iron_ingot");
  smelt("gold_ore", "gold_ingot");
  smelt("log", "coal");
  smelt("porkchop", "cooked_porkchop");
  smelt("beef", "steak");
  smelt("chicken", "cooked_chicken");
  smelt("dirt", "bricks");

  // ------------------------------------------------------------ entity types
  const biped = (skin: string, shirt: string, pants: string, face: string): ModelPart[] => [
    { name: "legL", size: [4, 12, 4], pivot: [-2, 12, 0], offset: [-2, -12, -2], color: pants, anim: "legL" },
    { name: "legR", size: [4, 12, 4], pivot: [2, 12, 0], offset: [-2, -12, -2], color: pants, anim: "legR" },
    { name: "body", size: [8, 12, 4], pivot: [0, 12, 0], offset: [-4, 0, -2], color: shirt },
    { name: "armL", size: [4, 12, 4], pivot: [-6, 24, 0], offset: [-2, -12, -2], color: skin, anim: "armL" },
    { name: "armR", size: [4, 12, 4], pivot: [6, 24, 0], offset: [-2, -12, -2], color: skin, anim: "armR" },
    { name: "head", size: [8, 8, 8], pivot: [0, 24, 0], offset: [-4, 0, -4], color: skin, frontColor: face, anim: "head" },
  ];
  const quad = (legH: number, body: [number, number, number], bodyColor: string, head: [number, number, number], headColor: string, face: string, legColor = bodyColor): ModelPart[] => {
    const lx = body[0] / 2 - 2, lz = body[2] / 2 - 3;
    return [
      { name: "legFL", size: [4, legH, 4], pivot: [-lx, legH, lz], offset: [-2, -legH, -2], color: legColor, anim: "legL" },
      { name: "legFR", size: [4, legH, 4], pivot: [lx, legH, lz], offset: [-2, -legH, -2], color: legColor, anim: "legR" },
      { name: "legBL", size: [4, legH, 4], pivot: [-lx, legH, -lz], offset: [-2, -legH, -2], color: legColor, anim: "legR" },
      { name: "legBR", size: [4, legH, 4], pivot: [lx, legH, -lz], offset: [-2, -legH, -2], color: legColor, anim: "legL" },
      { name: "body", size: body, pivot: [0, legH, 0], offset: [-body[0] / 2, 0, -body[2] / 2], color: bodyColor },
      { name: "head", size: head, pivot: [0, legH + body[1] - 2, body[2] / 2], offset: [-head[0] / 2, 0, -1], color: headColor, frontColor: face, anim: "head" },
    ];
  };
  reg.addEntityType({ name: "player", displayName: "Player", width: 0.6, height: 1.8, maxHealth: std.balance.player.health, kind: "player", model: biped(P.orange4, P.blue3, P.blue1, P.orange2), tags: [] });
  reg.addEntityType({ name: "zombie", displayName: "Zombie", width: 0.6, height: 1.9, maxHealth: 60, kind: "hostile", model: biped(P.green3, P.teal2, P.violet2, P.green1), tags: ["undead", "armsForward"] });
  reg.addEntityType({ name: "creeper", displayName: "Creeper", width: 0.6, height: 1.7, maxHealth: 50, kind: "hostile", tags: ["explodes"], model: [
    { name: "legFL", size: [4, 6, 4], pivot: [-2, 6, 2], offset: [-2, -6, -2], color: P.green2, anim: "legL" },
    { name: "legFR", size: [4, 6, 4], pivot: [2, 6, 2], offset: [-2, -6, -2], color: P.green2, anim: "legR" },
    { name: "legBL", size: [4, 6, 4], pivot: [-2, 6, -2], offset: [-2, -6, -2], color: P.green2, anim: "legR" },
    { name: "legBR", size: [4, 6, 4], pivot: [2, 6, -2], offset: [-2, -6, -2], color: P.green2, anim: "legL" },
    { name: "body", size: [8, 12, 4], pivot: [0, 6, 0], offset: [-4, 0, -2], color: P.green3 },
    { name: "head", size: [8, 8, 8], pivot: [0, 18, 0], offset: [-4, 0, -4], color: P.green3, frontColor: P.neutral1, anim: "head" },
  ] });
  reg.addEntityType({ name: "pig", displayName: "Pig", width: 0.9, height: 0.9, maxHealth: 30, kind: "passive", tags: [], model: quad(6, [10, 8, 16], P.pink4, [8, 8, 8], P.pink4, P.pink3) });
  reg.addEntityType({ name: "cow", displayName: "Cow", width: 0.9, height: 1.4, maxHealth: 30, kind: "passive", tags: [], model: quad(12, [12, 10, 18], P.orange1, [8, 8, 6], P.orange1, P.neutral7, P.neutral7) });
  reg.addEntityType({ name: "chicken", displayName: "Chicken", width: 0.4, height: 0.7, maxHealth: 15, kind: "passive", tags: [], model: [
    { name: "legL", size: [1, 5, 1], pivot: [-1.5, 5, 0], offset: [-0.5, -5, -0.5], color: P.yellow3, anim: "legL" },
    { name: "legR", size: [1, 5, 1], pivot: [1.5, 5, 0], offset: [-0.5, -5, -0.5], color: P.yellow3, anim: "legR" },
    { name: "body", size: [6, 6, 8], pivot: [0, 5, 0], offset: [-3, 0, -4], color: P.neutral8 },
    { name: "wingL", size: [1, 4, 6], pivot: [-3, 10, 0], offset: [-1, -4, -3], color: P.neutral7, anim: "wingL" },
    { name: "wingR", size: [1, 4, 6], pivot: [3, 10, 0], offset: [0, -4, -3], color: P.neutral7, anim: "wingR" },
    { name: "head", size: [4, 6, 3], pivot: [0, 9, 3], offset: [-2, 0, 0], color: P.neutral8, frontColor: P.yellow3, anim: "head" },
  ] });
  reg.addEntityType({ name: "item", displayName: "Item", width: 0.25, height: 0.25, maxHealth: 5, kind: "item", model: [], tags: [] });
  reg.addEntityType({ name: "tnt", displayName: "Primed TNT", width: 0.98, height: 0.98, maxHealth: 1, kind: "object", model: [], tags: ["block"] });
  reg.addEntityType({ name: "falling_block", displayName: "Falling Block", width: 0.98, height: 0.98, maxHealth: 1, kind: "object", model: [], tags: ["block"] });
}
