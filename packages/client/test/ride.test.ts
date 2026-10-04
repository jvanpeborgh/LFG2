import { describe, expect, it } from "vitest";
import { BlockTable, DEFAULT_STANDARDS, VANILLA_CONTENT, buildRegistry, type MountProfile } from "@lfg/shared";
import { LocalPlayer } from "../src/player";

const reg = buildRegistry([VANILLA_CONTENT.id], DEFAULT_STANDARDS);
const table = new BlockTable(reg);
const stone = reg.block("stone").id;
// Flat stone at y < 10, open air above.
const world = { getBlock: (_x: number, y: number) => (y < 10 ? stone : 0) };
const idle = { forward: 0, strafe: 0, jump: false, sprint: false, down: false };
const run = (p: LocalPlayer, seconds: number, input = idle) => { for (let t = 0; t < seconds; t += 1 / 60) p.update(1 / 60, input, world, table); };

describe("riding", () => {
  it("gallops faster than you can run, and jumps higher", () => {
    const horse: MountProfile = { mode: "ground", speed: 7.8, sprint: 11, jump: 2, seat: 1.2 };
    const p = new LocalPlayer(0.5, 10, 0.5, DEFAULT_STANDARDS);
    run(p, 0.5);
    p.mount = horse;
    run(p, 2, { ...idle, forward: 1, sprint: true });
    expect(-p.body.z).toBeGreaterThan(15);
    expect(p.eyeY).toBeCloseTo(p.body.y + 1.62 + 1.2, 1);
  });

  it("flies where you look", () => {
    const dragon: MountProfile = { mode: "fly", speed: 11, sprint: 16, jump: 0, seat: 1.5 };
    const p = new LocalPlayer(0.5, 10, 0.5, DEFAULT_STANDARDS);
    run(p, 0.5);
    p.mount = dragon;
    p.pitch = 0.5;
    run(p, 2, { ...idle, forward: 1 });
    expect(p.body.y).toBeGreaterThan(14);
    expect(-p.body.z).toBeGreaterThan(10);
  });
});
