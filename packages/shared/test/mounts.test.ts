import { describe, expect, it } from "vitest";
import { DEFAULT_STANDARDS, checkSummon, generateModel, isMountProfile, mountProfile, planCreature, summonStats } from "../src";

const profile = (prompt: string) => {
  const { spec } = planCreature(prompt, DEFAULT_STANDARDS);
  return { spec, p: mountProfile(spec!, summonStats(spec!, generateModel(spec!, DEFAULT_STANDARDS), DEFAULT_STANDARDS)) };
};

describe("mounts", () => {
  it("rides by what it is: horses gallop, dragons fly, dolphins swim", () => {
    const horse = profile("a horse to ride").p, dragon = profile("a dragon to ride").p, dolphin = profile("a big dolphin to ride").p;
    expect(isMountProfile(horse) && horse.mode).toBe("ground");
    expect(isMountProfile(dragon) && dragon.mode).toBe("fly");
    expect(isMountProfile(dolphin) && dolphin.mode).toBe("swim");
    if (isMountProfile(horse)) {
      expect(horse.sprint).toBeGreaterThan(DEFAULT_STANDARDS.balance.player.sprintSpeed);
      expect(horse.seat).toBeGreaterThan(0.5);
      expect(horse.jump).toBeGreaterThan(1);
    }
  });

  it("makes things asked for as mounts tame, big enough and saddled", () => {
    const { spec, p } = profile("a dragon I can ride");
    expect(spec!.temperament).not.toBe("hostile");
    expect(spec!.features).toContain("saddle");
    expect(isMountProfile(p)).toBe(true);
    const beetle = profile("a beetle mount");
    expect(beetle.spec!.length).toBeGreaterThanOrEqual(1.8);
  });

  it("says why when it can't carry you", () => {
    const cat = profile("a cat").p, knight = profile("a knight").p;
    expect(!isMountProfile(cat) && cat.why).toMatch(/too small/);
    expect(!isMountProfile(knight) && knight.why).toMatch(/giant/);
    expect(isMountProfile(profile("a giant to ride").p)).toBe(true);
  });
});

describe("vehicles", () => {
  it("plans vehicles from words, coloured, with wheels, to drive", () => {
    const kart = profile("a red kart");
    expect(kart.spec!.vehicle).toBe("kart");
    expect(kart.spec!.colors.main).toBe("red3");
    expect(kart.spec!.shape!.parts.filter((p) => p.anim === "wheel").length).toBe(2);
    expect(isMountProfile(kart.p) && kart.p.mode).toBe("drive");
    const truck = profile("a monster truck");
    expect(truck.spec!.vehicle).toBe("truck");
    expect(truck.spec!.name).toMatch(/Monster Truck/);
    expect(profile("a blue sports car").spec!.vehicle).toBe("car");
    expect(profile("a motorbike").spec!.vehicle).toBe("bike");
  });

  it("leaves creatures alone", () => {
    expect(profile("a racing horse").spec!.vehicle).toBeUndefined();
    expect(profile("a carp").spec?.vehicle).toBeUndefined();
  });

  it("builds and checks cleanly", () => {
    for (const prompt of ["a red kart", "a blue car", "a truck", "a buggy", "a motorbike"]) {
      const { spec } = planCreature(prompt, DEFAULT_STANDARDS);
      const model = generateModel(spec!, DEFAULT_STANDARDS);
      const report = checkSummon(spec!, model, DEFAULT_STANDARDS);
      expect(report.errors, prompt).toEqual([]);
      expect(summonStats(spec!, model, DEFAULT_STANDARDS).kind).toBe("object");
    }
  });
});
