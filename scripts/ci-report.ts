// Job-time report for a CI run, written to the step summary by the budget job.
//   node scripts/ci-report.ts (--run-id N --repo owner/name | --jobs file.json)
// Input is the jobs array of `gh api repos/R/actions/runs/N/jobs`: { name, conclusion, started_at, completed_at }.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Job = { name: string; conclusion: string | null; started_at: string | null; completed_at: string | null };
export type Row = { name: string; conclusion: string; sec: number };

/** Seconds each job took, slowest first. Jobs that never started count as 0. */
export function rows(jobs: Job[]): Row[] {
  return jobs
    .map((j) => ({ name: j.name, conclusion: j.conclusion ?? "running", sec: j.started_at && j.completed_at ? Math.max(0, (Date.parse(j.completed_at) - Date.parse(j.started_at)) / 1000) : 0 }))
    .sort((a, b) => b.sec - a.sec || (a.name < b.name ? -1 : 1));
}

/** Markdown table plus the critical-path hint: the slowest job and the sum. */
export function report(jobs: Job[]): string {
  const r = rows(jobs);
  const sum = r.reduce((n, x) => n + x.sec, 0);
  const lines = ["| job | result | seconds |", "| --- | --- | --- |", ...r.map((x) => `| ${x.name} | ${x.conclusion} | ${Math.round(x.sec)} |`)];
  lines.push("", `${r.length} jobs, slowest ${r[0]?.name ?? "none"} (${Math.round(r[0]?.sec ?? 0)} s), ${Math.round(sum)} s of runner time`);
  return lines.join("\n");
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === self) {
  const val = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
  let jobs: Job[];
  if (val("--jobs")) jobs = JSON.parse(fs.readFileSync(val("--jobs")!, "utf8"));
  else {
    const res = await fetch(`https://api.github.com/repos/${val("--repo")}/actions/runs/${val("--run-id")}/jobs?per_page=100`, { headers: { authorization: `Bearer ${process.env.GH_TOKEN ?? ""}`, accept: "application/vnd.github+json" } });
    if (!res.ok) { console.error(`github api ${res.status}`); process.exit(2); }
    jobs = ((await res.json()) as { jobs: Job[] }).jobs;
  }
  console.log(report(jobs));
}
