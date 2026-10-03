// Writes the game's design skills as SKILL.md files (docs/skills/<id>/SKILL.md), for chat apps
// and agents that load skills. The source of truth is packages/shared/src/summons/skills.ts.
//   npx tsx scripts/export-skills.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SKILLS, skillMarkdown } from "../packages/shared/src/index";

for (const skill of SKILLS) {
  const dir = join("docs", "skills", skill.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), skillMarkdown(skill));
  console.log(`${dir}/SKILL.md`);
}

// The general guide (docs/AGENT-BEST-PRACTICES.md) as a skill too.
const guide = readFileSync(join("docs", "AGENT-BEST-PRACTICES.md"), "utf8").replace(/\]\(screenshots\//g, "](../../screenshots/");
mkdirSync(join("docs", "skills", "design-best-practices"), { recursive: true });
writeFileSync(join("docs", "skills", "design-best-practices", "SKILL.md"), `---
name: lfg2-design-best-practices
description: How to turn a player's words into a creature, design or raid for LFG2 that looks good and passes the checks - the loop (interpret, adapt, check, render, save), prompt words, proportions by mood, a primitive cookbook, colour and finish, style, common mistakes, raids and safety.
---

${guide}`);
console.log("docs/skills/design-best-practices/SKILL.md");
