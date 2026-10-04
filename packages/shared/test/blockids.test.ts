import { describe, expect, it } from "vitest";
import { DEFAULT_STANDARDS, VANILLA_CONTENT, buildRegistry } from "../src";

// Saved worlds store blocks by number (their id: the order they're registered in). A new block
// must go at the end; moving or removing one would turn every saved block after it into another.
const SHIPPED = ["air","stone","grass","dirt","cobblestone","planks","bedrock","water","sand","gravel","coal_ore","iron_ore","gold_ore","diamond_ore","log","leaves","glass","sandstone","snow","snowy_grass","ice","cactus","tall_grass","dandelion","poppy","sapling","crafting_table","furnace","chest","torch","tnt","stone_bricks","bricks","wool","lantern","frost_lamp","crystal","neon_pink","neon_blue","neon_green","neon_yellow","item_box","iron_block","gold_block"];

describe("block ids", () => {
  it("keeps every shipped block's id (new blocks are appended)", () => {
    const reg = buildRegistry([VANILLA_CONTENT.id], DEFAULT_STANDARDS);
    expect(reg.blocks.slice(0, SHIPPED.length).map((b) => b.name)).toEqual(SHIPPED);
  });
});
