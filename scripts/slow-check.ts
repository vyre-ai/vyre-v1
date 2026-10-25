// Checks test/slow.json (ARCH 10.2): at most 15 non-perf entries (perf entries run on the v1-perf runners and are not counted), each { file, capSec <= 120, owner, reason, heavy? }.
// CLI: node scripts/slow-check.ts [path]  exits 1 and prints one line per problem.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_ENTRIES = 15;
export const MAX_CAP_SEC = 120;
export const TEST_FILE = /\.test\.(?:m?js|cjs|tsx?)$/;

export type SlowEntry = { file: string; capSec: number; owner: string; reason: string; heavy?: boolean; perf?: boolean };

/** Every problem in a slow list; an empty array means the list is valid. */
export function checkSlow(entries: unknown): string[] {
  if (!Array.isArray(entries)) return ["test/slow.json must be an array"];
  const problems: string[] = [];
  const counted = entries.filter((e: any) => !(e && e.perf === true)).length;
  if (counted > MAX_ENTRIES) problems.push(`test/slow.json has ${counted} entries, the cap is ${MAX_ENTRIES}`);
  const seen = new Set<string>();
  entries.forEach((e: any, i) => {
    const at = `entry ${i + 1}${e && typeof e.file === "string" ? ` (${e.file})` : ""}`;
    if (!e || typeof e !== "object") return void problems.push(`${at} is not an object`);
    if (typeof e.file !== "string" || !TEST_FILE.test(e.file)) problems.push(`${at}: file must name a test file`);
    else if (seen.has(e.file)) problems.push(`${at}: listed twice`);
    else seen.add(e.file);
    if (!Number.isInteger(e.capSec) || e.capSec <= 20 || e.capSec > MAX_CAP_SEC) problems.push(`${at}: capSec must be an integer from 21 to ${MAX_CAP_SEC}`);
    if (typeof e.owner !== "string" || !e.owner.trim()) problems.push(`${at}: owner is required`);
    if (typeof e.reason !== "string" || !e.reason.trim()) problems.push(`${at}: reason is required`);
    if (e.heavy !== undefined && typeof e.heavy !== "boolean") problems.push(`${at}: heavy must be a boolean`);
    if (e.perf !== undefined && typeof e.perf !== "boolean") problems.push(`${at}: perf must be a boolean`);
  });
  return problems;
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  const file = process.argv[2] || path.join(path.dirname(self), "..", "test", "slow.json");
  const problems = checkSlow(JSON.parse(fs.readFileSync(file, "utf8")));
  for (const p of problems) console.error(p);
  console.log(problems.length ? `slow-check: ${problems.length} problem(s)` : "slow-check: ok");
  process.exit(problems.length ? 1 : 0);
}
