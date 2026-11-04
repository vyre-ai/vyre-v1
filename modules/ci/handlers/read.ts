// The read side: runs, one run, the month's cost, and whether a project shows the CI tab (lane l-ci-runners).
import { costOf } from "../cost.ts";
import { ensure, isAdmin, monthOf, raise, readSettings, round4, runBy, RUN_COLS, runOf, runsIn } from "../projections.ts";
import type { CiCtx, Row, Run } from "../projections.ts";
import { projectOfRepo, repoOfProject } from "./link.ts";
import { appState } from "./settings.ts";

const view = (r: Run) => ({
  runId: r.runId, jobId: r.jobId, workflowRunId: r.workflowRunId, repo: r.repo, jobName: r.jobName, projectId: r.projectId, state: r.state, dropletId: r.dropletId, size: r.size,
  queuedAt: r.queuedAt, startedAt: r.startedAt, endedAt: r.endedAt, conclusion: r.conclusion, costUsd: r.costUsd, note: r.note,
});

/** Who may see a repository's runs: an admin, or anyone who sees the project it belongs to. */
async function mayRead(ctx: CiCtx, repo: string | undefined, projectId: string | undefined): Promise<void> {
  if (isAdmin(ctx)) return;
  if (projectId) { await repoOfProject(ctx, projectId); return; }   // projects.get refuses a project the caller is not in
  if (!repo || !(await projectOfRepo(ctx, repo))) raise(ctx, "permission.no_grant", "You can only see the runs of a project you are in.");
}

export async function runsList(ctx: CiCtx, input: { projectId?: string; repo?: string; state?: string; cursor?: string; limit?: number }) {
  ensure(ctx);
  if (!input.projectId && !input.repo) raise(ctx, "validation.bad_input", "Say which project or repository.");
  await mayRead(ctx, input.repo, input.projectId);
  const where: string[] = [], args: unknown[] = [];
  if (input.projectId) { where.push(`"project_id" = ?`); args.push(input.projectId); }
  if (input.repo) { where.push(`lower("repo") = ?`); args.push(input.repo.toLowerCase()); }
  if (input.state) { where.push(`"state" = ?`); args.push(input.state); }
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 500), offset = Math.max(Number(input.cursor ?? 0) || 0, 0);
  const rows = ctx.db.all(`SELECT ${RUN_COLS} FROM ci_run WHERE ${where.join(" AND ")} ORDER BY "queued_at" DESC, "job_id" DESC LIMIT ? OFFSET ?`, ...args, limit + 1, offset) as Row[];
  return { runs: rows.slice(0, limit).map((r) => view(runOf(r))), ...(rows.length > limit ? { next: String(offset + limit) } : {}) };
}

export async function runsGet(ctx: CiCtx, input: { runId: string }) {
  ensure(ctx);
  const r = runBy(ctx, "run_id", input.runId);
  if (!r) raise(ctx, "validation.not_found", "There is no such run.");
  await mayRead(ctx, r.repo, r.projectId ?? undefined);
  return { run: view(r) };
}

export function costMonth(ctx: CiCtx, input: { month?: string }) {
  if (!isAdmin(ctx)) raise(ctx, "permission.no_grant", "Only an admin can see what CI costs.");
  ensure(ctx);
  const month = input.month ?? monthOf(ctx.now()), s = readSettings(ctx);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const from = Date.UTC(y, m - 1, 1), to = Date.UTC(y, m, 1);
  const rows = (ctx.db.all(`SELECT ${RUN_COLS} FROM ci_run WHERE COALESCE("ended_at", "started_at", "queued_at") >= ? AND COALESCE("ended_at", "started_at", "queued_at") < ?`, from, to) as Row[]).map(runOf);
  const by = new Map<string, { runs: number; costUsd: number }>();
  let spent = 0, count = 0;
  for (const r of rows) {
    if (r.state === "queued" || r.state === "refused") continue;
    const c = r.state === "starting" || r.state === "running" ? costOf(r.priceHourly ?? 0, (ctx.now() - (r.startedAt ?? ctx.now())) / 1000) : r.costUsd;
    spent += c; count++;
    const e = by.get(r.repo) ?? { runs: 0, costUsd: 0 }; e.runs++; e.costUsd = round4(e.costUsd + c); by.set(r.repo, e);
  }
  spent = round4(spent);
  return {
    month, spentUsd: spent, capUsd: s.monthlyCapUsd, leftUsd: round4(Math.max(0, s.monthlyCapUsd - spent)), runs: count,
    paused: month === monthOf(ctx.now()) && ctx.db.all(`SELECT "value" FROM ci_meta WHERE "key" = ?`, `paused:${month}`).length > 0,
    byRepo: [...by.entries()].map(([repo, v]) => ({ repo, ...v })).sort((a, b) => b.costUsd - a.costUsd),
  };
}

export async function projectGet(ctx: CiCtx, input: { projectId: string }) {
  ensure(ctx);
  const repo = await repoOfProject(ctx, input.projectId), s = readSettings(ctx);
  const mine = (states: Parameters<typeof runsIn>[1]) => runsIn(ctx, states).filter((r) => r.projectId === input.projectId).length;
  // the GitHub App still lacks the permissions runners need: the CI rows say so and offer Accept, which opens GitHub (the same words as the Console card)
  const app = s.enabled ? await appState(ctx) : null;
  return {
    linked: repo !== null, repo, enabled: s.enabled && s.vaultKeyRef !== null, labels: s.labels, live: mine(["starting", "running"]), queued: mine(["queued"]),
    appNeedsAccept: app !== null && app.installed && !app.ready, acceptUrl: app?.acceptUrl ?? null, orgAcceptUrl: app?.orgAcceptUrl ?? null,
  };
}
