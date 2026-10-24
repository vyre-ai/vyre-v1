// CI time budgets (ARCH-DECISIONS 13, binding): a push 5 minutes, a merge to main 10, a tag to live 25.
//   node scripts/ci-budget.ts --kind push|main|tag (--run-id N --repo owner/name | --start ISO) [--now ISO]
// Wall time is now minus the run's run_started_at. Exits 1 when the run is over its budget. The budget job runs with if: always().
import { spawnSync } from "node:child_process";
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

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  const val = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
  const kind = val("--kind") as Kind;
  if (!(kind in LIMIT_MIN)) { console.error("usage: ci-budget.ts --kind push|main|tag (--run-id N --repo owner/name | --start ISO)"); process.exit(2); }
  let start = val("--start");
  if (!start) {
    const r = spawnSync("gh", ["api", `repos/${val("--repo")}/actions/runs/${val("--run-id")}`, "--jq", ".run_started_at"], { encoding: "utf8" });
    if (r.status !== 0) { console.error(r.stderr); process.exit(2); }
    start = r.stdout.trim();
  }
  const v = checkBudget(kind, wallSec(start, val("--now") ?? new Date().toISOString()));
  console.log(v.line);
  process.exit(v.ok ? 0 : 1);
}
