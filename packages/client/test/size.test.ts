import { describe, expect, it } from "vitest";
import { BlockTable, DEFAULT_STANDARDS, VANILLA_CONTENT, buildRegistry, cloneStandards, setRule } from "@lfg/shared";
import { LocalPlayer } from "../src/player";

const reg = buildRegistry([VANILLA_CONTENT.id], DEFAULT_STANDARDS);
const table = new BlockTable(reg);
const stone = reg.block("stone").id;
// Flat stone at y < 10, and a roof three blocks up over x < 0 (a low room).
const world = { getBlock: (x: number, y: number) => (y < 10 || (x < 0 && y === 13) ? stone : 0) };
const idle = { forward: 0, strafe: 0, jump: false, sprint: false, down: false };
const run = (p: LocalPlayer, seconds: number) => { for (let t = 0; t < seconds; t += 1 / 60) p.update(1 / 60, idle, world, table); };

describe("giants and tiny days", () => {
  it("grows to the rule's size where there's room, and shrinks at once", () => {
    const std = cloneStandards(DEFAULT_STANDARDS);
    const p = new LocalPlayer(5.5, 10, 0.5, std);
    run(p, 0.3);
    setRule(std, "balance.player.scale", 2.5);
    run(p, 0.1);
    expect(p.size).toBeCloseTo(2.5);
    expect(p.body.height).toBeCloseTo(4.5);
    expect(p.eyeY).toBeCloseTo(p.body.y + 1.62 * 2.5, 1);
    setRule(std, "balance.player.scale", 0.35);
    run(p, 0.1);
    expect(p.size).toBeCloseTo(0.35);
    expect(p.body.width).toBeLessThan(0.3);
  });

  it("a giant indoors stays small until there's room", () => {
    const std = cloneStandards(DEFAULT_STANDARDS);
    const p = new LocalPlayer(-3.5, 10, 0.5, std);
    run(p, 0.3);
    setRule(std, "balance.player.scale", 2.5);
    run(p, 0.2);
    expect(p.size).toBeCloseTo(1);
    p.body.x = 5.5; // out under the open sky
    run(p, 0.1);
    expect(p.size).toBeCloseTo(2.5);
  });
});
