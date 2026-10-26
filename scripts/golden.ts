// npm run golden: the required `golden` check. Runs every golden step test (golden/steps/*.test.ts) with node:test, then prints which flows are still blocked by stub modules (golden-ready.ts).
//   node scripts/golden.ts [--dir <steps dir>] [--no-ready]
// Exit code: non-zero when a ready flow fails, zero when only todo flows fail. A step test marks a flow with open GAPS as `todo`: node:test runs it, prints its trail and never counts it as a
// failure, so a flow that is not ready yet is listed and not red, and a ready flow that breaks turns the check red. Finding no step test at all is a failure, so the check can never pass by running nothing.
// The heavy step tests (*.heavy.test.ts, they need Docker or a sandbox) run in their own job in check.yml.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The environment for a child test run: the parent's, without the marker that makes node:test refuse to start a run inside a test (the golden test runs this script from a test). */
const childEnv = (): NodeJS.ProcessEnv => { const env = { ...process.env }; delete env["NODE_TEST_CONTEXT"]; return env; };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The step tests in a directory, sorted: *.test.ts, not *.heavy.test.ts. */
export function stepFiles(dir: string): string[] {
  return fs.readdirSync(dir).filter((f) => f.endsWith(".test.ts") && !f.endsWith(".heavy.test.ts")).sort().map((f) => path.join(dir, f));
}

export interface GoldenOptions { dir?: string; ready?: boolean }

/** Runs the golden steps; returns the exit code. */
export function runGolden(o: GoldenOptions = {}): number {
  const dir = o.dir ?? path.join(ROOT, "golden", "steps");
  let files: string[] = [];
  try { files = stepFiles(dir); } catch { /* no directory: the same failure below */ }
  if (files.length === 0) {
    console.error(`golden: no step test found in ${dir}; the check will not pass by running nothing`);
    return 1;
  }
  // one process: the steps boot daemons and run one after another, and --test-force-exit keeps a leftover handle from holding the job until its timeout
  const tests = spawnSync(process.execPath, ["--test", "--test-force-exit", "--test-reporter=spec", ...files], { cwd: ROOT, stdio: "inherit", env: childEnv() });
  let code = tests.status === 0 ? 0 : 1;
  if (tests.error) { console.error(`golden: could not run node --test: ${tests.error.message}`); code = 1; }
  if (o.ready !== false) {
    // the report of flows still blocked by stub modules; with no --deadline it only reports
    const ready = spawnSync(process.execPath, [path.join(ROOT, "scripts", "golden-ready.ts")], { cwd: ROOT, stdio: "inherit" });
    if (ready.status !== 0) code = 1;
  }
  console.log(code === 0 ? "golden: ok (a flow with open gaps is listed above as todo, never red)" : "golden: FAILED");
  return code;
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--dir");
  const dir = i >= 0 ? args[i + 1] : undefined;
  process.exit(runGolden({ ...(dir ? { dir: path.resolve(dir) } : {}), ready: !args.includes("--no-ready") }));
}
