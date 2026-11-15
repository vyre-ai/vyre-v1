// A release is cut only on a commit whose browser walks ran green (15 Nov 2026).
//
// The `shots` workflow runs the walks that drive the real exported app in a real browser (release-evidence, release-evidence-walks, release-evidence-clicks). The `check` workflow does not run them, so on
// 15 Nov 2026 rc.27 and rc.28 were cut with `shots` red on every integration push and nobody had read it. `reuse` only looks at main.yml. This lookup finds the finished, green `shots` run that proves the
// tagged commit and the release refuses to go live without one.
//
// Which run proves a commit: a finished `shots.yml` run that concluded success, whose head commit is exactly the tagged commit, OR whose head commit has exactly the same tree (a squash merge to main is a new
// commit with the same files as the integration branch head it was made from; shots never runs on main itself). Every walk job must have succeeded, none skipped: a run dispatched with only some walks skips
// the others and proves nothing. Anything else, including a lookup that failed, means "no run", and the release stops with the reason.
import { API, getAll, getJson } from "../lib/gh-api.ts";
import type { GetOptions } from "../lib/gh-api.ts";

/** The jobs that drive the real app in a browser; each must have succeeded in the run. */
export const WALK_JOBS: readonly string[] = [
  "release-evidence",
  "release-evidence-walks",
  "release-evidence-clicks (team)",
  "release-evidence-clicks (personal)",
];

export interface ShotsRun {
  id: number;
  head_sha: string;
  status: string;
  conclusion: string | null;
  event: string;
  html_url: string;
  path?: string;
  head_branch?: string | null;
}
export interface ShotsJob {
  name: string;
  conclusion: string | null;
}

/** Why a run cannot stand in for the walks of this commit; an empty list means it can. */
export function whyShotsNotGreen(run: ShotsRun, jobs: ShotsJob[]): string[] {
  const why: string[] = [];
  if (run.status !== "completed") why.push(`it is ${run.status}`);
  else if (run.conclusion !== "success") why.push(`it ${run.conclusion ?? "has no result"}`);
  const byName = new Map(jobs.map((j) => [j.name, j] as const));
  for (const n of WALK_JOBS) {
    const r = byName.get(n)?.conclusion;
    if (r !== "success")
      why.push(
        `${n} is ${r ?? "missing"}${r === "skipped" ? " (a short round skips the walks it does not name)" : ""}`,
      );
  }
  const failed = jobs.filter((j) => j.conclusion !== null && !["success", "skipped"].includes(j.conclusion));
  for (const j of failed.slice(0, 6)) why.push(`job ${j.name} ${j.conclusion}`);
  return why;
}

export interface ShotsLookup {
  found: { run: ShotsRun; how: "same commit" | "same files"; line: string } | null;
  refused: string[];
}

interface CommitInfo {
  tree: { sha: string };
}

/** The newest green shots run that proves `sha`, and the reason each other candidate was refused. */
export async function findShotsRun(o: { repo: string; sha: string } & GetOptions): Promise<ShotsLookup> {
  const { repo, sha, ...api } = o;
  const refused: string[] = [];
  const base = `${API}/repos/${repo}/actions/workflows/shots.yml/runs`;
  const treeOf = async (s: string) =>
    (await getJson<CommitInfo>(`${API}/repos/${repo}/git/commits/${s}`, api)).tree.sha;
  const exact = await getAll<ShotsRun>(`${base}?head_sha=${sha}&status=completed`, "workflow_runs", api);
  const candidates: Array<{ run: ShotsRun; how: "same commit" | "same files" }> = exact
    .filter((r) => r.head_sha === sha)
    .sort((a, b) => b.id - a.id)
    .map((run) => ({ run, how: "same commit" as const }));
  // the squash commit on main is new, its files are the integration head's: look at the newest green runs on any branch and compare trees
  const mine = await treeOf(sha);
  const recent = await getJson<{ workflow_runs: ShotsRun[] }>(`${base}?status=success&per_page=100`, api);
  for (const run of recent.workflow_runs.sort((a, b) => b.id - a.id)) {
    if (run.head_sha === sha || candidates.some((c) => c.run.id === run.id)) continue;
    if ((await treeOf(run.head_sha)) === mine) candidates.push({ run, how: "same files" });
    if (candidates.length >= 12) break;
  }
  if (candidates.length === 0)
    refused.push(`no finished shots run for ${sha.slice(0, 10)} or for a commit with the same files`);
  for (const { run, how } of candidates) {
    const jobs = await getAll<ShotsJob>(`${API}/repos/${repo}/actions/runs/${run.id}/jobs?filter=latest`, "jobs", api);
    const why = whyShotsNotGreen(run, jobs);
    if (why.length === 0)
      return {
        found: {
          run,
          how,
          line: `Browser walks: ${run.html_url} (${run.head_branch ?? "a branch"}, ${how} as ${sha.slice(0, 10)}): release-evidence, release-evidence-walks and both release-evidence-clicks jobs all succeeded.`,
        },
        refused,
      };
    refused.push(`run ${run.id} (${run.head_branch ?? run.event}, ${how}): ${why.join("; ")}`);
  }
  return { found: null, refused };
}
