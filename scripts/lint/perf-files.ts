// perf-files: a file marked "perf": true in test/slow.json is skipped by every shard outside the perf host (scripts/test-run.*), so every test in it must measure speed. A functional test
// parked in a perf file silently stops running on PRs. This check fails when a perf file holds a top-level test with no timing or budget assertion; split such a test into its own file.
//   node scripts/lint/perf-files.ts [--report]       exit 1 on a finding (--report prints and exits 0)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type PerfFinding = { file: string; line: number; test: string };

/** Signs that a test body measures or judges speed: a clock, a budget, a percentile, a latency or an elapsed time. */
const TIMING = /performance\.now|hrtime|Date\.now\(\)|\bms\b|_ms\b|\bMs\b|budget|\bp50\b|\bp95\b|\bp99\b|median|latency|elapsed|\btook\b|\bfps\b|per second|ops\/s|\bMETRIC\b|\bthroughput\b/i;

/** The top-level tests of a file with their name, line and body. Tests marked todo or skip are not judged. */
export function topLevelTests(source: string): { name: string; line: number; body: string; parked: boolean }[] {
  const starts = [...source.matchAll(/^(?:test|it)\(\s*([`"'])((?:\\.|(?!\1).)*)\1/gm)];
  return starts.map((m, i) => {
    const end = i + 1 < starts.length ? starts[i + 1]!.index! : source.length;
    const body = source.slice(m.index!, end);
    return { name: m[2]!, line: source.slice(0, m.index!).split("\n").length, body, parked: /\{\s*(?:todo|skip)\s*:/.test(body.slice(0, 400)) };
  });
}

export function checkPerfFile(file: string, source: string): PerfFinding[] {
  return topLevelTests(source).filter((t) => !t.parked && !TIMING.test(t.body)).map((t) => ({ file, line: t.line, test: t.name }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const slow = JSON.parse(fs.readFileSync(path.join(repo, "test/slow.json"), "utf8")) as { file: string; perf?: boolean }[];
  const out: PerfFinding[] = [];
  for (const e of slow) {
    if (e.perf !== true) continue;
    const abs = path.join(repo, e.file);
    if (!fs.existsSync(abs)) continue;
    out.push(...checkPerfFile(e.file, fs.readFileSync(abs, "utf8")));
  }
  for (const f of out) console.log(`perf-files ${f.file}:${f.line}: "${f.test}" has no timing or budget assertion; a perf file is skipped outside the perf host, so split this test into its own file`);
  console.log(`perf-files: ${out.length} test(s) in perf files without a timing or budget assertion`);
  if (out.length && !process.argv.includes("--report")) process.exit(1);
}
