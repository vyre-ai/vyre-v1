// A tag commit whose whole suite already passed does not run it a second time (#789 proposed this; it was written against an older release.yml and never landed).
//
// What counts as "the whole suite passed on this commit": a finished main.yml run for exactly this sha that
//   1. is complete and concluded success,
//   2. ran the whole suite, which the golden-main job proves (it runs only when main.yml's select said "whole suite": a schedule or dispatch run, or a push with no base), and
//   3. has every shard the whole-suite plan lists for this commit, each with the result "success". The plan is made here, by the same script and flags main.yml uses on a full run
//      (ci-select.ts "" --matrix --max 8 --no-perf), so a shard that was dropped, renamed or skipped is noticed. Tests that exist in the tag commit but not in that run cannot slip by.
// The run's workflow file is the one in that same commit (a run's head_sha and its workflow file are the same commit), so a branch cannot rewrite what "whole suite" means for a sha it does not own.
//
// Anything else, including a lookup that failed, means "no run": the release workflow then runs the whole suite itself, as before. This file never decides to skip a test; it only names a run that ran them.
import { spawnSync } from "node:child_process";
import { API, getAll } from "../lib/gh-api.ts";
import type { GetOptions } from "../lib/gh-api.ts";

/** The flags main.yml's full run passes to ci-select (scripts/workflows.test.ts keeps this equal to the workflow text). */
export const MAIN_FULL_SELECT_ARGS: readonly string[] = ["", "--matrix", "--max", "8", "--no-perf"];

export interface RunInfo { id: number; head_sha: string; status: string; conclusion: string | null; event: string; html_url: string; path?: string; run_attempt?: number; created_at?: string }
export interface JobInfo { name: string; status?: string; conclusion: string | null }

const WORKFLOW_PATH = ".github/workflows/main.yml";
/** The jobs main.yml runs only for a whole-suite run (full == 'true'); each must have succeeded, none skipped. */
export const WHOLE_SUITE_PROOF: readonly string[] = ["select", "golden-main-1", "golden-main-2", "golden-main-3", "golden-main"];

/** Why a run cannot stand in for this commit's whole suite; an empty list means it can. `shards` are the job names the whole-suite plan has for the commit. */
export function whyNotReusable(sha: string, run: RunInfo, jobs: JobInfo[], shards: string[]): string[] {
  const why: string[] = [];
  if (run.head_sha !== sha) why.push(`it is for ${run.head_sha.slice(0, 10)}, not ${sha.slice(0, 10)}`);
  if (run.path !== undefined && !run.path.startsWith(WORKFLOW_PATH)) why.push(`it is the workflow ${run.path}, not ${WORKFLOW_PATH}`);
  if (run.status !== "completed") why.push(`it is ${run.status}`);
  else if (run.conclusion !== "success") why.push(`it ${run.conclusion ?? "has no result"}`);
  const byName = new Map<string, JobInfo>();
  for (const j of jobs) byName.set(j.name, j);
  for (const j of jobs) if (j.conclusion !== null && !["success", "skipped"].includes(j.conclusion)) why.push(`job ${j.name} ${j.conclusion}`);
  for (const n of WHOLE_SUITE_PROOF) {
    const r = byName.get(n)?.conclusion;
    if (r !== "success") why.push(`it did not run the whole suite (${n} is ${r ?? "missing"}${r === "skipped" ? ": an affected-only run" : ""})`);
  }
  if (shards.length === 0) why.push("the whole-suite plan for this commit lists no test job");
  const notGreen = shards.filter((n) => byName.get(n)?.conclusion !== "success");
  if (notGreen.length > 0) why.push(`${notGreen.length} of the ${shards.length} test jobs the whole suite needs did not succeed in it (${notGreen.slice(0, 6).join(", ")}${notGreen.length > 6 ? ", ..." : ""})`);
  return why;
}

export interface Found { run: RunInfo; shards: number; line: string }
export interface Lookup { found: Found | null; refused: string[] }

/** The newest run of main.yml for `sha` that qualifies, and the reason each other candidate was refused. */
export async function findReusable(o: { repo: string; sha: string; shards: string[] } & GetOptions): Promise<Lookup> {
  const { repo, sha, shards, ...api } = o;
  const refused: string[] = [];
  const runs = await getAll<RunInfo>(`${API}/repos/${repo}/actions/workflows/main.yml/runs?head_sha=${sha}&status=completed`, "workflow_runs", api);
  const newest = runs.filter((r) => r.head_sha === sha).sort((a, b) => b.id - a.id);
  if (newest.length === 0) { refused.push(`no finished main.yml run for ${sha.slice(0, 10)}`); return { found: null, refused }; }
  for (const run of newest.slice(0, 10)) {
    // a run's jobs of its latest attempt: a re-run that turned the run green is judged by the jobs that finally passed
    const jobs = await getAll<JobInfo>(`${API}/repos/${repo}/actions/runs/${run.id}/jobs?filter=latest`, "jobs", api);
    const why = whyNotReusable(sha, run, jobs, shards);
    if (why.length === 0) {
      return { found: { run, shards: shards.length, line: `Tests: reused the whole-suite run ${run.html_url} (${run.event}, attempt ${run.run_attempt ?? 1}) for ${sha}: its select, golden and ${shards.length} test jobs all succeeded; this release did not run the suite again.` }, refused };
    }
    refused.push(`run ${run.id} (${run.event}): ${why.join("; ")}`);
  }
  return { found: null, refused };
}

/** The job names of main.yml's whole-suite plan for the checked-out commit (runs scripts/ci-select.ts the way main.yml does). */
export function wholeSuiteShards(root: string, run: (args: string[]) => { status: number | null; stdout: string; stderr: string } = defaultSelect(root)): string[] {
  const r = run(["scripts/ci-select.ts", ...MAIN_FULL_SELECT_ARGS]);
  if (r.status !== 0) throw new Error(`ci-select failed (${r.status}): ${r.stderr.trim().slice(0, 300)}`);
  const parsed = JSON.parse(r.stdout) as { matrix?: { include?: Array<{ name: string }> } };
  return (parsed.matrix?.include ?? []).map((m) => m.name);
}
const defaultSelect = (root: string) => (args: string[]) => {
  const p = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { status: p.status, stdout: p.stdout, stderr: p.stderr };
};
