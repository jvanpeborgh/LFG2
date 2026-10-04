import type { ItemStack, Slot } from "@lfg/shared";
import type { ServerModule } from "../../kernel";
import type { Player } from "../../player";
import type { BlockEntity } from "../../world";

/** Crafting table (3×3 crafting), chests (27 slots, shared between viewers) and furnaces. */
export const containers: ServerModule = {
  id: "vanilla:containers",
  name: "Containers",
  version: "0.1.0",
  author: "lfg",
  description: "Crafting tables, chests and furnaces.",
  setup(api) {
    const { reg, world } = api;
    const smeltOf = (s: ItemStack) => {
      const name = reg.itemById(s.item)?.name;
      return reg.smelting.find((r) => r.input === name);
    };
    const isFuel = (s: ItemStack) => (reg.itemById(s.item)?.fuel ?? 0) > 0;
    const viewers = (x: number, y: number, z: number): Player[] =>
      api.players().filter((p) => p.window?.pos && p.window.pos[0] === x && p.window.pos[1] === y && p.window.pos[2] === z);

    const getOrCreate = (x: number, y: number, z: number, kind: string, groups: Record<string, number>): BlockEntity => {
      let be = world.getBlockEntity(x, y, z);
      if (!be || be.kind !== kind) {
        be = { kind, slots: {}, data: {} };
        for (const [name, size] of Object.entries(groups)) be.slots[name] = Array(size).fill(null);
        world.setBlockEntity(x, y, z, be);
      }
      return be;
    };

    /**
     * A ruin's chest, opened for the first time: a cache of useful things (more of the plain ones,
     * now and then something rare), and a little XP for finding it.
     */
    const LOOT: [string, number, number, number][] = [
      // item, chance, min, max
      ["iron_ingot", 0.8, 2, 6], ["coal", 0.7, 4, 12], ["torch", 0.6, 4, 10], ["apple", 0.55, 2, 5], ["cooked_porkchop", 0.4, 1, 4],
      ["gold_ingot", 0.4, 1, 4], ["flint_and_steel", 0.12, 1, 1], ["diamond", 0.16, 1, 2], ["gunpowder", 0.25, 1, 4], ["feather", 0.3, 2, 6],
    ];
    const fillRuinChest = (slots: Slot[], finder: Player) => {
      let found = 0;
      // At least three kinds of things in every cache: the luck is in which, and how much.
      const picked = LOOT.filter(([, chance]) => api.rand() < chance);
      for (const extra of LOOT) if (picked.length < 3 && !picked.includes(extra)) picked.push(extra);
      for (const [name, , lo, hi] of picked) {
        const item = reg.items.find((i) => i.name === name);
        if (!item) continue;
        let slot = Math.floor(api.rand() * slots.length);
        while (slots[slot]) slot = (slot + 1) % slots.length;
        slots[slot] = { item: item.id, count: lo + Math.floor(api.rand() * (hi - lo + 1)) };
        found++;
      }
      api.tell(finder, `✦ You found an old cache in the ruins: ${found} kinds of things`);
      api.use<{ award(p: Player, xp: number, reason: string): void }>("progression")?.award(finder, 30, "found a ruin's cache");
    };

    api.on("intent:useBlock", (e) => {
      const def = reg.blockById(e.block);
      if (!def.container) return;
      const p = e.player;
      e.handled = true;
      const pos: [number, number, number] = [e.x, e.y, e.z];
      const playerSections = [
        { id: "main", role: "storage" as const, slots: p.main },
        { id: "hotbar", role: "storage" as const, slots: p.hotbar },
      ];
      if (def.container === "crafting") {
        const grid: Slot[] = Array(9).fill(null);
        api.openWindow(p, {
          state: {
            kind: "crafting",
            sections: [{ id: "result", role: "result", slots: [null] }, { id: "craft", role: "craftGrid", width: 3, slots: grid }, ...playerSections],
          },
          onClose: () => {
            for (const s of grid) if (s) {
              const left = p.give(s);
              if (left > 0) api.spawnItem(p.entity.x, p.entity.y + 1, p.entity.z, { ...s, count: left });
            }
          },
        });
      } else if (def.container === "chest") {
        const fresh = !world.getBlockEntity(e.x, e.y, e.z);
        const be = getOrCreate(e.x, e.y, e.z, "chest", { items: 27 });
        if (fresh && world.ruinChestAt(e.x, e.y, e.z)) fillRuinChest(be.slots.items, p);
        api.openWindow(p, { pos, state: { kind: "chest", sections: [{ id: "chest", role: "storage", slots: be.slots.items }, ...playerSections] } });
      } else if (def.container === "furnace") {
        const be = getOrCreate(e.x, e.y, e.z, "furnace", { input: 1, fuel: 1, output: 1 });
        api.openWindow(p, {
          pos,
          state: {
            kind: "furnace",
            sections: [
              { id: "input", role: "storage", slots: be.slots.input, accepts: (s) => !!smeltOf(s) },
              { id: "fuel", role: "storage", slots: be.slots.fuel, accepts: isFuel },
              { id: "output", role: "output", slots: be.slots.output },
              ...playerSections,
            ],
          },
        });
      }
    });

    // Everyone looking at the same chest/furnace shares its slot arrays; just refresh their view.
    api.on("window:click", ({ player }) => {
      const pos = player.window?.pos;
      if (!pos) return;
      for (const v of viewers(...pos)) if (v !== player) api.refreshWindow(v);
    });

    // Furnaces: burn fuel, cook items (10 s each).
    api.every(0.25, (dt) => {
      for (const [key, be] of world.blockEntities()) {
        if (be.kind !== "furnace") continue;
        const { input, fuel, output } = be.slots;
        const d = be.data;
        d.burn = Math.max(0, (d.burn ?? 0) - dt);
        const inStack = input[0], fuelStack = fuel[0], outStack = output[0];
        const recipe = inStack ? smeltOf(inStack) : undefined;
        const outDef = recipe ? reg.item(recipe.output) : undefined;
        const canOutput = !!outDef && (!outStack || (outStack.item === outDef.id && outStack.count < outDef.maxStack));
        if (recipe && canOutput && d.burn <= 0 && fuelStack && isFuel(fuelStack)) {
          d.burn = d.burnMax = reg.itemById(fuelStack.item)!.fuel!;
          fuelStack.count--;
          if (fuelStack.count <= 0) fuel[0] = null;
        }
        const wasActive = d.burn > 0 || (d.cook ?? 0) > 0;
        if (recipe && canOutput && d.burn > 0) {
          d.cook = (d.cook ?? 0) + dt;
          if (d.cook >= recipe.seconds) {
            d.cook = 0;
            inStack!.count--;
            if (inStack!.count <= 0) input[0] = null;
            output[0] = outStack ? { ...outStack, count: outStack.count + 1 } : reg.stack(outDef!.name);
          }
        } else if ((d.cook ?? 0) > 0) {
          d.cook = Math.max(0, d.cook - dt * 2);
        }
        if (wasActive) {
          const [x, y, z] = key.split(",").map(Number);
          for (const v of viewers(x, y, z)) api.refreshWindow(v);
        }
      }
    });

    // Breaking a container spills its contents; close windows looking at it.
    api.on("block:changed", (e) => {
      if (!e.removedEntity) return;
      for (const group of Object.values(e.removedEntity.slots))
        for (const s of group) if (s) api.spawnItem(e.x + 0.5, e.y + 0.5, e.z + 0.5, s);
      for (const v of viewers(e.x, e.y, e.z)) api.closeWindow(v);
    });
  },
};
