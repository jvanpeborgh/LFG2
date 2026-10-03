import { describe, expect, it } from "vitest";
import { BESTIARY, DEFAULT_STANDARDS as std, MODIFIERS, checkDesign, interpretPrompt, lookupCreature } from "../src/index";

const start = (prompt: string) => {
  const r = interpretPrompt(prompt, std);
  if ("error" in r) throw new Error(`${prompt}: ${r.error}`);
  return r;
};

describe("the bestiary: any creature a player names starts as that creature", () => {
  it("every creature's first try passes the rules, with its species' skill, body and gait", () => {
    for (const c of BESTIARY) {
      const prompt = `a ${c.words[0]}`;
      const r = start(prompt);
      expect(r.brief.skill, prompt).toBe(c.skill);
      expect(r.start.gait, prompt).toBe(c.gait);
      const check = checkDesign(r.start, std);
      expect(check.ok, `${prompt}: ${JSON.stringify(check.issues.filter((i) => i.level === "error"))} ${check.report?.errors ?? ""}`).toBe(true);
    }
  });

  it("every material works on any body: a robot crab, an ice wolf, a ghostly horse", () => {
    for (const m of MODIFIERS) for (const base of ["crab", "wolf", "horse", "dragon", "knight"]) {
      const prompt = `a ${m.words[0]} ${base}`;
      const check = checkDesign(start(prompt).start, std);
      expect(check.ok, `${prompt}: ${JSON.stringify(check.issues.filter((i) => i.level === "error"))}`).toBe(true);
    }
  });

  it("the last creature word is the creature, earlier ones are what it's made of", () => {
    expect(lookupCreature("a robot crab")?.creature.name).toBe("Crab");
    expect(lookupCreature("a zombie horse")?.modifiers.map((m) => m.words[0])).toContain("zombie");
    expect(start("a kraken").brief.name).toBe("Kraken");
    expect(start("a fire fox").start.shape!.parts.some((p) => p.shapes.some((q) => q.finish === "glow"))).toBe(true);
  });

  it("species features show up as shapes: a unicorn's horn, a crab's pincers, a giraffe's neck", () => {
    const head = (p: string) => start(p).start.shape!.parts.find((q) => q.anim === "head")!;
    expect(head("a unicorn").shapes.some((q) => q.type === "cone" && q.twist)).toBe(true);
    expect(start("a crab").start.shape!.parts.some((p) => p.name === "pincer")).toBe(true);
    const giraffe = head("a giraffe"), horse = head("a horse");
    expect(giraffe.shapes[0].at[1]).toBeGreaterThan(horse.shapes[0].at[1] + 0.5);
    expect(start("a tiger").start.shape!.parts.find((p) => p.anim === "body")!.shapes.some((q) => q.paint)).toBe(true);
  });

  it("is never a dead end: an unknown thing starts from a template and says so", () => {
    const r = start("a toaster");
    expect(checkDesign(r.start, std).ok).toBe(true);
    expect(r.brief.notes.join(" ")).toMatch(/isn't in the bestiary/);
  });
});
