import { DEFAULT_STANDARDS, checkRuleChange, getRule, listRules, parseRuleValue, setRule, type RuleValue } from "@lfg/shared";
import type { Game } from "./game";

/** "balance.player.walkSpeed" → "Walk speed"; "art.palette.green3" → "Palette green3". */
export function ruleLabel(path: string): string {
  const parts = path.split(".");
  const last = parts[parts.length - 1];
  const words = last.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  const text = /^[a-z]+\d+$/.test(last) && parts.length > 1 ? `${parts[parts.length - 2]} ${last}` : words;
  return text[0].toUpperCase() + text.slice(1);
}

/**
 * Live world rules: the standards values (gravity, speeds, damage, palette…)
 * changed while everyone plays. A change is a world event: announced,
 * checked, applied to the server and every client at the same moment,
 * watched, and undone automatically if the world gets unhealthy.
 */
export class WorldRules {
  constructor(private game: Game) {}

  private get std() {
    return this.game.std;
  }

  /** Re-apply changes saved with the world (skipping any that are no longer valid). */
  restore(): void {
    const saved = this.game.world.meta.rules ?? {};
    for (const [path, value] of Object.entries(saved)) {
      const why = checkRuleChange(DEFAULT_STANDARDS, path, value);
      if (why) {
        delete saved[path];
        continue;
      }
      setRule(this.std, path, value);
    }
  }

  /** Propose a change. Returns a message for whoever asked. */
  propose(path: string, value: RuleValue, by: string): { ok: boolean; message: string } {
    const why = checkRuleChange(this.std, path, value);
    if (why) return { ok: false, message: why };
    const before = getRule(this.std, path) as RuleValue;
    if (before === value) return { ok: false, message: `${path} is already ${value}` };
    const label = ruleLabel(path);
    const size = path.startsWith("art.") || path.startsWith("audio.") ? "epic" : "major";
    const position = this.game.events.submit({
      title: `${label}: ${before} → ${value}`,
      by,
      size,
      detail: path,
      // Re-check at arrival time: another change may have landed in the meantime.
      check: () => checkRuleChange(this.std, path, value),
      apply: () => this.set(path, value),
      revert: () => this.set(path, before),
    });
    return { ok: true, message: position === 0 ? `Gathering: ${label} → ${value}` : `Queued (${position} ahead): ${label} → ${value}` };
  }

  private set(path: string, value: RuleValue): void {
    setRule(this.std, path, value);
    const meta = this.game.world.meta;
    meta.rules ??= {};
    if (getRule(DEFAULT_STANDARDS, path) === value) delete meta.rules[path];
    else meta.rules[path] = value;
    for (const p of this.game.players.values()) p.send({ t: "rules", changes: [[path, value]] });
  }

  registerCommands(): void {
    this.game.kernel.command({
      module: "kernel",
      name: "rule",
      usage: "/rule list [prefix] | get <path> | set <path> <value> | undo",
      help: "See or change world rules (as a world event)",
      admin: false,
      run: (p, [sub, path, ...rest]) => {
        if (!sub || sub === "list") {
          const rules = listRules(this.std, path ?? "balance.");
          const changed = this.game.world.meta.rules ?? {};
          return rules.slice(0, 40).map(([k, v]) => `${k} = ${v}${k in changed ? "  (changed)" : ""}`).join("\n")
            + (rules.length > 40 ? `\n… ${rules.length - 40} more, narrow it with /rule list <prefix>` : "");
        }
        if (sub === "get") {
          if (!path) return "Usage: /rule get <path>";
          const v = getRule(this.std, path);
          return v === undefined ? `No rule ${path}` : `${path} = ${typeof v === "object" ? JSON.stringify(v) : v}`;
        }
        if (sub === "undo") {
          if (p && !p.admin) return "Only admins can undo";
          return this.game.events.undoLast(p?.name ?? "console", (c) => c.detail !== undefined && getRule(DEFAULT_STANDARDS, c.detail) !== undefined);
        }
        if (sub === "set") {
          if (p && !p.admin) return "Only admins can change rules (for now; agents will cast them)";
          if (!path || rest.length === 0) return "Usage: /rule set <path> <value>";
          const parsed = parseRuleValue(getRule(this.std, path), rest.join(" "));
          if (parsed === undefined) return `Can't use "${rest.join(" ")}" for ${path}`;
          return this.propose(path, parsed, p?.name ?? "console").message;
        }
        return "Usage: /rule list | get | set | undo";
      },
    });
    this.game.kernel.command({
      module: "kernel",
      name: "events",
      usage: "/events",
      help: "What's happening and what changed recently",
      admin: false,
      run: () => {
        const cur = this.game.events.current;
        const lines = cur ? [`Now: ${cur.title} (${cur.phase}, ${Math.max(0, cur.left).toFixed(0)}s)`] : ["Now: nothing"];
        lines.push(`Waiting: ${Math.max(0, this.game.events.pending - (cur ? 1 : 0))}`);
        for (const r of this.game.events.history.slice(-8).reverse())
          lines.push(`${r.status === "arrived" ? "⚡" : r.status === "undone" ? "⟲" : "✧"} ${r.change.title} — ${r.change.by}${r.reason ? ` (${r.reason})` : ""}`);
        return lines.join("\n");
      },
    });
  }
}
