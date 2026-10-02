import { boxCollides, digTime, rollDrops, stepBody } from "@lfg/shared";
import type { ServerModule } from "../../kernel";
import type { Player } from "../../player";

/**
 * Mining and building: validated digging (time depends on block hardness and
 * tool), placing blocks, item drops, and simple block physics (sand and
 * gravel fall, plants and torches pop off without support).
 */
export const building: ServerModule = {
  id: "vanilla:building",
  name: "Mining & building",
  version: "0.1.0",
  author: "lfg",
  description: "Dig with the right tools, place blocks, falling sand/gravel, plants need support.",
  setup(api) {
    const { reg, table, world } = api;
    const AIR = 0;
    const sandId = reg.blockId("sand");
    const cactusId = reg.blockId("cactus");
    const soil = new Set(["grass", "dirt", "snowy_grass"].map((n) => reg.blockId(n)));

    /** Tell a client the real block when its action was rejected. */
    const resync = (p: Player, x: number, y: number, z: number) =>
      p.send({ t: "blocks", changes: [[x, y, z, world.getBlock(x, y, z)]] });

    const breakBlock = (x: number, y: number, z: number, drops: boolean, tool?: ReturnType<typeof reg.itemById>) => {
      const id = world.getBlock(x, y, z);
      const def = reg.blockById(id);
      if (!world.setBlock(x, y, z, AIR)) return false;
      api.sendNear(x, y, z, 48, { t: "blockBreakFx", x, y, z, block: id });
      if (drops) for (const s of rollDrops(reg, def, tool, api.rand)) api.spawnItem(x + 0.5, y + 0.3, z + 0.5, s);
      return true;
    };
    api.provide("breakBlock", breakBlock);

    api.on("intent:dig", (e) => {
      const p = e.player;
      if (e.action === "start") {
        p.dig = { x: e.x, y: e.y, z: e.z, started: performance.now() };
        api.sendNear(p.entity.x, p.entity.y, p.entity.z, 48, { t: "entityEvent", id: p.entity.id, event: "swing" });
        return;
      }
      if (e.action === "cancel") {
        p.dig = null;
        return;
      }
      const id = world.getBlock(e.x, e.y, e.z);
      const def = reg.blockById(id);
      if (id === AIR || def.liquid || def.hardness < 0) return resync(p, e.x, e.y, e.z);
      const held = p.heldStack ? reg.itemById(p.heldStack.item) : undefined;
      if (p.gameMode !== "creative") {
        const need = digTime(def, held, { inWater: p.entity.body.inWater, onGround: p.entity.body.onGround || p.flying });
        const d = p.dig;
        const elapsed = d && d.x === e.x && d.y === e.y && d.z === e.z ? (performance.now() - d.started) / 1000 : 0;
        // Allow for network jitter: accept 70% of the time minus 150 ms.
        if (need > 0 && elapsed < need * 0.7 - 0.15) return resync(p, e.x, e.y, e.z);
      }
      p.dig = null;
      const creative = p.gameMode === "creative";
      if (!breakBlock(e.x, e.y, e.z, !creative, held)) return resync(p, e.x, e.y, e.z);
      if (!creative && held?.tool && def.hardness > 0) p.damageHeldTool();
      p.exhaustion += 0.005;
      api.emit("block:broken", { player: p, x: e.x, y: e.y, z: e.z, block: id });
    });

    // Using a block (opening a chest, lighting TNT) takes priority over placing against it.
    api.on("intent:place", (e) => {
      const use = api.emit("intent:useBlock", { player: e.player, x: e.x, y: e.y, z: e.z, block: world.getBlock(e.x, e.y, e.z), handled: false });
      if (use.handled) e.handled = true;
    }, -10);

    api.on("intent:place", (e) => {
      if (e.handled) return;
      const p = e.player;
      const held = p.heldStack;
      const item = held ? reg.itemById(held.item) : undefined;
      if (!held || !item || item.block === undefined) return;
      const blockDef = reg.blockById(item.block);
      const target = world.getBlock(e.x, e.y, e.z);
      let [x, y, z] = [e.x, e.y, e.z];
      if (!table.replaceable[target] || target === AIR) {
        x += e.nx; y += e.ny; z += e.nz;
      }
      const existing = world.getBlock(x, y, z);
      if (!table.replaceable[existing] || !world.isLoaded(x, y, z)) return resync(p, x, y, z);
      // Plants, torches and cactus need the right block underneath.
      const below = world.getBlock(x, y - 1, z);
      if (blockDef.needsSupport) {
        const ok = blockDef.name === "cactus" ? below === sandId || below === cactusId
          : blockDef.tags.includes("plant") ? soil.has(below)
          : table.solid[below] === 1;
        if (!ok) return resync(p, x, y, z);
      }
      // Don't place solid blocks inside players or mobs.
      if (blockDef.solid) {
        for (const ent of api.entities.near(x + 0.5, y + 0.5, z + 0.5, 3)) {
          if (ent.type.kind === "item") continue;
          const hw = ent.body.width / 2;
          const overlap = ent.x + hw > x && ent.x - hw < x + 1 && ent.y + ent.body.height > y && ent.y < y + 1 && ent.z + hw > z && ent.z - hw < z + 1;
          if (overlap) return resync(p, x, y, z);
        }
      }
      if (!world.setBlock(x, y, z, blockDef.id)) return resync(p, x, y, z);
      p.consumeHeld();
      e.handled = true;
    });

    // Gravity and support checks when something next to a block changes.
    api.on("block:neighbor", (e) => {
      const def = reg.blockById(e.id);
      if (def.gravity) {
        const below = world.getBlock(e.x, e.y - 1, e.z);
        if (!table.solid[below] && world.isLoaded(e.x, e.y - 1, e.z)) {
          world.setBlock(e.x, e.y, e.z, AIR);
          const fb = api.spawnEntity("falling_block", e.x + 0.5, e.y, e.z + 0.5);
          fb.data.block = e.id;
        }
      } else if (def.needsSupport) {
        const below = world.getBlock(e.x, e.y - 1, e.z);
        const ok = def.name === "cactus" ? below === sandId || below === cactusId : table.solid[below] === 1;
        if (!ok) breakBlock(e.x, e.y, e.z, true);
      }
    });

    api.on("tick", ({ dt }) => {
      for (const e of api.entities.all.values()) {
        if (e.type.name !== "falling_block") continue;
        stepBody(world.store, table, e.body, dt, { gravity: api.std.balance.player.gravity });
        if (e.body.onGround || e.age > 30) {
          const x = Math.floor(e.x), y = Math.floor(e.y + 0.2), z = Math.floor(e.z);
          const block = e.data.block as number;
          api.entities.remove(e);
          if (table.replaceable[world.getBlock(x, y, z)] && !boxCollides(world.store, table, x, y, z, x + 1, y + 1, z + 1)) world.setBlock(x, y, z, block);
          else {
            const item = reg.itemForBlock(block);
            if (item) api.spawnItem(x + 0.5, y + 0.5, z + 0.5, reg.stack(item.name));
          }
        }
      }
    });
  },
};
