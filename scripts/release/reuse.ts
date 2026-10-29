// A release may skip its own re-run of the test suite when the exact commit already has a green whole-suite run. The check workflow on main runs an empty selection (it selects
// against main itself), so the only whole-suite result for a main commit is main.yml's scheduled or dispatched run: its select step logs "select: whole suite" and only then runs
// golden-main. That run is reused only when it is for exactly this commit, finished green, and every job that carries the suite (select, every shard, golden-main, contracts) passed.
// Anything less, or any doubt, and the release runs everything itself.

export interface RunInfo { id: number; head_sha: string; event: string; status: string; conclusion: string | null; html_url: string; created_at: string }
export interface JobInfo { id: number; name: string; status: string; conclusion: string | null }

/** The events whose main.yml run is the whole suite (a push selects only what it brought). */
export const FULL_EVENTS = ["schedule", "workflow_dispatch"] as const;
/** The line main.yml's select step prints when it picked the whole suite. */
export const FULL_MARK = "select: whole suite";

/** Why this run cannot stand in for the release's own suite, or null when it can. */
export function whyNotReusable(sha: string, run: RunInfo, jobs: readonly JobInfo[], selectLog: string): string | null {
  if (run.head_sha !== sha) return `run ${run.id} is for ${run.head_sha}, not ${sha}`;
  if (!(FULL_EVENTS as readonly string[]).includes(run.event)) return `run ${run.id} is a ${run.event} run, which tests only what that push changed`;
  if (run.status !== "completed" || run.conclusion !== "success") return `run ${run.id} did not finish green (${run.status}/${run.conclusion ?? "none"})`;
  if (!selectLog.includes(FULL_MARK)) return `run ${run.id}'s select step did not log "${FULL_MARK}"`;
  for (const need of ["select", "golden-main", "contracts"]) {
    const j = jobs.find((x) => x.name === need);
    if (!j || j.conclusion !== "success") return `run ${run.id} has no green ${need} job`;
  }
  const bad = jobs.filter((j) => j.conclusion !== "success" && j.conclusion !== "skipped");
  if (bad.length > 0) return `run ${run.id} has jobs that did not pass: ${bad.map((j) => `${j.name} (${j.conclusion ?? j.status})`).join(", ")}`;
  if (!jobs.some((j) => j.name !== "select" && j.name !== "golden-main" && j.name !== "contracts" && j.name !== "merge-ok" && !j.name.startsWith("budget") && j.conclusion === "success")) return `run ${run.id} ran no test shard`;
  return null;
}

type Get = (url: string) => Promise<{ status: number; text(): Promise<string> }>;

/** The newest reusable main.yml run for `sha`, with the reasons every other candidate was refused. */
export async function findReusable(o: { repo: string; token: string; sha: string; get?: Get }): Promise<{ run: RunInfo | null; refused: string[] }> {
  const headers = { authorization: `Bearer ${o.token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
  const get: Get = o.get ?? (async (url) => { const r = await globalThis.fetch(url, { headers, signal: AbortSignal.timeout(60_000) }); return { status: r.status, text: () => r.text() }; });
  const api = `https://api.github.com/repos/${o.repo}`;
  const json = async (url: string): Promise<any> => { const r = await get(url); if (r.status !== 200) throw new Error(`GET ${url}: ${r.status}`); return JSON.parse(await r.text()); };   // eslint-disable-line @typescript-eslint/no-explicit-any
  const runs = ((await json(`${api}/actions/workflows/main.yml/runs?head_sha=${o.sha}&status=completed&per_page=50`)).workflow_runs ?? []) as RunInfo[];
  const refused: string[] = [];
  for (const run of [...runs].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    const jobs = ((await json(`${api}/actions/runs/${run.id}/jobs?per_page=100&filter=latest`)).jobs ?? []) as JobInfo[];
    const select = jobs.find((j) => j.name === "select");
    let log = "";
    if (select) { const r = await get(`${api}/actions/jobs/${select.id}/logs`); if (r.status === 200) log = await r.text(); }
    const why = whyNotReusable(o.sha, run, jobs, log);
    if (why === null) return { run, refused };
    refused.push(why);
  }
  return { run: null, refused };
}
