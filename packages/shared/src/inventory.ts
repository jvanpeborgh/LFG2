import type { ItemStack, Registry, RecipeDef } from "./registry";

export type Slot = ItemStack | null;

export const HOTBAR_SIZE = 9;
export const INVENTORY_SIZE = 36; // 0..8 hotbar, 9..35 main

export function maxStack(reg: Registry, s: ItemStack): number {
  return reg.itemById(s.item)?.maxStack ?? 64;
}

export function sameItem(a: ItemStack, b: ItemStack): boolean {
  return a.item === b.item && a.durability === b.durability;
}

export function cloneStack(s: Slot): Slot {
  return s ? { ...s } : null;
}

/** Add a stack into slots (merging first, then empty slots). Returns how many didn't fit. */
export function addToSlots(reg: Registry, slots: Slot[], stack: ItemStack, order?: number[]): number {
  let left = stack.count;
  const idx = order ?? slots.map((_, i) => i);
  const max = maxStack(reg, stack);
  for (const i of idx) {
    const s = slots[i];
    if (left <= 0) break;
    if (s && sameItem(s, stack) && s.count < max) {
      const n = Math.min(left, max - s.count);
      s.count += n;
      left -= n;
    }
  }
  for (const i of idx) {
    if (left <= 0) break;
    if (!slots[i]) {
      const n = Math.min(left, max);
      slots[i] = { ...stack, count: n };
      left -= n;
    }
  }
  return left;
}

/** Hotbar first, then main inventory (Minecraft pickup order). */
export const PICKUP_ORDER = Array.from({ length: INVENTORY_SIZE }, (_, i) => i);

export function countItem(slots: Slot[], item: number): number {
  let n = 0;
  for (const s of slots) if (s && s.item === item) n += s.count;
  return n;
}

export function removeItem(slots: Slot[], item: number, count: number): number {
  let left = count;
  for (let i = 0; i < slots.length && left > 0; i++) {
    const s = slots[i];
    if (s && s.item === item) {
      const n = Math.min(left, s.count);
      s.count -= n;
      left -= n;
      if (s.count <= 0) slots[i] = null;
    }
  }
  return count - left;
}

// ---------------------------------------------------------------- crafting

/** Trim empty rows/columns of a w×w grid to a list of item-name rows. */
function normalizeGrid(reg: Registry, grid: Slot[], w: number): string[][] {
  const rows: string[][] = [];
  for (let y = 0; y < w; y++) {
    const row: string[] = [];
    for (let x = 0; x < w; x++) {
      const s = grid[y * w + x];
      row.push(s ? reg.itemById(s.item)?.name ?? "?" : "");
    }
    rows.push(row);
  }
  let top = 0, bottom = w - 1, left = 0, right = w - 1;
  const rowEmpty = (y: number) => rows[y].every((c) => c === "");
  const colEmpty = (x: number) => rows.every((r) => r[x] === "");
  while (top <= bottom && rowEmpty(top)) top++;
  while (bottom >= top && rowEmpty(bottom)) bottom--;
  while (left <= right && colEmpty(left)) left++;
  while (right >= left && colEmpty(right)) right--;
  if (top > bottom) return [];
  return rows.slice(top, bottom + 1).map((r) => r.slice(left, right + 1));
}

function matchShaped(recipe: Extract<RecipeDef, { kind: "shaped" }>, g: string[][], mirror: boolean): boolean {
  const p = recipe.pattern;
  if (p.length !== g.length) return false;
  const pw = Math.max(...p.map((r) => r.length));
  if (g[0].length !== pw) return false;
  for (let y = 0; y < p.length; y++) {
    for (let x = 0; x < pw; x++) {
      const ch = p[y][mirror ? pw - 1 - x : x] ?? " ";
      const want = ch === " " ? "" : recipe.key[ch];
      if (want === undefined) return false;
      if (want !== g[y][x]) return false;
    }
  }
  return true;
}

/** Find the recipe result for a crafting grid of width w (2 or 3). */
export function matchRecipe(reg: Registry, grid: Slot[], w: number): ItemStack | null {
  const g = normalizeGrid(reg, grid, w);
  if (g.length === 0) return null;
  const names = g.flat().filter((n) => n !== "").sort();
  for (const r of reg.recipes) {
    if (r.kind === "shaped") {
      if (matchShaped(r, g, false) || matchShaped(r, g, true)) return reg.stack(r.result.item, r.result.count);
    } else {
      const want = [...r.ingredients].sort();
      if (want.length === names.length && want.every((n, i) => n === names[i])) return reg.stack(r.result.item, r.result.count);
    }
  }
  return null;
}

/** Remove one of each ingredient from the grid after a craft. */
export function consumeGrid(grid: Slot[]): void {
  for (let i = 0; i < grid.length; i++) {
    const s = grid[i];
    if (s) {
      s.count--;
      if (s.count <= 0) grid[i] = null;
    }
  }
}

// ---------------------------------------------------------------- windows

export type SectionRole = "storage" | "craftGrid" | "result" | "output";

export interface Section {
  id: string;
  role: SectionRole;
  slots: Slot[];
  /** Grid width for crafting grids. */
  width?: number;
  /** Only accepts items matching this filter (e.g. fuel). */
  accepts?: (s: ItemStack) => boolean;
}

export interface WindowState {
  kind: "inventory" | "crafting" | "chest" | "furnace";
  sections: Section[];
}

export interface Cursor {
  stack: Slot;
}

export function locateSlot(win: WindowState, index: number): { section: Section; i: number } | null {
  let base = 0;
  for (const section of win.sections) {
    if (index < base + section.slots.length) return { section, i: index - base };
    base += section.slots.length;
  }
  return null;
}

export function updateCraftResult(reg: Registry, win: WindowState): void {
  const grid = win.sections.find((s) => s.role === "craftGrid");
  const result = win.sections.find((s) => s.role === "result");
  if (grid && result) result.slots[0] = matchRecipe(reg, grid.slots, grid.width ?? 2);
}

function shiftTargets(win: WindowState, from: Section): Section[] {
  const player = win.sections.filter((s) => s.id === "hotbar" || s.id === "main");
  const isPlayer = from.id === "hotbar" || from.id === "main";
  if (!isPlayer) return [win.sections.find((s) => s.id === "main")!, win.sections.find((s) => s.id === "hotbar")!].filter(Boolean);
  const containers = win.sections.filter((s) => s.role === "storage" && s.id !== "hotbar" && s.id !== "main");
  if (containers.length > 0) return containers;
  // Plain inventory: move between hotbar and main.
  return player.filter((s) => s !== from);
}

/**
 * Apply a click to a window, Minecraft style.
 * button 0 = left (pick up all / place all / swap), 1 = right (half / one).
 * Returns the items crafted (for stats/events) or null.
 */
export function windowClick(
  reg: Registry,
  win: WindowState,
  cursor: Cursor,
  index: number,
  button: 0 | 1,
  shift: boolean,
): ItemStack | null {
  const loc = locateSlot(win, index);
  if (!loc) return null;
  const { section, i } = loc;
  const slot = section.slots[i];

  if (section.role === "result") {
    if (!slot) return null;
    const grid = win.sections.find((s) => s.role === "craftGrid")!;
    if (shift) {
      // Craft as many as fit into the player inventory.
      let craftedCount = 0;
      let craftedItem: ItemStack | undefined;
      for (let n = 0; n < 64; n++) {
        const res = section.slots[0];
        if (!res) break;
        const targets = shiftTargets(win, section);
        const trial = targets.map((t) => t.slots.map(cloneStack));
        let left = res.count;
        for (const t of trial) left = left > 0 ? addToSlots(reg, t, { ...res, count: left }) : 0;
        if (left > 0) break;
        targets.forEach((t, k) => t.slots.splice(0, t.slots.length, ...trial[k]));
        craftedItem ??= { ...res };
        craftedCount += res.count;
        consumeGrid(grid.slots);
        updateCraftResult(reg, win);
      }
      return craftedItem ? { ...craftedItem, count: craftedCount } : null;
    }
    const c = cursor.stack;
    if (c && (!sameItem(c, slot) || c.count + slot.count > maxStack(reg, slot))) return null;
    cursor.stack = c ? { ...c, count: c.count + slot.count } : { ...slot };
    consumeGrid(grid.slots);
    updateCraftResult(reg, win);
    return { ...slot };
  }

  if (shift) {
    if (!slot) return null;
    const targets = shiftTargets(win, section);
    let left = slot.count;
    for (const t of targets) {
      if (left <= 0) break;
      if (t.accepts && !t.accepts(slot)) continue;
      left = addToSlots(reg, t.slots, { ...slot, count: left });
    }
    section.slots[i] = left > 0 ? { ...slot, count: left } : null;
    if (section.role === "craftGrid") updateCraftResult(reg, win);
    return null;
  }

  const c = cursor.stack;
  const canPlace = section.role !== "output" && (!c || !section.accepts || section.accepts(c));
  if (button === 0) {
    if (!c) {
      cursor.stack = slot;
      section.slots[i] = null;
    } else if (!slot) {
      if (canPlace) { section.slots[i] = c; cursor.stack = null; }
    } else if (sameItem(c, slot)) {
      if (section.role === "output") {
        const room = maxStack(reg, c) - c.count;
        const n = Math.min(room, slot.count);
        c.count += n; slot.count -= n;
        if (slot.count <= 0) section.slots[i] = null;
      } else {
        const room = maxStack(reg, slot) - slot.count;
        const n = Math.min(room, c.count);
        slot.count += n; c.count -= n;
        if (c.count <= 0) cursor.stack = null;
      }
    } else if (canPlace) {
      section.slots[i] = c;
      cursor.stack = slot;
    }
  } else {
    if (!c) {
      if (slot) {
        const take = Math.ceil(slot.count / 2);
        cursor.stack = { ...slot, count: take };
        slot.count -= take;
        if (slot.count <= 0) section.slots[i] = null;
      }
    } else if (canPlace) {
      if (!slot) {
        section.slots[i] = { ...c, count: 1 };
        c.count--;
      } else if (sameItem(c, slot) && slot.count < maxStack(reg, slot)) {
        slot.count++;
        c.count--;
      }
      if (c.count <= 0) cursor.stack = null;
    }
  }
  if (section.role === "craftGrid") updateCraftResult(reg, win);
  return null;
}

/** Plain-data version of a window for sending to the client. */
export interface WindowSnapshot {
  kind: WindowState["kind"];
  sections: { id: string; role: SectionRole; width?: number; slots: Slot[] }[];
  /** Furnace progress 0..1 and fuel 0..1. */
  progress?: number;
  fuel?: number;
}

export function snapshotWindow(win: WindowState): WindowSnapshot {
  return {
    kind: win.kind,
    sections: win.sections.map((s) => ({ id: s.id, role: s.role, width: s.width, slots: s.slots.map(cloneStack) })),
  };
}
