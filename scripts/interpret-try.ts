// Read a few requests with Claude and print the intents (needs ANTHROPIC_API_KEY).
//   npx tsx scripts/interpret-try.ts "a sleepy dragon I can ride" "moon gravity for ten minutes"
import { ClaudeInterpreter } from "../packages/server/src/interpreter";
const it = ClaudeInterpreter.fromEnv({ ...process.env, INTERPRETER_DEBUG: "1" });
if (!it) { console.error("no credentials"); process.exit(1); }
for (const text of process.argv.slice(2)) {
  const t0 = Date.now();
  const r = await it.read(text);
  console.log(`\n${text}  (${Date.now() - t0} ms)\n${JSON.stringify(r, (k, v) => (v === null ? undefined : v))}`);
}
