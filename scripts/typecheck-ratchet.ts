// Typecheck ratchet for apps/app and ui: tsc over tsconfig.typecheck.json, the errors counted and compared with the checked-in count (scripts/typecheck-baseline.json).
// More errors than the baseline fail; fewer pass and say so, and `--update` writes the lower count (it refuses to raise it). So new errors cannot land and the count only falls.
// Module-not-found errors (TS2307, TS7016) are not counted: they say what the machine has installed, not what the code says. Without react-native installed the check is skipped.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const UNCOUNTED = new Set(["TS2307", "TS7016"]);

/** The counted errors of tsc's output: one per `error TSnnnn` line, less the uncounted codes. */
export function countErrors(output: string): number {
  let n = 0;
  for (const line of output.split("\n")) {
    const m = /error (TS\d+):/.exec(line);
    if (m && !UNCOUNTED.has(m[1]!)) n++;
  }
  return n;
}

/** pass, or fail with why; `lower` says the baseline may be written lower. */
export function judge(count: number, baseline: number): { ok: boolean; lower: boolean; words: string } {
  if (count > baseline) return { ok: false, lower: false, words: `${count} typecheck errors, ${count - baseline} more than the ${baseline} the repo allows. Fix the new ones (tsc -p tsconfig.typecheck.json).` };
  if (count < baseline) return { ok: true, lower: true, words: `${count} typecheck errors, ${baseline - count} fewer than the baseline ${baseline}: run with --update to lock the lower count in.` };
  return { ok: true, lower: false, words: `${count} typecheck errors, as allowed.` };
}

function main(): void {
  const root = process.cwd();
  const baselineFile = path.join(root, "scripts/typecheck-baseline.json");
  if (!fs.existsSync(path.join(root, "node_modules/react-native/package.json"))) { console.log("typecheck ratchet skipped: react-native is not installed here"); return; }
  const tsc = [process.env["TSC"] ?? "", path.join(root, "node_modules/.bin/tsc"), path.join(root, "tools/gen/node_modules/.bin/tsc")].find((p) => p !== "" && fs.existsSync(p));
  if (!tsc) { console.log("typecheck ratchet skipped: no tsc installed here"); return; }
  const r = spawnSync(tsc, ["-p", "tsconfig.typecheck.json"], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });
  const count = countErrors(`${r.stdout}\n${r.stderr}`);
  const baseline = (JSON.parse(fs.readFileSync(baselineFile, "utf8")) as { count: number }).count;
  const v = judge(count, baseline);
  console.log(v.words);
  if (process.argv.includes("--update")) {
    if (count > baseline) { console.error("refusing to raise the baseline"); process.exit(1); }
    fs.writeFileSync(baselineFile, `${JSON.stringify({ count }, null, 2)}\n`);
    return;
  }
  if (!v.ok) process.exit(1);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
