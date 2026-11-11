// Sharder (ARCH 10.6): split test files by measured duration (test/timings.json), greedy longest-first, file-level granularity.
// Fast shard count = min(24, ceil(totalSeconds / 25)). Files named in test/slow.json never enter a fast shard: each runs in its own
// parallel slow job, so a slow file cannot extend the fast critical path.
//   node scripts/shard.ts <file>...   (or file names on stdin)   prints the matrix JSON: { include: [{ name, files, slow }] }
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SlowEntry } from "./slow-check.ts";
import { withPatternSlow } from "./lib/slow-list.mjs";

export const MAX_SHARDS = 24;
export const TARGET_SEC = 25;
// Shards scale with the number of selected files, not a fixed count: GitHub caps free hosted runners at 20 concurrent jobs and the self-hosted fleet is 41, so a small change takes 1 to 3 jobs, not 15.
// One fast shard per 40 files (min 1, max MAX_SHARDS); non-perf slow files are grouped 8 to a job; a perf file keeps its own job on the pinned perf host.
export const FILES_PER_SHARD = 40;
export const SLOW_FILES_PER_JOB = 8;
export const FALLBACK_SEC = 3;
// Ruling 52 (P-CI_31): 30 s, was 20 s. Cold pass caches on the new hosts and hosted runners made real 20-22 s UI files hit the old cap; CI hygiene only, speed budgets stay on v1-perf (ruling 46).
export const FAST_CAP_SEC = 30;
// A heavy file that measured at most this long in the last real run (test/timings.json) is a quick one: in a shard it skips or finishes at once (the browser walks skip there and run in release-evidence with VYRE_REQUIRE_CHROME).
// Giving each of those a job of its own cost about 17.5 s of checkout and setup for about 1 s of work (rc.24 run 42716223489: 25 of 37 heavy jobs). Quick heavy files share a job, at most 8 files and 60 s of measured time together.
// A heavy file with no measurement, one over this limit, and every *.heavy.test (Docker) keep a job to themselves.
export const HEAVY_QUICK_SEC = 15;
export const HEAVY_GROUP_SEC = 60;
export const HEAVY_FILES_PER_JOB = 8;

export type Timings = Record<string, { ms: number; at?: string }>;
export type Shards = {
  count: number;
  totalSec: number;
  makespanSec: number;
  fast: { files: string[]; sec: number }[];
  slow: { file: string; capSec: number; perf?: boolean; heavy?: boolean; sec?: number }[];
};

/** Number of fast shards for a total of affected seconds; at least one when there is any work. */
export function shardCount(totalSec: number, max = MAX_SHARDS, target = TARGET_SEC): number {
  return totalSec <= 0 ? 0 : Math.min(max, Math.ceil(totalSec / target));
}

/** Seconds a file is expected to take: its measured time, else the median of measured files, else the fallback. Capped at the fast file cap. */
export function expectedSec(file: string, timings: Timings, median: number): number {
  const t = timings[file];
  return Math.min(FAST_CAP_SEC, t && t.ms > 0 ? t.ms / 1000 : median);
}

function medianSec(files: string[], timings: Timings): number {
  const known = files.map((f) => timings[f]?.ms).filter((m): m is number => typeof m === "number" && m > 0).sort((a, b) => a - b);
  return known.length ? known[Math.floor(known.length / 2)]! / 1000 : FALLBACK_SEC;
}

/** Greedy longest-first placement of the fast files into ceil(files/40) shards (max 24); the slow files are listed here and grouped into jobs by toMatrix. */
export function shardFiles(files: string[], timings: Timings, slow: SlowEntry[], opts: { max?: number; target?: number; read?: (file: string) => string } = {}): Shards {
  const uniq = [...new Set(files)].sort();
  const slowBy = new Map((withPatternSlow(uniq, slow, opts.read) as SlowEntry[]).map((s) => [s.file, s]));
  const slowJobs = uniq.filter((f) => slowBy.has(f)).map((file) => ({ file, capSec: slowBy.get(file)!.capSec, perf: slowBy.get(file)!.perf === true, heavy: slowBy.get(file)!.heavy === true, ...(timings[file] && timings[file]!.ms > 0 ? { sec: timings[file]!.ms / 1000 } : {}) }));
  const fastFiles = uniq.filter((f) => !slowBy.has(f));
  const median = medianSec(fastFiles, timings);
  const rows = fastFiles.map((f) => ({ f, sec: expectedSec(f, timings, median) })).sort((a, b) => b.sec - a.sec || (a.f < b.f ? -1 : 1));
  const totalSec = rows.reduce((n, r) => n + r.sec, 0);
  const count = fastFiles.length === 0 ? 0 : Math.min(opts.max ?? MAX_SHARDS, Math.max(1, Math.ceil(fastFiles.length / FILES_PER_SHARD)));
  const bins = Array.from({ length: count }, () => ({ files: [] as string[], sec: 0 }));
  for (const r of rows) {
    let best = bins[0]!;
    for (const b of bins) if (b.sec < best.sec) best = b;
    best.files.push(r.f); best.sec += r.sec;
  }
  for (const b of bins) b.files.sort();
  return { count, totalSec, makespanSec: bins.reduce((m, b) => Math.max(m, b.sec), 0), fast: bins, slow: slowJobs };
}

/** The select job's output: plain jobs, not matrix-expanded workflows. */
export type Runner = "v1" | "v1-perf" | "hosted";
/**
 * Where a matrix entry runs. Fast shards and plain slow groups run on GitHub-hosted runners (free, since the repo is public; 4 cores each, nothing shared with the other jobs of the push), which takes about 70 percent of the
 * work off the 24 self-hosted slots (rc.24 run 42716223489: 126 shard jobs, 8,654 job-seconds, shards ended at +418 s on the fleet). Heavy entries (Docker, one job each or a quick group), perf entries (the pinned perf host) and
 * every non-shard job (gates, release signing, the Docker jobs) stay self-hosted. Only the runner differs: the files, their grouping and their order are the same as they were.
 */
export const HOSTED = "hosted" as const;
export function toMatrix(s: Shards): { include: { name: string; files: string; slow: boolean; runner: Runner }[] } {
  const perf = s.slow.filter((j) => j.perf);
  // A *.heavy.test file (it boots Docker containers or a daemon with its own wait of seconds) gets a job to itself: next to seven other files running in parallel it starved and failed its
  // "did not start in 12 s" wait (images/vyred/smoke.heavy.test.ts on slow-1, #661). It stays on the v1 runners. A heavy file listed in test/slow.json that measured quick (HEAVY_QUICK_SEC) shares a job with other quick ones.
  const isHeavy = (j: { file: string; heavy?: boolean }): boolean => j.heavy === true || /\.heavy\.test\./.test(j.file);
  const heavy = s.slow.filter((j) => !j.perf && isHeavy(j));
  const quick = heavy.filter((j) => !/\.heavy\.test\./.test(j.file) && j.sec !== undefined && j.sec <= HEAVY_QUICK_SEC).sort((a, b) => b.sec! - a.sec! || (a.file < b.file ? -1 : 1));
  const alone = heavy.filter((j) => !quick.includes(j));
  const quickGroups: { files: string[]; sec: number }[] = [];
  for (const j of quick) {   // first fit, longest first
    const g = quickGroups.find((x) => x.files.length < HEAVY_FILES_PER_JOB && x.sec + j.sec! <= HEAVY_GROUP_SEC);
    if (g) { g.files.push(j.file); g.sec += j.sec!; } else quickGroups.push({ files: [j.file], sec: j.sec! });
  }
  const heavyJobs = [...alone.map((j) => j.file), ...quickGroups.map((g) => g.files.sort().join(" "))];
  const plain = [...s.slow.filter((j) => !j.perf && !isHeavy(j))].sort((a, b) => (b.sec ?? b.capSec) - (a.sec ?? a.capSec) || (a.file < b.file ? -1 : 1));
  const groups = Array.from({ length: Math.ceil(plain.length / SLOW_FILES_PER_JOB) }, () => ({ files: [] as string[], cap: 0 }));
  for (const j of plain) {   // longest first (measured seconds, else the cap) into the group with the least total
    let best = groups[0]!;
    for (const g of groups) if (g.cap < best.cap) best = g;
    best.files.push(j.file); best.cap += j.sec ?? j.capSec;
  }
  return {
    include: [
      ...s.fast.map((b, i) => ({ name: `fast-${i + 1}`, files: b.files.join(" "), slow: false, runner: HOSTED })),
      ...groups.map((g, i) => ({ name: `slow-${i + 1}`, files: g.files.sort().join(" "), slow: true, runner: HOSTED })),
      ...heavyJobs.map((files, i) => ({ name: `heavy-${i + 1}`, files, slow: true, runner: "v1" as const })),
      ...perf.map((j, i) => ({ name: `perf-${i + 1}`, files: j.file, slow: true, runner: "v1-perf" as const })),
    ],
  };
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  const repo = path.resolve(path.dirname(self), "..");
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const files = args.length ? args : fs.readFileSync(0, "utf8").split(/\s+/).filter(Boolean);
  const timings: Timings = JSON.parse(fs.readFileSync(path.join(repo, "test/timings.json"), "utf8"));
  const slow: SlowEntry[] = JSON.parse(fs.readFileSync(path.join(repo, "test/slow.json"), "utf8"));
  console.log(JSON.stringify(toMatrix(shardFiles(files, timings, slow))));
}
