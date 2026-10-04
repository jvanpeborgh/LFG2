import { describe, expect, it } from "vitest";
import { advanceRacer, buildTrack, raceItemFor, looksLikeRace, nearestOnTrack, planRace, standings, type RacerProgress } from "../src";

describe("races", () => {
  it("reads race requests: laps, what to race in", () => {
    expect(looksLikeRace("a Mario Kart course")).toBe(true);
    expect(looksLikeRace("a kart race, 5 laps")).toBe(true);
    expect(looksLikeRace("a racing horse")).toBe(true); // (a race; /summon handles creatures first)
    expect(looksLikeRace("pirates raid the coast")).toBe(false);
    expect(planRace("a kart race, 5 laps").laps).toBe(5);
    expect(planRace("a buggy rally").vehicle).toBe("buggy");
    expect(planRace("a mario kart course").title).toBe("Kart Grand Prix");
  });

  it("lays a closed loop with a road, kerbs, a gate, checkpoints and a grid", () => {
    const ground = (x: number, z: number) => 60 + Math.round(Math.sin(x * 0.1) * 2 + Math.cos(z * 0.1));
    const t = buildTrack(0, 0, 4, ground, 42);
    expect(t.points.length).toBeGreaterThan(100);
    // Closed: the last point is about a block from the first.
    const a = t.points[0], b = t.points[t.points.length - 1];
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(1.6);
    expect(t.checkpoints[0]).toBe(0);
    expect(t.checkpoints.length).toBeGreaterThanOrEqual(5);
    expect(t.grid.length).toBe(4);
    for (const g of t.grid) expect(nearestOnTrack(t, g.x, g.z).distance).toBeLessThan(t.width / 2);
    const names = new Set(t.blocks.map((q) => q[3]));
    for (const n of ["stone", "wool", "bricks", "lantern", "air"]) expect(names.has(n), n).toBe(true);
    // Road is level.
    expect(new Set(t.blocks.filter((q) => q[3] === "stone").map((q) => q[1])).size).toBe(1);
    // Same place and seed: the same track.
    expect(buildTrack(0, 0, 4, ground, 42).blocks.length).toBe(t.blocks.length);
  });

  it("puts boost pads on the straights and item boxes across the road", () => {
    const t = buildTrack(0, 0, 4, () => 60, 42);
    expect(t.pads.length).toBeGreaterThanOrEqual(2);
    expect(t.boxes.length).toBeGreaterThanOrEqual(3);
    // Boxes sit on the road (a row of three, the middle one on the centre line), pads in its surface.
    for (const b of t.boxes) expect(nearestOnTrack(t, b.x, b.z).distance).toBeLessThan(t.width / 2);
    expect(t.boxes.some((b) => nearestOnTrack(t, b.x, b.z).distance < 0.8)).toBe(true);
    expect(t.blocks.filter((q) => q[3] === "neon_yellow").every((q) => q[1] === t.y - 1)).toBe(true);
    expect(t.blocks.filter((q) => q[3] === "item_box").every((q) => q[1] === t.y)).toBe(true);
    // Not on the start line.
    for (const i of t.pads) expect(Math.min(i, t.points.length - i)).toBeGreaterThan(10);
  });

  it("gives those behind better items", () => {
    const share = (place: number, of: number, item: string) => {
      let k = 0;
      for (let i = 0; i < 1000; i++) if (raceItemFor(place, of, i / 1000) === item) k++;
      return k / 1000;
    };
    expect(share(6, 6, "star")).toBeGreaterThan(share(1, 6, "star") * 3);
    expect(share(1, 6, "shell")).toBeGreaterThan(share(6, 6, "shell"));
    expect(raceItemFor(1, 1, 0.99)).toBe("shell");
  });

  it("counts laps only through every checkpoint in order", () => {
    const t = buildTrack(0, 0, 2, () => 60, 7);
    const r: RacerProgress = { lap: 0, next: 0, finished: null, offTrack: 0 };
    const at = (i: number) => t.points[t.checkpoints[i]];
    // Crossing the line starts lap 1.
    expect(advanceRacer(t, r, at(0).x, at(0).z)).toBe("lap");
    expect(r.lap).toBe(1);
    // Cutting straight back to the line doesn't count.
    expect(advanceRacer(t, r, at(0).x, at(0).z)).toBe(null);
    for (let k = 1; k < t.checkpoints.length; k++) expect(advanceRacer(t, r, at(k).x, at(k).z)).toBe("checkpoint");
    expect(advanceRacer(t, r, at(0).x, at(0).z)).toBe("lap");
    expect(r.lap).toBe(2);
    // Standings: further along wins.
    const a = { name: "a", progress: { lap: 2, next: 1, finished: null, offTrack: 0 }, x: at(1).x, z: at(1).z };
    const b = { name: "b", progress: { lap: 1, next: 3, finished: null, offTrack: 0 }, x: at(3).x, z: at(3).z };
    const c = { name: "c", progress: { lap: 3, next: 0, finished: 61.2, offTrack: 0 }, x: 0, z: 0 };
    expect(standings(t, [b, a, c]).map((q) => q.name)).toEqual(["c", "a", "b"]);
  });
});
