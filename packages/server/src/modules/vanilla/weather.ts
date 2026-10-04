import type { ServerModule } from "../../kernel";
import type { Player } from "../../player";

/**
 * Weather: clear skies, rain (snow where it's cold) and thunderstorms, in a slow cycle.
 *
 *   rain      darkens the sky, plants grow faster (the nature module asks), clients draw rain or
 *             snow and play the patter
 *   thunder   rain plus lightning: a strike is announced first (the air crackles and a ring shows
 *             where it will land, for over a second), then hits everyone inside the ring. Step out.
 *             Never in the spawn safe zone or on players in creative; at most one strike in a while.
 *
 * Admins can set it: /weather clear | rain | thunder [minutes].
 */
export type WeatherKind = "clear" | "rain" | "thunder";
export interface WeatherService { kind(): WeatherKind; raining(): boolean }

interface WeatherState { kind: WeatherKind; until: number }

const MINUTE = 60_000;
const WARN_SECONDS = 1.4;
const STRIKE_RADIUS = 2.2;

export const weather: ServerModule = {
  id: "vanilla:weather", name: "Weather", version: "0.1.0", author: "lfg",
  description: "Rain, snow and thunderstorms, with lightning you can see coming.",
  setup(api) {
    const saved = api.storage.load<WeatherState>("weather");
    const state: WeatherState = saved ?? { kind: "clear", until: Date.now() + (6 + api.rand() * 9) * MINUTE };
    const send = (p?: Player) => {
      const msg = { t: "weather" as const, kind: state.kind };
      if (p) p.send(msg); else for (const q of api.players()) q.send(msg);
    };
    const set = (kind: WeatherKind, minutes?: number) => {
      state.kind = kind;
      const m = minutes ?? (kind === "clear" ? 6 + api.rand() * 9 : kind === "rain" ? 2 + api.rand() * 3 : 1.5 + api.rand() * 1.5);
      state.until = Date.now() + m * MINUTE;
      api.storage.save("weather", state);
      send();
    };
    api.provide("weather", { kind: () => state.kind, raining: () => state.kind !== "clear" } satisfies WeatherService);
    api.on("player:join", ({ player }) => send(player));

    // The cycle: clear for a while, then rain (sometimes a storm), then clear again.
    api.every(5, () => {
      if (Date.now() < state.until) return;
      if (state.kind === "clear") set(api.rand() < 0.3 ? "thunder" : "rain");
      else if (state.kind === "thunder") set("rain", 0.5 + api.rand());
      else set("clear");
    });

    // Lightning in a storm: now and then near someone outside, announced before it lands.
    const spawn = api.world.store.meta.spawn;
    const safe = Number((api.std.summons as { safeZoneRadius?: number }).safeZoneRadius ?? 24);
    let nextStrike = Date.now() + 8000;
    api.every(1, () => {
      if (state.kind !== "thunder" || Date.now() < nextStrike) return;
      nextStrike = Date.now() + (7 + api.rand() * 10) * 1000;
      const outside = api.players().filter((p) => !p.dead && Math.hypot(p.entity.x - spawn[0], p.entity.z - spawn[2]) > safe);
      const all = api.players().filter((p) => !p.dead);
      const who = (outside.length ? outside : all)[Math.floor(api.rand() * (outside.length || all.length))];
      if (!who) return;
      // Usually somewhere nearby, sometimes right where they stand (they have time to move).
      const close = outside.includes(who) && api.rand() < 0.35;
      const a = api.rand() * Math.PI * 2, r = close ? 0 : 8 + api.rand() * 18;
      const x = Math.floor(who.entity.x + Math.cos(a) * r), z = Math.floor(who.entity.z + Math.sin(a) * r);
      if (!api.world.isLoaded(x, 64, z)) return;
      const y = api.world.surfaceY(x, z) + 1;
      api.sendNear(x, y, z, 160, { t: "lightning", phase: "warn", x: x + 0.5, y, z: z + 0.5, radius: STRIKE_RADIUS, seconds: WARN_SECONDS });
      setTimeout(() => {
        api.sendNear(x, y, z, 160, { t: "lightning", phase: "hit", x: x + 0.5, y, z: z + 0.5, radius: STRIKE_RADIUS, seconds: 0 });
        for (const p of api.players()) {
          if (p.dead || p.gameMode === "creative") continue;
          if (Math.hypot(p.entity.x - (x + 0.5), p.entity.z - (z + 0.5)) > STRIKE_RADIUS || Math.abs(p.entity.y - y) > 4) continue;
          if (Math.hypot(p.entity.x - spawn[0], p.entity.z - spawn[2]) <= safe) continue;
          const dmg = Math.round(api.std.balance.player.health * 0.3);
          if (api.damage(p.entity, dmg, { kind: "explosion" })) api.knockback(p.entity, x + 0.5, z + 0.5, 6);
        }
      }, WARN_SECONDS * 1000);
    });

    api.command({
      name: "weather",
      usage: "/weather [clear|rain|thunder] [minutes]",
      help: "See or change the weather",
      admin: true,
      run(_p, [kind, minutes]) {
        if (!kind) return `It's ${state.kind === "clear" ? "clear" : state.kind === "rain" ? "raining" : "stormy"} (for about ${Math.max(0, Math.round((state.until - Date.now()) / MINUTE))} more minutes)`;
        if (kind !== "clear" && kind !== "rain" && kind !== "thunder") return "Usage: /weather clear | rain | thunder [minutes]";
        const m = minutes ? Number(minutes) : undefined;
        if (m !== undefined && !(m > 0 && m <= 120)) return "Minutes: 1–120";
        set(kind, m);
        return kind === "clear" ? "The sky clears" : kind === "rain" ? "It starts to rain" : "A storm rolls in";
      },
    });
  },
};
