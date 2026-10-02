import type { GameMode } from "@lfg/shared";
import type { ServerModule } from "../../kernel";
import type { Player } from "../../player";

/** Chat commands. Module management commands live in the kernel commands (see game setup). */
export const commands: ServerModule = {
  id: "vanilla:commands",
  name: "Commands",
  version: "0.1.0",
  author: "lfg",
  description: "/help, /gamemode, /give, /tp, /time, /spawn, /setspawn, /kill, /seed, /list",
  setup(api) {
    const { reg } = api;
    const target = (p: Player | null, name?: string): Player | undefined => (name ? api.playerByName(name) : p ?? undefined);

    api.command({
      name: "help", usage: "/help", help: "List commands", admin: false,
      run() {
        const list = [...(api.use<() => { usage: string; help: string }[]>("kernel:commands")?.() ?? [])];
        return list.map((c) => `${c.usage} — ${c.help}`).join("\n");
      },
    });

    api.command({
      name: "gamemode", usage: "/gamemode <survival|creative> [player]", help: "Switch game mode", admin: true,
      run(p, [mode, name]) {
        const m = ({ s: "survival", survival: "survival", c: "creative", creative: "creative", "0": "survival", "1": "creative" } as Record<string, GameMode>)[mode ?? ""];
        if (!m) return "Usage: /gamemode survival|creative";
        const t = target(p, name);
        if (!t) return "No such player";
        t.gameMode = m;
        t.selfDirty = true;
        api.tell(t, `Game mode set to ${m}`);
      },
    });

    api.command({
      name: "give", usage: "/give <item> [count] [player]", help: "Give yourself items", admin: true,
      run(p, [item, count, name]) {
        const t = target(p, name);
        if (!t) return "No such player";
        if (!item || !reg.hasItem(item)) return `Unknown item. Some items: ${reg.items.slice(0, 12).map((i) => i.name).join(", ")}…`;
        const n = Math.max(1, Math.min(64 * 36, Number(count) || 1));
        const left = t.give(reg.stack(item, n));
        return `Gave ${n - left} ${reg.item(item).displayName} to ${t.name}`;
      },
    });

    api.command({
      name: "tp", usage: "/tp <x> <y> <z> | /tp <player>", help: "Teleport", admin: true,
      run(p, args) {
        if (!p) return "Players only";
        if (args.length === 1) {
          const t = api.playerByName(args[0]);
          if (!t) return "No such player";
          api.teleport(p, t.entity.x, t.entity.y, t.entity.z);
          return;
        }
        const [x, y, z] = args.map((a, i) => (a.startsWith("~") ? [p.entity.x, p.entity.y, p.entity.z][i] + (Number(a.slice(1)) || 0) : Number(a)));
        if (![x, y, z].every(Number.isFinite)) return "Usage: /tp x y z";
        api.teleport(p, x, y, z);
      },
    });

    api.command({
      name: "time", usage: "/time set <day|noon|night|midnight|seconds>", help: "Change the time of day", admin: true,
      run(_p, [sub, value]) {
        const { dayLength } = api.time();
        if (sub !== "set") return `Time: ${Math.floor(api.time().time)}s of ${dayLength}s`;
        const named: Record<string, number> = { day: 0.02, noon: 0.25, sunset: 0.5, night: 0.6, midnight: 0.75 };
        const t = value! in named ? named[value!] * dayLength : Number(value);
        if (!Number.isFinite(t)) return "Usage: /time set day|noon|night|midnight";
        api.setTime(((t % dayLength) + dayLength) % dayLength);
        for (const pl of api.players()) pl.send({ t: "time", time: api.time().time, dayLength });
      },
    });

    api.command({
      name: "spawn", usage: "/spawn", help: "Go back to your spawn point", admin: false,
      run(p) {
        if (!p) return "Players only";
        const [x, y, z] = api.respawnPoint(p);
        api.teleport(p, x, y, z);
      },
    });

    api.command({
      name: "setspawn", usage: "/setspawn", help: "Respawn here when you die", admin: false,
      run(p) {
        if (!p) return "Players only";
        p.spawnPoint = [p.entity.x, p.entity.y, p.entity.z];
        return "Spawn point set";
      },
    });

    api.command({
      name: "kill", usage: "/kill [player]", help: "Respawn (kills you)", admin: false,
      run(p, [name]) {
        const t = name ? api.playerByName(name) : p;
        if (!t) return "No such player";
        if (t !== p && !p?.admin) return "You can only /kill yourself";
        api.damage(t.entity, 100000, { kind: "command" });
      },
    });

    api.command({
      name: "seed", usage: "/seed", help: "Show the world seed", admin: false,
      run() { return `Seed: ${api.world.store.meta.seed}`; },
    });

    api.command({
      name: "list", usage: "/list", help: "Who's online", admin: false,
      run() { return `Online: ${api.players().map((p) => p.name).join(", ")}`; },
    });
  },
};
