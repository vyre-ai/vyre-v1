// Writes agent/tests/golden/naive-calls.json: for every tool the generated catalog holds, the first call a capable model would write from the tool's description and the inputs it is shown.
// A tool that already has an entry keeps it (an entry may be edited by hand where the generator cannot know a value); `--rebuild` writes every entry again.
//   node scripts/naive-calls.ts [--rebuild]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadGenerated } from "../agent/src/tools/harness.ts";
import { naiveObject } from "../agent/tests/naive-kit.test.ts";

const file = fileURLToPath(new URL("../agent/tests/golden/naive-calls.json", import.meta.url));
let have: Record<string, unknown> = {};
if (!process.argv.includes("--rebuild")) {
  try {
    have = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    /* none yet */
  }
}
const out: Record<string, unknown> = {};
for (const t of [...loadGenerated().catalog.all].sort((a, b) => a.name.localeCompare(b.name)))
  out[t.name] = t.name in have ? have[t.name] : naiveObject(t.inputSchema as never);
writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
console.log(`naive calls: ${Object.keys(out).length} tools`);
