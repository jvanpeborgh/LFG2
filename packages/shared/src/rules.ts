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

// ------------------------------------------------------------------ world rules (standards values)

export type RuleValue = number | boolean | string;

/** Read a dotted path ("balance.player.gravity") from the standards. */
export function getRule(std: object, path: string): unknown {
  let cur: unknown = std;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object" || !(part in (cur as object))) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/**
 * Set a dotted path in place. In place matters: modules and clients keep
 * references to sub-objects (e.g. `std.balance.player`), and they should see
 * the new value without being reloaded.
 */
export function setRule(std: object, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur = std as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) cur = cur[part] as Record<string, unknown>;
  cur[parts[parts.length - 1]] = value;
}

/** Every changeable leaf value, as [path, value]. Locked values are excluded. */
export function listRules(std: object, prefix = ""): [string, RuleValue][] {
  const out: [string, RuleValue][] = [];
  const walk = (o: unknown, path: string) => {
    if (Array.isArray(o)) {
      o.forEach((v, i) => walk(v, `${path}.${i}`));
    } else if (o !== null && typeof o === "object") {
      for (const [k, v] of Object.entries(o)) walk(v, path ? `${path}.${k}` : k);
    } else if (["number", "boolean", "string"].includes(typeof o)) {
      if (!path.startsWith("locked.") && !["version", "notes"].includes(path)) out.push([path, o as RuleValue]);
    }
  };
  walk(std, "");
  return out.filter(([p]) => p.startsWith(prefix));
}

/** Turn command text into a typed value matching the current one. */
export function parseRuleValue(current: unknown, text: string): RuleValue | undefined {
  if (typeof current === "number") {
    const n = Number(text);
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof current === "boolean") return text === "true" || text === "on" ? true : text === "false" || text === "off" ? false : undefined;
  if (typeof current === "string") return text;
  return undefined;
}

/**
 * Is this change allowed? Returns a reason if not. Locked values (health,
 * safety, performance) can't change; others must keep their type and stay
 * within a sane range of the current value, so one change can't wreck the world.
 */
export function checkRuleChange(std: object, path: string, value: RuleValue): string | null {
  if (path.startsWith("locked.") || path === "version" || path === "notes") return `${path} is locked and can't be changed in-game`;
  const current = getRule(std, path);
  if (current === undefined) return `There's no rule called ${path}`;
  if (current !== null && typeof current === "object") return `${path} is a group of rules; change one value inside it`;
  if (typeof value !== typeof current) return `${path} must be a ${typeof current}`;
  if (typeof value === "number") {
    const cur = current as number;
    if (!Number.isFinite(value)) return "Value must be a finite number";
    if (cur !== 0 && (value / cur < 0.1 || value / cur > 10)) return `${path} can change by at most 10× at once (now ${cur})`;
    if (cur === 0 && Math.abs(value) > 1000) return `${path} is too far from its current value`;
    if (cur > 0 && value <= 0) return `${path} must stay above zero`;
  }
  if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(String(current)) && !/^#[0-9a-f]{6}$/i.test(value)) return `${path} must be a colour like #33aa55`;
  // Materials point at palette colours.
  if (path.startsWith("art.materials.") && !(String(value) in ((std as { art?: { palette?: object } }).art?.palette ?? {}))) return `${path} must name a palette colour, like green3 or pink4`;
  // A few rules must respect locked limits.
  const locked = (std as { locked?: Record<string, unknown> }).locked ?? {};
  if (path === "balance.player.respawnSeconds" && (value as number) > (locked.respawnMaxSeconds as number)) return `Respawn can't be longer than ${locked.respawnMaxSeconds}s`;
  if (path === "balance.damage.maxHitShareOfHealth" && (value as number) > 1) return "One hit can't do more than 100% of max health";
  return null;
}
