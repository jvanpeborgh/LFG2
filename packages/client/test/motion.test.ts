import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DEFAULT_STANDARDS, generateModel } from "@lfg/shared";
import { planCreature } from "@lfg/shared/src/summons/skills";
import { animateVoxelObject, buildVoxelObject } from "../src/voxelMesh";

function fox() {
  const { spec } = planCreature("a fox", DEFAULT_STANDARDS);
  const o = buildVoxelObject(generateModel(spec, DEFAULT_STANDARDS));
  const holder = new THREE.Group();
  holder.add(o.root);
  return { o, holder, gait: spec.gait };
}

describe("secondary motion", () => {
  it("puts the eyelids on the head, hidden until a blink, shut in sleep", () => {
    const { o, gait } = fox();
    const lids = o.parts.get("lid")!;
    expect(lids?.length).toBe(1);
    expect(lids[0].parent).toBe(o.parts.get("head")![0]);
    let blinks = 0;
    for (let t = 0; t < 12; t += 1 / 60) {
      animateVoxelObject(o, t, 0, "walk", 0, gait);
      if (lids[0].visible) blinks++;
    }
    // A blink every few seconds, each a few frames: shut a small part of the time.
    expect(blinks).toBeGreaterThan(5);
    expect(blinks).toBeLessThan(12 * 60 * 0.15);
    animateVoxelObject(o, 13, 0, "walk", 0, gait, null, { action: "sleep" });
    expect(lids[0].visible).toBe(true);
    expect(lids[0].scale.y).toBe(1);
  });

  it("swings the tail out and leads with the head when it turns", () => {
    // Two foxes walk the same way; one turns left (yaw increasing) for half a second.
    const run = (turn: boolean) => {
      const { o, holder, gait } = fox();
      const tail = o.parts.get("tail")![0], head = o.parts.get("head")![0];
      let tailSum = 0, headSum = 0;
      for (let t = 0; t < 1.5; t += 1 / 60) {
        if (turn && t > 1) holder.rotation.y += 0.05;
        holder.position.x += Math.sin(holder.rotation.y) * 0.05; holder.position.z += Math.cos(holder.rotation.y) * 0.05;
        animateVoxelObject(o, t, 1, "walk", 0, gait);
        if (t > 1) { tailSum += tail.rotation.y; headSum += head.rotation.y; }
      }
      return { tailSum, headSum };
    };
    const straight = run(false), turning = run(true);
    // The tail lags (swings to the outside of the turn), the head leads into it.
    expect(turning.tailSum - straight.tailSum).toBeLessThan(-1);
    expect(turning.headSum - straight.headSum).toBeGreaterThan(0.5);
  });
});
