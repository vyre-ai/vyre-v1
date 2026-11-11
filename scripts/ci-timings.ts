// Builds test/timings.json (the per-file durations the shard balancer packs by, scripts/shard.ts) from the job logs of a real CI run.
// Every shard job prints one line per file: `ok   <file> <ms> ms` (scripts/test-run.ts). A cached pass (`ok   <file> (cached)`), a skip and a failure carry no usable time and are left out.
// CLI:
//   node scripts/ci-timings.ts --run <run id> [--repo vyre-ai/vyre-v1]   reads the logs with the gh CLI (every job of the run that prints such lines)
//   node scripts/ci-timings.ts --logs <dir>                              reads every file of a directory (saved job logs)
//   --at <iso time> stamps the entries (default: the run's start, or now for --logs)
//   add --write to update test/timings.json in place; without it the result is printed as a summary only.
// Files that no longer exist in the repo are dropped; files the logs do not mention keep their old entry. Only the numbers change: which files run is chosen by scripts/ci-select.ts and is not touched here.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export type Timings = Record<string, { ms: number; at: string }>;

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;
const LINE = /^(?:\d{4}-\d{2}-\d{2}T[\d:.]+Z )?ok\s+(\S+\.(?:m?js|cjs|tsx?)) (\d+) ms\s*$/;

/** The files a job log reports as passed, with their milliseconds. A file named twice keeps the larger time. */
export function parseLog(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const raw of text.split("\n")) {
    const m = LINE.exec(raw.replace(ANSI, "").replace(/\r$/, ""));
    if (!m) continue;
    const ms = Number(m[2]);
    if (ms > 0 && ms > (out[m[1]!] ?? 0)) out[m[1]!] = ms;
  }
  return out;
}

/** The old table with the measured files replaced (stamped `at`) and the files that are gone from the repo removed. */
export function mergeLogTimings(prev: Timings, measured: Record<string, number>, at: string, exists: (file: string) => boolean): Timings {
  const next: Timings = {};
  for (const [f, v] of Object.entries(prev)) if (exists(f)) next[f] = v;
  for (const [f, ms] of Object.entries(measured)) if (exists(f)) next[f] = { ms, at };
  return Object.fromEntries(Object.entries(next).sort(([a], [b]) => (a < b ? -1 : 1)));
}

function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  const repo = path.resolve(path.dirname(self), "..");
  const val = (n: string): string | undefined => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
  const texts: string[] = [];
  let at = val("--at") ?? new Date().toISOString();
  if (val("--logs")) {
    const dir = val("--logs")!;
    for (const f of fs.readdirSync(dir)) texts.push(fs.readFileSync(path.join(dir, f), "utf8"));
  } else if (val("--run")) {
    const slug = val("--repo") ?? "vyre-ai/vyre-v1", run = val("--run")!;
    const info = JSON.parse(gh(["api", `repos/${slug}/actions/runs/${run}`])) as { created_at?: string };
    if (info.created_at && !val("--at")) at = info.created_at;
    const jobs: { id: number; name: string }[] = [];
    for (let page = 1; ; page++) {
      const p = JSON.parse(gh(["api", `repos/${slug}/actions/runs/${run}/jobs?per_page=100&page=${page}`])) as { jobs: { id: number; name: string }[] };
      jobs.push(...p.jobs);
      if (p.jobs.length < 100) break;
    }
    for (const j of jobs.filter((x) => /^(fast|slow|heavy|perf)-\d+$/.test(x.name))) {
      try { texts.push(gh(["api", `repos/${slug}/actions/jobs/${j.id}/logs`])); } catch (e) { console.error(`no log for ${j.name}: ${String((e as Error).message).split("\n")[0]}`); }
    }
  } else {
    console.error("usage: node scripts/ci-timings.ts (--run <id> [--repo owner/name] | --logs <dir>) [--write]");
    process.exit(2);
  }
  const measured: Record<string, number> = {};
  for (const t of texts) for (const [f, ms] of Object.entries(parseLog(t))) if (ms > (measured[f] ?? 0)) measured[f] = ms;
  const tf = path.join(repo, "test/timings.json");
  const prev = JSON.parse(fs.readFileSync(tf, "utf8")) as Timings;
  const next = mergeLogTimings(prev, measured, at, (f) => fs.existsSync(path.join(repo, f)));
  console.log(`${texts.length} logs, ${Object.keys(measured).length} files measured, ${Object.keys(next).length} in the table (was ${Object.keys(prev).length})`);
  if (process.argv.includes("--write")) fs.writeFileSync(tf, JSON.stringify(next, null, 2) + "\n");
}
