import { stepBody, steer, WORLD_HEIGHT } from "@lfg/shared";
import type { Entity } from "../../entities";
import type { ServerModule } from "../../kernel";
import type { Player } from "../../player";
import type { ExplodeFn } from "./explosives";

interface MobState {
  /** Wander target. */
  tx?: number;
  tz?: number;
  nextThink: number;
  panic: number;
  /** Telegraph timer before an attack lands (standards: ≥ 0.75 s warning). */
  windup: number;
  cooldown: number;
  fuse: number;
  burn: number;
}

const DROPS: Record<string, [string, number, number][]> = {
  pig: [["porkchop", 1, 3]],
  cow: [["beef", 1, 3], ["leather", 0, 2]],
  chicken: [["chicken", 1, 1], ["feather", 0, 2]],
  zombie: [["rotten_flesh", 0, 2]],
  creeper: [["gunpowder", 0, 2]],
};

/**
 * Mobs: pigs, cows and chickens wander and flee when hurt; zombies chase
 * players at night and in caves (and burn in daylight); creepers hiss for
 * 1.5 s before exploding. Attacks are always telegraphed.
 */
export const mobs: ServerModule = {
  id: "vanilla:mobs",
  name: "Mobs",
  version: "0.1.0",
  author: "lfg",
  description: "Passive animals, zombies and creepers with spawning, AI and drops.",
  setup(api) {
    const { reg, table, world } = api;
    const grass = reg.blockId("grass");
    const snowyGrass = reg.blockId("snowy_grass");
    const bal = api.std.balance;
    // Read live so a rule change applies immediately; never below the 0.75 s comfort minimum.
    const telegraph = () => Math.max(0.75, api.std.audio.telegraphLeadSeconds);

    const state = (e: Entity): MobState => {
      if (!e.data.mob) e.data.mob = { nextThink: 0, panic: 0, windup: 0, cooldown: 0, fuse: 0, burn: 0 } satisfies MobState;
      return e.data.mob as MobState;
    };
    // Generated summons have their own behaviour (vanilla:summons).
    const isMob = (e: Entity) => (e.type.kind === "passive" || e.type.kind === "hostile") && !e.type.summon;
    const isNight = () => {
      const { time, dayLength } = api.time();
      const f = time / dayLength;
      return f > 0.54 && f < 0.96;
    };
    const skyExposed = (x: number, y: number, z: number) => {
      for (let yy = Math.floor(y + 2); yy < WORLD_HEIGHT; yy++) if (table.opaque[world.getBlock(Math.floor(x), yy, Math.floor(z))]) return false;
      return true;
    };
    const nearestTarget = (e: Entity, range: number): Player | null => {
      let best: Player | null = null, bestD = range * range;
      for (const p of api.players()) {
        if (p.dead || p.gameMode === "creative") continue;
        const d = p.entity.distanceSq(e.x, e.y, e.z);
        if (d < bestD) { bestD = d; best = p; }
      }
      return best;
    };

    // ------------------------------------------------------------ spawning
    api.every(1, () => {
      const players = api.players();
      if (players.length === 0) return;
      const night = isNight();
      for (const p of players) {
        let passive = 0, hostile = 0;
        for (const e of api.entities.near(p.entity.x, p.entity.y, p.entity.z, 72, isMob)) e.type.kind === "passive" ? passive++ : hostile++;
        for (let attempt = 0; attempt < 3; attempt++) {
          const ang = api.rand() * Math.PI * 2;
          const dist = 24 + api.rand() * 32;
          const x = Math.floor(p.entity.x + Math.cos(ang) * dist), z = Math.floor(p.entity.z + Math.sin(ang) * dist);
          if (!world.isLoaded(x, 64, z)) continue;
          const sy = world.surfaceY(x, z);
          if (sy < 0) continue;
          const ground = world.getBlock(x, sy, z);
          if (table.liquid[world.getBlock(x, sy + 1, z)]) continue;
          // Passive animals on grass, rarely.
          if (passive < 8 && (ground === grass || ground === snowyGrass) && api.rand() < 0.08) {
            const type = ["pig", "cow", "chicken", "pig", "cow"][Math.floor(api.rand() * 5)];
            const herd = 1 + Math.floor(api.rand() * 3);
            for (let i = 0; i < herd; i++) {
              const e = api.spawnEntity(type, x + 0.5 + api.rand() - 0.5, sy + 1, z + 0.5 + api.rand() - 0.5);
              e.yaw = api.rand() * Math.PI * 2;
            }
            passive += herd;
            continue;
          }
          if (hostile >= 10) continue;
          // Hostiles at night on the surface, or any time in dark caves.
          let y = -1;
          if (night && api.rand() < 0.35) y = sy + 1;
          else if (api.rand() < 0.25) {
            // Look for a cave floor below the surface.
            for (let yy = Math.min(sy - 8, Math.floor(p.entity.y) + 8); yy > 4; yy--) {
              if (table.solid[world.getBlock(x, yy - 1, z)] && !table.solid[world.getBlock(x, yy, z)] && !table.solid[world.getBlock(x, yy + 1, z)] && !table.liquid[world.getBlock(x, yy, z)]) { y = yy; break; }
            }
          }
          if (y < 0) continue;
          const type = api.rand() < 0.7 ? "zombie" : "creeper";
          const e = api.spawnEntity(type, x + 0.5, y, z + 0.5);
          e.yaw = api.rand() * Math.PI * 2;
          hostile++;
        }
      }
      // Despawn hostiles far from everyone, and anything absurdly far.
      for (const e of api.entities.all.values()) {
        if (!isMob(e)) continue;
        let near = Infinity;
        for (const p of players) near = Math.min(near, p.entity.distanceSq(e.x, e.y, e.z));
        if ((e.type.kind === "hostile" && near > 96 * 96) || near > 160 * 160) api.entities.remove(e);
      }
    });

    // ------------------------------------------------------------ AI + physics
    api.on("tick", ({ dt }) => {
      const now = performance.now() / 1000;
      const night = isNight();
      const explode = api.use<ExplodeFn>("explode");
      for (const e of api.entities.all.values()) {
        if (!isMob(e)) continue;
        if (!world.isLoaded(Math.floor(e.x), Math.floor(e.y), Math.floor(e.z))) continue;
        // Frozen by a spell (crowd control): it stays put.
        if (Number(e.data.frozenUntil ?? 0) > Date.now()) { e.body.vx = e.body.vz = 0; continue; }
        const s = state(e);
        const b = e.body;
        let wishX = 0, wishZ = 0, speed = 0;
        s.cooldown = Math.max(0, s.cooldown - dt);

        if (e.type.kind === "passive") {
          s.panic = Math.max(0, s.panic - dt);
          if (now > s.nextThink || (s.tx !== undefined && Math.hypot(s.tx - e.x, (s.tz ?? 0) - e.z) < 0.7)) {
            s.nextThink = now + 2 + api.rand() * 6;
            if (api.rand() < 0.6) { s.tx = e.x + (api.rand() - 0.5) * 12; s.tz = e.z + (api.rand() - 0.5) * 12; }
            else { s.tx = undefined; s.tz = undefined; }
          }
          if (s.tx !== undefined && s.tz !== undefined) {
            const dx = s.tx - e.x, dz = s.tz - e.z, d = Math.hypot(dx, dz) || 1;
            wishX = dx / d; wishZ = dz / d;
            speed = s.panic > 0 ? 3.2 : 1.3;
          }
        } else {
          const target = nearestTarget(e, e.type.name === "creeper" ? 16 : 24);
          if (target) {
            const dx = target.entity.x - e.x, dz = target.entity.z - e.z;
            const dh = Math.hypot(dx, dz) || 1;
            const dy = target.entity.y - e.y;
            if (e.type.name === "creeper") {
              if (dh < 3 && Math.abs(dy) < 2) s.fuse += dt;
              else s.fuse = Math.max(0, s.fuse - dt);
              e.flags = s.fuse > 0 ? e.flags | 4 : e.flags & ~4;
              if (s.fuse > 0 && s.fuse - dt <= 0) api.sendNear(e.x, e.y, e.z, 32, { t: "entityEvent", id: e.id, event: "fuse" });
              if (s.fuse >= 1.5) {
                api.entities.remove(e);
                explode?.(e.x, e.y + 0.8, e.z, 3, e);
                continue;
              }
              if (s.fuse === 0) { wishX = dx / dh; wishZ = dz / dh; speed = 2.4; }
            } else {
              const inReach = dh < 1.4 && Math.abs(dy) < 1.6;
              if (inReach || s.windup > 0) {
                if (s.windup === 0 && s.cooldown === 0) {
                  s.windup = telegraph();
                  api.sendNear(e.x, e.y, e.z, 48, { t: "entityEvent", id: e.id, event: "swing" });
                }
                if (s.windup > 0) {
                  s.windup -= dt;
                  if (s.windup <= 0) {
                    s.windup = 0;
                    s.cooldown = 0.6;
                    if (inReach && api.damage(target.entity, bal.damage.lightHit, { kind: "melee", attacker: e })) api.knockback(target.entity, e.x, e.z, 4);
                  }
                }
              }
              if (!inReach) { wishX = dx / dh; wishZ = dz / dh; speed = 2.6; }
            }
            e.yaw = Math.atan2(-dx, -dz);
          } else {
            s.fuse = 0;
            e.flags &= ~4;
            if (now > s.nextThink) {
              s.nextThink = now + 3 + api.rand() * 5;
              s.tx = e.x + (api.rand() - 0.5) * 10; s.tz = e.z + (api.rand() - 0.5) * 10;
            }
            if (s.tx !== undefined && s.tz !== undefined && Math.hypot(s.tx - e.x, s.tz - e.z) > 0.7) {
              const dx = s.tx - e.x, dz = s.tz - e.z, d = Math.hypot(dx, dz);
              wishX = dx / d; wishZ = dz / d; speed = 1;
            }
          }
          // Zombies burn in daylight under open sky.
          if (e.type.tags.includes("undead") && !night && skyExposed(e.x, e.y, e.z) && !b.inWater) {
            s.burn += dt;
            if (s.burn >= 1) { s.burn = 0; api.damage(e, 6, { kind: "fire" }); }
          }
        }

        steer(b, wishX, wishZ, speed, dt, b.onGround ? 10 : 2);
        if (speed > 0 && e.type.kind === "passive") e.yaw = Math.atan2(-wishX, -wishZ);
        if ((b.hitWall && b.onGround) || (b.inWater && speed > 0)) b.vy = b.inWater ? 3 : 8.5;
        stepBody(world.store, table, b, dt, { gravity: bal.player.gravity });
        e.flags = Math.hypot(b.vx, b.vz) > 0.3 ? e.flags | 2 : e.flags & ~2;
        // Fall damage for mobs too.
        if (b.onGround && b.fallDistance === 0 && (e.data.fallFrom as number) > bal.player.fallDamageAfterBlocks) {
          api.damage(e, Math.floor((e.data.fallFrom as number) - bal.player.fallDamageAfterBlocks) * 5, { kind: "fall" });
        }
        e.data.fallFrom = b.fallDistance;
        if (e.y < -32) api.entities.remove(e);
      }
    });

    api.on("entity:damage", ({ entity, source }) => {
      if (entity.type.kind === "passive") state(entity).panic = 4;
      if (source.attacker && isMob(entity)) state(entity).nextThink = 0;
    });

    api.on("entity:death", ({ entity }) => {
      const drops = DROPS[entity.type.name];
      if (!drops) return;
      for (const [item, min, max] of drops) {
        const n = min + Math.floor(api.rand() * (max - min + 1));
        if (n > 0) api.spawnItem(entity.x, entity.y + 0.5, entity.z, reg.stack(item, n));
      }
    });

  },
};
