// CI time budgets (ARCH-DECISIONS 13, binding): a push 5 minutes, a merge to main 10, a tag to live 25.
//   node scripts/ci-budget.ts --kind push|main|tag (--run-id N --repo owner/name | --start ISO) [--now ISO]
// Ruling 12: the budget measures execution only, from the first job start to now (the budget job runs last, with if: always()).
// Runner queue wait (run_started_at to the first job start) is reported separately and alerts above 2 minutes, but never fails the budget.
// With --start ISO the old wall-clock behaviour is kept for callers that have no job list.
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Kind = "push" | "main" | "tag";
export const LIMIT_MIN: Record<Kind, number> = { push: 5, main: 10, tag: 25 };

export type Verdict = { kind: Kind; wallSec: number; limitSec: number; ok: boolean; line: string };

const fmt = (s: number) => `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, "0")}s`;

/** Wall seconds between two ISO timestamps. */
export function wallSec(startIso: string, nowIso: string): number {
  const a = Date.parse(startIso), b = Date.parse(nowIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error(`bad timestamp: ${startIso} / ${nowIso}`);
  return Math.max(0, (b - a) / 1000);
}

/** A run is inside its budget when its wall time is at most the limit. */
export function checkBudget(kind: Kind, wall: number): Verdict {
  const limitSec = LIMIT_MIN[kind] * 60;
  const ok = wall <= limitSec;
  return { kind, wallSec: wall, limitSec, ok, line: `${ok ? "ok  " : "FAIL"} ${kind} budget: ${fmt(wall)} of ${LIMIT_MIN[kind]}m` };
}

export const QUEUE_ALERT_SEC = 120;
export type JobTiming = { name?: string; started_at: string | null; completed_at?: string | null };

/** First job start, ignoring jobs that never started. */
export function firstStart(jobs: JobTiming[]): string | null {
  const t = jobs.map((j) => j.started_at).filter((x): x is string => !!x).sort((a, b) => Date.parse(a) - Date.parse(b));
  return t[0] ?? null;
}

/** Split a run into queue wait (run start to first job start) and execution (first job start to now). */
export function split(runStartedAt: string, jobs: JobTiming[], nowIso: string): { queueSec: number; execSec: number } {
  const first = firstStart(jobs) ?? nowIso;
  return { queueSec: wallSec(runStartedAt, first), execSec: wallSec(first, nowIso) };
}

/** The report lines: the budget verdict on execution time, then queue wait with an alert line above 2 minutes. */
export function budgetLines(kind: Kind, queueSec: number, execSec: number): { ok: boolean; lines: string[] } {
  const v = checkBudget(kind, execSec);
  const lines = [v.line.replace("budget:", "budget (execution):"), `queue wait: ${fmt(queueSec)} (not counted)`];
  if (queueSec > QUEUE_ALERT_SEC) lines.push(`ALERT queue wait ${fmt(queueSec)} is over ${QUEUE_ALERT_SEC / 60}m: runners are saturated or offline`);
  return { ok: v.ok, lines };
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  const val = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
  const kind = val("--kind") as Kind;
  if (!(kind in LIMIT_MIN)) { console.error("usage: ci-budget.ts --kind push|main|tag (--run-id N --repo owner/name | --start ISO)"); process.exit(2); }
  const now = val("--now") ?? new Date().toISOString();
  if (val("--start")) {
    const v = checkBudget(kind, wallSec(val("--start")!, now));
    console.log(v.line);
    process.exit(v.ok ? 0 : 1);
  }
  const headers = { authorization: `Bearer ${process.env.GH_TOKEN ?? ""}`, accept: "application/vnd.github+json" };
  const base = `https://api.github.com/repos/${val("--repo")}/actions/runs/${val("--run-id")}`;
  const [r1, r2] = await Promise.all([fetch(base, { headers }), fetch(`${base}/jobs?per_page=100`, { headers })]);
  if (!r1.ok || !r2.ok) { console.error(`github api ${r1.status}/${r2.status}`); process.exit(2); }
  const runStart = ((await r1.json()) as { run_started_at: string }).run_started_at;
  const jobs = ((await r2.json()) as { jobs: JobTiming[] }).jobs;
  const { queueSec, execSec } = split(runStart, jobs, now);
  const out = budgetLines(kind, queueSec, execSec);
  console.log(out.lines.join("\n"));
  process.exit(out.ok ? 0 : 1);
}
