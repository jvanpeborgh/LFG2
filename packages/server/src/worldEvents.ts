import type { WorldEventNotice } from "@lfg/shared";

/**
 * A change to the running world: a rule value, a new or updated module, a
 * removed module. Every change reaches all players at once, as a world event
 * (docs/ARCHITECTURE.md §5): gathering → arrival → aftershock, with fizzle
 * and automatic undo when something goes wrong.
 */
export interface WorldChange {
  title: string;
  by: string;
  size: "minor" | "major" | "epic";
  detail?: string;
  /** Checks before arrival. Resolve to a reason to fizzle, or null. */
  check?(): string | null | Promise<string | null>;
  /** Make the change. Throwing = fizzle. */
  apply(): void;
  /** Put things back (on undo). */
  revert(): void;
  /** Extra health check during the aftershock; return a reason to undo. */
  monitor?(): string | null;
}

export interface WorldHealth {
  disabledModules: string[];
  avgTickMs: number;
  playersOnline: number;
}

export interface EventTiming {
  gatherSeconds: Record<WorldChange["size"], number>;
  watchSeconds: number;
  /** Minimum gap between arrivals, per size. */
  spacingSeconds: Record<WorldChange["size"], number>;
}

type Phase = "gathering" | "checking" | "aftershock";

interface Active {
  change: WorldChange;
  phase: Phase;
  left: number;
  check?: Promise<string | null>;
  checkResult?: string | null;
  disabledBefore: Set<string>;
  deaths: number;
}

export interface EventRecord {
  change: WorldChange;
  at: number;
  status: "arrived" | "fizzled" | "undone";
  reason?: string;
}

export class WorldEventQueue {
  private queue: WorldChange[] = [];
  private active: Active | null = null;
  /** Seconds since the last arrival of each size. */
  private since: Record<WorldChange["size"], number> = { minor: Infinity, major: Infinity, epic: Infinity };
  readonly history: EventRecord[] = [];

  constructor(
    private timing: EventTiming,
    private hooks: {
      announce(n: WorldEventNotice): void;
      health(): WorldHealth;
      log(msg: string): void;
      /** Switch modules back on that a reverted change had knocked out. */
      reenable?(modules: string[]): void;
    },
  ) {}

  /** Queue a change. Returns its position (0 = starts now). */
  submit(change: WorldChange): number {
    this.queue.push(change);
    const position = this.queue.length - 1 + (this.active ? 1 : 0);
    this.step(0); // start gathering right away if nothing else is going on
    return position;
  }

  get pending(): number {
    return this.queue.length + (this.active ? 1 : 0);
  }

  get current(): { title: string; phase: Phase; left: number } | null {
    return this.active ? { title: this.active.change.title, phase: this.active.phase, left: this.active.left } : null;
  }

  /** Count a player death (aftershock watches for changes that suddenly kill lots of people). */
  playerDied(): void {
    if (this.active?.phase === "aftershock") this.active.deaths++;
  }

  /**
   * A change of size S waits spacing[S] after the last arrival of size S or bigger: a palette change
   * (epic) waits 10 minutes after the previous epic one, but doesn't hold up a new mob (major) for long.
   */
  private readyFor(size: WorldChange["size"]): boolean {
    const order: WorldChange["size"][] = ["minor", "major", "epic"];
    const bigger = order.slice(order.indexOf(size));
    return bigger.every((s) => this.since[s] >= this.timing.spacingSeconds[size]);
  }

  step(dt: number): void {
    for (const k of Object.keys(this.since) as WorldChange["size"][]) this.since[k] += dt;
    const a = this.active;
    if (!a) {
      const next = this.queue[0];
      if (!next) return;
      if (!this.readyFor(next.size)) return;
      this.queue.shift();
      this.begin(next);
      return;
    }
    a.left -= dt;
    if (a.phase === "gathering" && a.left <= 0) {
      a.phase = "checking";
    }
    if (a.phase === "checking") {
      if (a.check && a.checkResult === undefined) return; // still checking
      if (a.checkResult) return this.finish("fizzled", a.checkResult);
      this.arrive();
      return;
    }
    if (a.phase === "aftershock") {
      const reason = this.unhealthy(a);
      if (reason) {
        this.undoActive(reason);
        return;
      }
      if (a.left <= 0) {
        this.hooks.log(`[event] "${a.change.title}" settled in`);
        this.active = null;
      }
    }
  }

  private begin(change: WorldChange): void {
    const gather = this.timing.gatherSeconds[change.size];
    const a: Active = {
      change,
      phase: "gathering",
      left: gather,
      disabledBefore: new Set(this.hooks.health().disabledModules),
      deaths: 0,
    };
    this.active = a;
    if (change.check) {
      try {
        a.check = Promise.resolve(change.check());
        a.check.then((r) => (a.checkResult = r), (e) => (a.checkResult = e instanceof Error ? e.message : String(e)));
      } catch (e) {
        a.checkResult = e instanceof Error ? e.message : String(e);
      }
    }
    this.hooks.announce({ phase: "gathering", title: change.title, by: change.by, detail: change.detail, seconds: gather });
  }

  private arrive(): void {
    const a = this.active!;
    try {
      a.change.apply();
    } catch (e) {
      return this.finish("fizzled", e instanceof Error ? e.message : String(e));
    }
    a.phase = "aftershock";
    a.left = this.timing.watchSeconds;
    a.disabledBefore = new Set(this.hooks.health().disabledModules);
    this.since[a.change.size] = 0;
    this.history.push({ change: a.change, at: Date.now(), status: "arrived" });
    this.hooks.announce({ phase: "arrival", title: a.change.title, by: a.change.by, detail: a.change.detail });
  }

  private unhealthy(a: Active): string | null {
    const h = this.hooks.health();
    const newlyDisabled = h.disabledModules.filter((m) => !a.disabledBefore.has(m));
    if (newlyDisabled.length) return `${newlyDisabled.join(", ")} kept failing after it arrived`;
    if (h.avgTickMs > 45) return `the server slowed down (${h.avgTickMs.toFixed(0)} ms per tick)`;
    if (h.playersOnline >= 2 && a.deaths >= Math.max(2, h.playersOnline * 0.5)) return `${a.deaths} players died right after it arrived`;
    try {
      return a.change.monitor?.() ?? null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }

  private finish(status: "fizzled", reason: string): void {
    const a = this.active!;
    this.history.push({ change: a.change, at: Date.now(), status, reason });
    this.hooks.announce({ phase: "fizzle", title: a.change.title, by: a.change.by, detail: reason });
    this.active = null;
  }

  private undoActive(reason: string): void {
    const a = this.active!;
    this.revertSafely(a.change);
    // Modules that broke because of this change get another chance now it's gone.
    const broken = this.hooks.health().disabledModules.filter((m) => !a.disabledBefore.has(m));
    if (broken.length) this.hooks.reenable?.(broken);
    const rec = [...this.history].reverse().find((r) => r.change === a.change);
    if (rec) { rec.status = "undone"; rec.reason = reason; }
    this.hooks.announce({ phase: "undo", title: a.change.title, by: a.change.by, detail: `Undone automatically: ${reason}` });
    this.active = null;
  }

  /** Undo the most recent arrived change matching the filter (e.g. "/rule undo"). */
  undoLast(by: string, filter: (c: WorldChange) => boolean = () => true): string {
    const rec = [...this.history].reverse().find((r) => r.status === "arrived" && filter(r.change));
    if (!rec) return "Nothing to undo";
    if (this.active?.change === rec.change) this.active = null;
    this.revertSafely(rec.change);
    rec.status = "undone";
    rec.reason = `undone by ${by}`;
    this.hooks.announce({ phase: "undo", title: rec.change.title, by, detail: "Time rewinds…" });
    return `Undid "${rec.change.title}"`;
  }

  private revertSafely(change: WorldChange): void {
    try {
      change.revert();
    } catch (e) {
      this.hooks.log(`[event] revert of "${change.title}" failed: ${e instanceof Error ? e.message : e}`);
    }
  }
}
