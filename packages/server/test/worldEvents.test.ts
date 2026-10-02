import { describe, expect, it } from "vitest";
import { WorldEventQueue, type WorldChange } from "../src/worldEvents";

const make = (log: string[]) =>
  new WorldEventQueue(
    { gatherSeconds: { minor: 1, major: 1, epic: 1 }, watchSeconds: 1, spacingSeconds: { minor: 5, major: 20, epic: 600 } },
    { announce: (n) => log.push(`${n.phase}:${n.title}`), health: () => ({ disabledModules: [], avgTickMs: 1, playersOnline: 1 }), log: () => {} },
  );
const change = (title: string, size: WorldChange["size"], applied: string[]): WorldChange =>
  ({ title, by: "t", size, apply: () => applied.push(title), revert: () => applied.push(`undo ${title}`) });
const run = async (q: WorldEventQueue, seconds: number) => { for (let t = 0; t < seconds; t += 0.25) { q.step(0.25); await Promise.resolve(); } };

describe("world event queue", () => {
  it("runs one change at a time, in order", async () => {
    const log: string[] = [], applied: string[] = [];
    const q = make(log);
    q.submit(change("a", "minor", applied));
    q.submit(change("b", "minor", applied));
    await run(q, 2);
    expect(applied).toEqual(["a"]);
    await run(q, 10);
    expect(applied).toEqual(["a", "b"]);
  });

  it("spaces epic changes far apart without holding up smaller ones", async () => {
    const log: string[] = [], applied: string[] = [];
    const q = make(log);
    q.submit(change("palette", "epic", applied));
    await run(q, 3);
    q.submit(change("mob", "major", applied));
    q.submit(change("palette 2", "epic", applied));
    await run(q, 30);
    expect(applied).toEqual(["palette", "mob"]); // the mob waited 20 s, the second palette change waits 10 min
    await run(q, 600);
    expect(applied).toEqual(["palette", "mob", "palette 2"]);
  });

  it("fizzles when the check fails, and never applies", async () => {
    const log: string[] = [], applied: string[] = [];
    const q = make(log);
    q.submit({ ...change("bad", "minor", applied), check: async () => "nope" });
    await run(q, 2);
    expect(applied).toEqual([]);
    expect(log).toContain("fizzle:bad");
  });
});
