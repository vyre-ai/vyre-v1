#!/usr/bin/env node
// Which test files a change can affect. Walks the import graph backwards from each changed file to the tests that reach it.
//   node scripts/ci-select.mjs <base-ref>   prints {"all","files","why","uncovered"}; exit 1 when a changed code file is reached by no test
// Everything runs when the change reaches every test (package.json, lockfile, workflows, the runner, slow list) or a data file nothing imports.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CODE, TEST, imports, dependents, testsReaching } from "./lib/graph.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EVERYTHING = [/(^|\/)package(-lock)?\.json$/, /^\.github\/(workflows|actions)\//, /^scripts\/(test-run|ci-select|lib\/graph)\./, /^test\/slow\.json$/, /^\.node-version$/, /(^|\/)tsconfig[^/]*\.json$/];
const INERT = [/^team\//, /^docs\//, /\.md$/, /^LICENSE/, /^NOTICE/, /^\.gitignore$/];
const FAN_IN = 1 / 3;

export function select({ changed, tracked, read }) {
  const fwd = imports(tracked, read), rev = dependents(fwd);
  const tests = new Set([...tracked].filter((f) => TEST.test(f)));
  const why = [], uncovered = [], picked = new Set();
  const all = (r) => ({ all: true, files: [], why: [...why, r], uncovered: [] });
  for (const f of changed) {
    if (EVERYTHING.some((r) => r.test(f))) return all(`${f} reaches every test`);
    if (!tracked.has(f)) continue;
    if (tests.has(f)) picked.add(f);
    if (INERT.some((r) => r.test(f))) continue;
    const reached = testsReaching(f, rev);
    if (reached.length > tests.size * FAN_IN && tests.size >= 6) return all(`${f} is reached by ${reached.length} of ${tests.size} tests`);
    for (const t of reached) picked.add(t);
    if (!reached.length) {
      if (CODE.test(f)) uncovered.push(f);
      else return all(`${f} is data nothing imports: a test may read it from disk`);
    }
  }
  return { all: false, files: [...picked].sort(), why, uncovered };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const git = (a) => { const r = spawnSync("git", a, { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 28 }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout; };
  const base = process.argv[2] || "";
  let result;
  try {
    if (!base || /^0+$/.test(base)) throw new Error("no base");
    const tracked = new Set(git(["ls-files"]).split("\n").filter(Boolean));
    const changed = git(["diff", "--name-only", "--no-renames", `${base}...HEAD`]).split("\n").filter(Boolean);
    result = select({ changed, tracked, read: (f) => fs.readFileSync(path.join(REPO, f), "utf8") });
  } catch (e) { result = { all: true, files: [], why: [`could not tell what changed (${e.message.split("\n")[0]}): running everything`], uncovered: [] }; }
  console.log(JSON.stringify(result));
  if (!result.all && result.uncovered.length) { for (const f of result.uncovered) console.error(`no test covers ${f}`); process.exit(1); }
}
