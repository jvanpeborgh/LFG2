import { describe, expect, it } from "vitest";
import { DEFAULT_STANDARDS as std, checkDesign, critiqueDesign, interpretPrompt, cloneStandards, setRule } from "../src";

/**
 * Golden prompts: what players actually ask for, and what a good result must be. A change to the
 * skills, templates, shapes or checks that makes any of these worse fails here. Each must map to
 * the right skill and mood, pass every rule check, and score at least 80 against its brief.
 */
const GOLDEN: { prompt: string; skill: string; mood: string; style?: string }[] = [
  { prompt: "a cute pink dragon", skill: "winged-creature", mood: "cute" },
  { prompt: "a menacing wolf", skill: "four-legged-creature", mood: "menacing" },
  { prompt: "a noble knight", skill: "humanoid", mood: "heroic" },
  { prompt: "a ghost", skill: "floating-spirit", mood: "neutral" },
  { prompt: "an angry shark", skill: "swimmer", mood: "menacing" },
  { prompt: "a cute bunny", skill: "four-legged-creature", mood: "cute" },
  { prompt: "a scary bat", skill: "winged-creature", mood: "menacing" },
  { prompt: "a friendly fox", skill: "four-legged-creature", mood: "cute" },
  { prompt: "an elegant deer", skill: "four-legged-creature", mood: "elegant" },
  { prompt: "a sculpted majestic eagle", skill: "winged-creature", mood: "heroic", style: "sculpted" },
  { prompt: "a low-poly koi", skill: "swimmer", mood: "neutral", style: "lowpoly" },
  { prompt: "a silly slime", skill: "floating-spirit", mood: "comic" },
  { prompt: "a dark knight with a shield", skill: "humanoid", mood: "menacing" },
  { prompt: "a tiny cute moth", skill: "winged-creature", mood: "cute" },
];

describe("golden prompts: briefs, starting designs and their scores", () => {
  for (const g of GOLDEN) {
    it(g.prompt, () => {
      const r = interpretPrompt(g.prompt, std);
      if ("error" in r) throw new Error(r.error);
      expect([r.brief.skill, r.brief.mood]).toEqual([g.skill, g.mood]);
      if (g.style) expect(r.start.style).toBe(g.style);
      const c = checkDesign(r.start, std);
      expect(c.ok, JSON.stringify([c.issues.filter((i) => i.level === "error"), c.report?.errors])).toBe(true);
      const crit = critiqueDesign(r.start, c.model!, r.brief, std);
      expect(crit.score, crit.issues.map((i) => i.message).join("; ")).toBeGreaterThanOrEqual(80);
    });
  }

  it("every golden start also passes in the sculpted style (close-up budget included)", () => {
    const s = cloneStandards(std);
    setRule(s, "art.modelStyle", "sculpted");
    for (const g of GOLDEN) {
      const r = interpretPrompt(g.prompt, s);
      if ("error" in r) throw new Error(r.error);
      const c = checkDesign(r.start, s);
      expect(c.ok, `${g.prompt}: ${JSON.stringify(c.report?.errors)}`).toBe(true);
    }
  }, 20_000);
});
