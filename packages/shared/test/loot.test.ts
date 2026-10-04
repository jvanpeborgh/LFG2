import { describe, expect, it } from "vitest";
import { DEFAULT_STANDARDS, armourTotals, gearSets, salvageValue, weaponDamage, kindsFor, makeGear, materialOf, mulberry32, perksFor, planCreature, rollCreatureLoot, type LootContext } from "../src";

const spec = (p: string) => planCreature(p, DEFAULT_STANDARDS).spec!;
const ctx = (over: Partial<LootContext> = {}): LootContext => ({ tier: 2, playerLevel: 10, summoner: "Mira", slayer: "Rex", day: 12, rand: mulberry32(7), palette: DEFAULT_STANDARDS.art.palette as Record<string, string>, maxHit: 40, ...over });

describe("creature loot", () => {
  it("reads what a creature is made of and what it can give", () => {
    expect(materialOf(spec("an angry red dragon"))).toBe("scale");
    expect(materialOf(spec("an angry wolf"))).toBe("hide");
    expect(materialOf(spec("a crab"))).toBe("shell");
    expect(materialOf(spec("a ghost"))).toBe("wraith");
    expect(materialOf(spec("a skeleton"))).toBe("bone");
    expect(kindsFor(spec("a shark"))).toContain("sword");
    expect(kindsFor(spec("an angry red dragon"))).toEqual(expect.arrayContaining(["helm", "plate", "staff"]));
    expect(kindsFor(spec("a ghost"))).toContain("charm");
  });

  it("gives perks from what the creature was", () => {
    expect(perksFor(spec("an angry red dragon"), "helm")).toContain("fire_resist");
    expect(perksFor(spec("a shark"), "helm")).toContain("water_breathing");
    expect(perksFor(spec("an angry eagle"), "boots")).toContain("feather_fall");
    expect(perksFor(spec("an angry red dragon"), "staff")).toContain("burning");
  });

  it("makes a named piece in the creature's colours, with lore naming who made and felled it", () => {
    const d = spec("an angry red dragon");
    const g = makeGear(d, "helm", ctx(), "rare");
    expect(g.item).toBe("relic_helm");
    expect(g.meta.name).toMatch(/Emberscale Helm/);
    expect(g.meta.colors.main).toBe((DEFAULT_STANDARDS.art.palette as Record<string, string>)[d.colors.main]);
    expect(g.meta.defense).toBeGreaterThan(2);
    expect(g.meta.lore[0]).toMatch(/Mira's .*Dragon, felled by Rex on day 12/);
    expect(g.meta.lore[1]).toMatch(/warm/);
    const s = makeGear(spec("a shark"), "sword", ctx(), "epic");
    expect(s.meta.name).toMatch(/Sharkfang/);
    expect(s.meta.damage).toBeGreaterThan(14);
    expect(s.meta.damage).toBeLessThanOrEqual(40);
  });

  it("drops by strength: bosses always (two pieces), fighters often, pets rarely", () => {
    const boss = { ...spec("a pirate captain"), role: "boss" as const, temperament: "hostile" as const };
    expect(rollCreatureLoot(boss, ctx()).length).toBe(2);
    let fighter = 0, pet = 0;
    const rand = mulberry32(3);
    for (let i = 0; i < 400; i++) {
      fighter += rollCreatureLoot(spec("an angry wolf"), ctx({ rand })).length;
      pet += rollCreatureLoot(spec("a cow"), ctx({ rand })).length;
    }
    expect(fighter).toBeGreaterThan(120);
    expect(pet).toBeLessThan(fighter / 4);
    expect(rollCreatureLoot(spec("a red kart"), ctx())).toEqual([]);
  });

  it("better gear with a stronger creature and a more experienced player", () => {
    const d = spec("an angry wolf");
    const weak = makeGear(d, "plate", ctx({ tier: 1, playerLevel: 1 }), "common").meta.defense!;
    const strong = makeGear(d, "plate", ctx({ tier: 4, playerLevel: 30 }), "common").meta.defense!;
    expect(strong).toBeGreaterThan(weak * 1.5);
    const set = ["helm", "plate", "legs", "boots"].map((k) => makeGear(d, k as "helm", ctx({ tier: 5, playerLevel: 50 }), "legendary").meta);
    expect(armourTotals(set).block).toBeLessThanOrEqual(0.6);
  });
});

describe("creature loot elements", () => {
  it("adds up pieces from the same creature: 2, 3 and 4-piece set bonuses", () => {
    const d = spec("an angry red dragon"), w = spec("an angry wolf");
    const piece = (s: typeof d, k: string, over: Partial<LootContext> = {}) => makeGear(s, k as "helm", ctx(over), "rare").meta;
    const helm = piece(d, "helm"), plate = piece(d, "plate"), legs = piece(d, "legs"), boots = piece(d, "boots");
    expect(gearSets([helm, piece(w, "plate")])).toEqual([]);
    // Someone else's red dragon is another set.
    expect(gearSets([helm, piece(d, "plate", { summoner: "Ada" })])).toEqual([]);
    const two = armourTotals([helm, plate]);
    expect(two.sets[0].pieces).toBe(2);
    expect(two.defense).toBeCloseTo((helm.defense! + plate.defense!) * 1.2, 0);
    // Three: the set's perks for all; four: sturdy, and the dragon's own staff hits harder.
    expect(armourTotals([helm, plate, legs]).sets[0].bonuses.length).toBe(2);
    const full = armourTotals([helm, plate, legs, boots]);
    expect(full.perks.has("sturdy")).toBe(true);
    const staff = piece(d, "staff");
    expect(weaponDamage(staff, [helm, plate, legs, boots], 999)).toBe(Math.round(staff.damage! * 1.2));
    expect(weaponDamage(staff, [helm, plate], 999)).toBe(staff.damage);
    expect(weaponDamage(piece(w, "sword"), [helm, plate, legs, boots], 999)).toBe(piece(w, "sword").damage);
    // Never past one hit's cap.
    expect(weaponDamage(staff, [helm, plate, legs, boots], 10)).toBe(10);
  });

  it("salvages for more aether the rarer and higher the piece", () => {
    const d = spec("an angry wolf");
    const low = makeGear(d, "helm", ctx({ tier: 1, playerLevel: 1 }), "common").meta;
    const high = makeGear(d, "helm", ctx({ tier: 5, playerLevel: 40 }), "legendary").meta;
    expect(salvageValue(low)).toBeGreaterThanOrEqual(1);
    expect(salvageValue(high)).toBeGreaterThan(salvageValue(low) * 10);
  });

  it("only elemental creatures give elemental gear", () => {
    expect(perksFor(planCreature("a shark", DEFAULT_STANDARDS).spec!, "sword")).not.toContain("burning");
    expect(perksFor(planCreature("an angry wolf", DEFAULT_STANDARDS).spec!, "sword")).toEqual([]);
    expect(perksFor(planCreature("a frost wolf", DEFAULT_STANDARDS).spec!, "sword")).toContain("chilling");
  });
});
