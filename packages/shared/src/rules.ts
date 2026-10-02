import type { BlockDef, ItemDef, ItemStack, Registry } from "./registry";

/** Can this tool (or bare hand) get drops from this block? */
export function canHarvest(block: BlockDef, tool: ItemDef | undefined): boolean {
  if (block.minTier === 0) return true;
  return !!tool?.tool && tool.tool.type === block.tool && tool.tool.tier >= block.minTier;
}

/**
 * Seconds needed to break a block (Minecraft's formula): hardness × 1.5 with
 * the right tool tier, × 5 without; divided by tool speed when the tool type
 * matches. Creative mode breaks instantly (handled by the caller).
 */
export function digTime(block: BlockDef, tool: ItemDef | undefined, opts: { inWater?: boolean; onGround?: boolean } = {}): number {
  if (block.hardness < 0) return Infinity;
  if (block.hardness === 0) return 0;
  let speed = 1;
  if (tool?.tool && tool.tool.type === block.tool) speed = tool.tool.speed;
  if (tool?.tool?.type === "sword" && block.tags.includes("leaves")) speed = 1.5;
  let t = (block.hardness * (canHarvest(block, tool) ? 1.5 : 5)) / speed;
  if (opts.inWater) t *= 5;
  if (opts.onGround === false) t *= 5;
  return t;
}

/** Roll the drops for breaking a block. */
export function rollDrops(reg: Registry, block: BlockDef, tool: ItemDef | undefined, rand: () => number): ItemStack[] {
  if (!canHarvest(block, tool)) return [];
  const drops = block.drops ?? [{ item: block.name }];
  const out: ItemStack[] = [];
  for (const d of drops) {
    if (d.chance !== undefined && rand() >= d.chance) continue;
    if (!reg.hasItem(d.item)) continue;
    out.push(reg.stack(d.item, d.count ?? 1));
  }
  return out;
}

/** Melee damage dealt by an item (or the bare hand). */
export function meleeDamage(item: ItemDef | undefined, handDamage = 5): number {
  return item?.damage ?? handDamage;
}

export const REACH = 5;
export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const EYE_HEIGHT = 1.62;
