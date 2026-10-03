// Writes the game's design skills as SKILL.md files (docs/skills/<id>/SKILL.md), for chat apps
// and agents that load skills. The source of truth is packages/shared/src/summons/skills.ts.
//   npx tsx scripts/export-skills.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SKILLS, skillMarkdown } from "../packages/shared/src/index";

for (const skill of SKILLS) {
  const dir = join("docs", "skills", skill.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), skillMarkdown(skill));
  console.log(`${dir}/SKILL.md`);
}
