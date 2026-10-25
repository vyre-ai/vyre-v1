// Pull requests and issues on GitHub (spec 2.10 synced types, 2.16; ARCH 8.5): the live reads behind the pull request page (the pull request, its changed files, the diff and
// its checks), the writes a person or agent makes there (open, change, comment, request review, merge, close, re-run checks), issues, and the two ways work goes to an
// agent: "Ask author agent to fix" (a task, at most three rounds per pull request) and "Assign to agent" on an issue (a task whose result lands as a linked changeset).
// The synced record types themselves (pull_request, issue; labels and assignees two-way, bodies pull only) are pulled and pushed by the connector sync engine from
// the declaration in manifests/github.ts; the capabilities here are what that engine and the pages call.
//
// Nothing here decides whether a write may happen: the host applies the Gate act of each capability (post, or push_protected for a merge) before a handler runs.
// DECISION: a pull request's `checks` is read from the check runs of its head commit: none when there are none, failing when any run failed, timed out, was cancelled or
// needs action, pending when any run is not finished, else passing.
// DECISION: changing labels or assignees of a pull request goes through the issues endpoint, because GitHub keeps them there for both.
// DECISION: "Ask author agent to fix" needs the pull request record to name its author agent (field author_agent), the pull request to be open, and fewer than three rounds
// already asked for it; the round counts once the task exists. Assign to agent writes the task id into the issue record's assigned_task.
import { fail } from "../../../host/src/routes/errors.ts";
import { api, bad, codeOf, ensure, first, installationFor, intOrUndef, list, MAX_FIX_ROUNDS, msOf, num, numberOf, obj, raw, refuse, refusal, repoPath, strOrUndef, text } from "../projections.ts";
import type { Auth, GithubCtx, Json } from "../projections.ts";

type Checks = "none" | "pending" | "passing" | "failing";

export interface PrOut {
  repo: string; number: number; title: string; state: "open" | "closed" | "merged"; draft: boolean; author: string; branch: string; base: string; url: string; checks: Checks;
  labels: string[]; assignees: string[]; body?: string; mergedAt?: number; additions?: number; deletions?: number; changedFiles?: number;
}
export interface IssueOut { repo: string; number: number; title: string; state: "open" | "closed"; author: string; url: string; labels: string[]; assignees: string[]; body?: string }

// ---- shapes

const labelsOf = (v: unknown): string[] => list(v).map((l) => (typeof l === "string" ? l : text(obj(l).name))).filter((n) => n !== "");
const loginsOf = (v: unknown): string[] => list(v).map((a) => text(obj(a).login)).filter((n) => n !== "");

function mapPr(p: Json, repo: string, checks: Checks): PrOut {
  const merged = strOrUndef(p.merged_at);
  const out: PrOut = {
    repo: strOrUndef(obj(obj(p.base).repo).full_name) ?? repo, number: intOrUndef(p.number) ?? 0, title: text(p.title),
    state: merged ? "merged" : text(p.state) === "closed" ? "closed" : "open", draft: p.draft === true, author: text(obj(p.user).login),
    branch: text(obj(p.head).ref), base: text(obj(p.base).ref), url: text(p.html_url), checks, labels: labelsOf(p.labels), assignees: loginsOf(p.assignees),
  };
  const body = strOrUndef(p.body);
  if (body) out.body = body;
  const mergedAt = msOf(merged);
  if (mergedAt !== undefined) out.mergedAt = mergedAt;
  for (const [key, from] of [["additions", "additions"], ["deletions", "deletions"], ["changedFiles", "changed_files"]] as const) {
    const n = intOrUndef(p[from]);
    if (n !== undefined) out[key] = n;
  }
  return out;
}

function mapIssue(i: Json, repo: string): IssueOut {
  const out: IssueOut = {
    repo, number: intOrUndef(i.number) ?? 0, title: text(i.title), state: text(i.state) === "closed" ? "closed" : "open", author: text(obj(i.user).login), url: text(i.html_url),
    labels: labelsOf(i.labels), assignees: loginsOf(i.assignees),
  };
  const body = strOrUndef(i.body);
  if (body) out.body = body;
  return out;
}

const FAILED = new Set(["failure", "timed_out", "cancelled", "action_required"]);

export function checksState(runs: Json[]): Checks {
  if (runs.length === 0) return "none";
  if (runs.some((r) => FAILED.has(text(r.conclusion)))) return "failing";
  if (runs.some((r) => text(r.status) !== "completed")) return "pending";
  return "passing";
}

// ---- where a call goes

async function target(ctx: GithubCtx, repo: unknown): Promise<{ path: string; auth: Auth; repo: string }> {
  const path = repoPath(ctx, repo);
  const installationId = await installationFor(ctx, { repo: repo as string });
  return { path, auth: { as: "installation", installationId }, repo: repo as string };
}

async function runsOf(ctx: GithubCtx, t: { path: string; auth: Auth }, sha: string): Promise<Json[]> {
  if (!/^[0-9a-f]{7,64}$/.test(sha)) throw fail("provider.bad_response", ctx.trace.traceId, { message: "GitHub answered a pull request with no commit." });
  const j = await api(ctx, { path: `${t.path}/commits/${sha}/check-runs`, auth: t.auth, query: { per_page: 100 } });
  return list(j.check_runs).map(obj);
}

async function readPr(ctx: GithubCtx, repo: unknown, number: unknown): Promise<{ pr: Json; t: Awaited<ReturnType<typeof target>>; n: number }> {
  const n = numberOf(ctx, number);
  const t = await target(ctx, repo);
  return { pr: await api(ctx, { path: `${t.path}/pulls/${n}`, auth: t.auth }), t, n };
}

// ---- pull requests: reads

export async function prGet(ctx: GithubCtx, input: { repo: string; number: number }): Promise<{ pullRequest: PrOut }> {
  ensure(ctx);
  const { pr, t } = await readPr(ctx, input.repo, input.number);
  return { pullRequest: mapPr(pr, t.repo, checksState(await runsOf(ctx, t, text(obj(pr.head).sha)))) };
}

export async function prListFiles(ctx: GithubCtx, input: { repo: string; number: number; cursor?: string; limit?: number }) {
  ensure(ctx);
  const n = numberOf(ctx, input.number);
  const t = await target(ctx, input.repo);
  const perPage = Math.min(input.limit ?? 30, 100);
  if (!Number.isSafeInteger(perPage) || perPage < 1) bad(ctx, "The limit is 1 or more.");
  const page = input.cursor === undefined ? 1 : Number(input.cursor);
  if (!Number.isSafeInteger(page) || page < 1) bad(ctx, "That cursor is not one this list gave.");
  const j = await api(ctx, { path: `${t.path}/pulls/${n}/files`, auth: t.auth, query: { per_page: perPage, page } });
  const files = list(j.items).map(obj).map((f) => {
    const out: { path: string; status: string; additions: number; deletions: number; patch?: string } = {
      path: text(f.filename), status: text(f.status), additions: intOrUndef(f.additions) ?? 0, deletions: intOrUndef(f.deletions) ?? 0,
    };
    const patch = strOrUndef(f.patch);   // GitHub leaves it out for a binary or very large file
    if (patch) out.patch = patch;
    return out;
  });
  return { files, ...(files.length === perPage ? { next: String(page + 1) } : {}) };
}

export async function prDiff(ctx: GithubCtx, input: { repo: string; number: number }): Promise<{ diff: string }> {
  ensure(ctx);
  const n = numberOf(ctx, input.number);
  const t = await target(ctx, input.repo);
  const a = await raw(ctx, { path: `${t.path}/pulls/${n}`, auth: t.auth, accept: "application/vnd.github.v3.diff" });
  if (a.status >= 300) throw refusal(ctx, a.status, a.json);
  return { diff: a.text };
}

export async function prChecks(ctx: GithubCtx, input: { repo: string; number: number }) {
  ensure(ctx);
  const { pr, t } = await readPr(ctx, input.repo, input.number);
  const runs = await runsOf(ctx, t, text(obj(pr.head).sha));
  return {
    state: checksState(runs),
    runs: runs.map((r) => {
      const out: { name: string; status: string; conclusion?: string; url?: string } = { name: text(r.name), status: text(r.status) };
      const conclusion = strOrUndef(r.conclusion);
      if (conclusion) out.conclusion = conclusion;
      const url = strOrUndef(r.html_url);
      if (url) out.url = url;
      return out;
    }),
  };
}

// ---- pull requests: writes

function nonEmpty(ctx: GithubCtx, v: unknown, what: string, max: number): string {
  if (typeof v !== "string" || v.trim() === "" || v.length > max) bad(ctx, `${what} is 1 to ${max} characters.`);
  return v;
}

function names(ctx: GithubCtx, v: unknown, what: string): string[] {
  if (!Array.isArray(v) || v.length > 100 || v.some((x) => typeof x !== "string" || x === "" || x.length > 100)) bad(ctx, `${what} is a list of names.`);
  return v as string[];
}

export async function prCreate(ctx: GithubCtx, input: { repo: string; head: string; base: string; title: string; body?: string; draft?: boolean }): Promise<{ pullRequest: PrOut }> {
  ensure(ctx);
  repoPath(ctx, input.repo);
  const body: Json = { head: nonEmpty(ctx, input.head, "The head branch", 255), base: nonEmpty(ctx, input.base, "The base branch", 255), title: nonEmpty(ctx, input.title, "The title", 256) };
  if (input.body !== undefined) body.body = text(input.body);
  if (input.draft !== undefined) {
    if (typeof input.draft !== "boolean") bad(ctx, "Draft is true or false.");
    body.draft = input.draft;
  }
  const t = await target(ctx, input.repo);
  const pr = await api(ctx, { method: "POST", path: `${t.path}/pulls`, auth: t.auth, body });
  return { pullRequest: mapPr(pr, t.repo, "none") };
}

export async function prUpdate(
  ctx: GithubCtx, input: { repo: string; number: number; title?: string; body?: string; labels?: string[]; assignees?: string[]; base?: string },
): Promise<{ pullRequest: PrOut }> {
  ensure(ctx);
  const n = numberOf(ctx, input.number);
  repoPath(ctx, input.repo);
  const pull: Json = {};
  if (input.title !== undefined) pull.title = nonEmpty(ctx, input.title, "The title", 256);
  if (input.body !== undefined) pull.body = text(input.body);
  if (input.base !== undefined) pull.base = nonEmpty(ctx, input.base, "The base branch", 255);
  const issue: Json = {};
  if (input.labels !== undefined) issue.labels = names(ctx, input.labels, "Labels");
  if (input.assignees !== undefined) issue.assignees = names(ctx, input.assignees, "Assignees");
  if (!Object.keys(pull).length && !Object.keys(issue).length) bad(ctx, "Give something to change.");
  const t = await target(ctx, input.repo);
  if (Object.keys(pull).length) await api(ctx, { method: "PATCH", path: `${t.path}/pulls/${n}`, auth: t.auth, body: pull });
  if (Object.keys(issue).length) await api(ctx, { method: "PATCH", path: `${t.path}/issues/${n}`, auth: t.auth, body: issue });
  return prGet(ctx, { repo: input.repo, number: n });
}

export async function prComment(ctx: GithubCtx, input: { repo: string; number: number; body: string }): Promise<{ commentId: number }> {
  ensure(ctx);
  const n = numberOf(ctx, input.number);
  const body = nonEmpty(ctx, input.body, "The comment", 65_536);
  const t = await target(ctx, input.repo);
  const c = await api(ctx, { method: "POST", path: `${t.path}/issues/${n}/comments`, auth: t.auth, body: { body } });
  return { commentId: commentId(ctx, c) };
}

function commentId(ctx: GithubCtx, c: Json): number {
  const id = intOrUndef(c.id);
  if (id === undefined) throw fail("provider.bad_response", ctx.trace.traceId, { message: "GitHub answered a comment with no id." });
  return id;
}

export async function prRequestReview(ctx: GithubCtx, input: { repo: string; number: number; reviewers: string[] }): Promise<{ requested: boolean }> {
  ensure(ctx);
  const n = numberOf(ctx, input.number);
  const reviewers = names(ctx, input.reviewers, "Reviewers");
  if (!reviewers.length) bad(ctx, "Name at least one reviewer.");
  const t = await target(ctx, input.repo);
  await api(ctx, { method: "POST", path: `${t.path}/pulls/${n}/requested_reviewers`, auth: t.auth, body: { reviewers } });
  return { requested: true };
}

export async function prMerge(ctx: GithubCtx, input: { repo: string; number: number; method: "merge" | "squash" | "rebase" }): Promise<{ merged: boolean; sha?: string }> {
  ensure(ctx);
  const n = numberOf(ctx, input.number);
  if (input.method !== "merge" && input.method !== "squash" && input.method !== "rebase") bad(ctx, "The method is merge, squash or rebase.");
  const t = await target(ctx, input.repo);
  const j = await api(ctx, { method: "PUT", path: `${t.path}/pulls/${n}/merge`, auth: t.auth, body: { merge_method: input.method } });
  const sha = strOrUndef(j.sha);
  return { merged: j.merged === true, ...(sha ? { sha } : {}) };
}

export async function prClose(ctx: GithubCtx, input: { repo: string; number: number }): Promise<{ closed: boolean }> {
  ensure(ctx);
  const n = numberOf(ctx, input.number);
  const t = await target(ctx, input.repo);
  const j = await api(ctx, { method: "PATCH", path: `${t.path}/pulls/${n}`, auth: t.auth, body: { state: "closed" } });
  return { closed: text(j.state) === "closed" };
}

/** Ask GitHub to run the failed checks again: one request per check suite that has a failed run. */
export async function prRerunChecks(ctx: GithubCtx, input: { repo: string; number: number }): Promise<{ requested: boolean }> {
  ensure(ctx);
  const { pr, t } = await readPr(ctx, input.repo, input.number);
  const runs = await runsOf(ctx, t, text(obj(pr.head).sha));
  const suites = new Set<number>();
  for (const r of runs) {
    const id = intOrUndef(obj(r.check_suite).id);
    if (FAILED.has(text(r.conclusion)) && id !== undefined) suites.add(id);
  }
  for (const id of suites) await api(ctx, { method: "POST", path: `${t.path}/check-suites/${id}/rerequest`, auth: t.auth });
  return { requested: suites.size > 0 };
}

// ---- issues

export async function issueGet(ctx: GithubCtx, input: { repo: string; number: number }): Promise<{ issue: IssueOut }> {
  ensure(ctx);
  const n = numberOf(ctx, input.number);
  const t = await target(ctx, input.repo);
  const i = await api(ctx, { path: `${t.path}/issues/${n}`, auth: t.auth });
  if (i.pull_request !== undefined) throw fail("validation.not_found", ctx.trace.traceId, { message: "That number is a pull request, not an issue." });
  return { issue: mapIssue(i, t.repo) };
}

export async function issueCreate(
  ctx: GithubCtx, input: { repo: string; title: string; body?: string; labels?: string[]; assignees?: string[] },
): Promise<{ issue: IssueOut }> {
  ensure(ctx);
  repoPath(ctx, input.repo);
  const body: Json = { title: nonEmpty(ctx, input.title, "The title", 256) };
  if (input.body !== undefined) body.body = text(input.body);
  if (input.labels !== undefined) body.labels = names(ctx, input.labels, "Labels");
  if (input.assignees !== undefined) body.assignees = names(ctx, input.assignees, "Assignees");
  const t = await target(ctx, input.repo);
  return { issue: mapIssue(await api(ctx, { method: "POST", path: `${t.path}/issues`, auth: t.auth, body }), t.repo) };
}

export async function issueUpdate(
  ctx: GithubCtx, input: { repo: string; number: number; title?: string; body?: string; labels?: string[]; assignees?: string[] },
): Promise<{ issue: IssueOut }> {
  ensure(ctx);
  const n = numberOf(ctx, input.number);
  repoPath(ctx, input.repo);
  const body: Json = {};
  if (input.title !== undefined) body.title = nonEmpty(ctx, input.title, "The title", 256);
  if (input.body !== undefined) body.body = text(input.body);
  if (input.labels !== undefined) body.labels = names(ctx, input.labels, "Labels");
  if (input.assignees !== undefined) body.assignees = names(ctx, input.assignees, "Assignees");
  if (!Object.keys(body).length) bad(ctx, "Give something to change.");
  const t = await target(ctx, input.repo);
  return { issue: mapIssue(await api(ctx, { method: "PATCH", path: `${t.path}/issues/${n}`, auth: t.auth, body }), t.repo) };
}

export async function issueComment(ctx: GithubCtx, input: { repo: string; number: number; body: string }): Promise<{ commentId: number }> {
  ensure(ctx);
  const n = numberOf(ctx, input.number);
  const body = nonEmpty(ctx, input.body, "The comment", 65_536);
  const t = await target(ctx, input.repo);
  const c = await api(ctx, { method: "POST", path: `${t.path}/issues/${n}/comments`, auth: t.auth, body: { body } });
  return { commentId: commentId(ctx, c) };
}

export async function issueClose(ctx: GithubCtx, input: { repo: string; number: number }): Promise<{ closed: boolean }> {
  ensure(ctx);
  const n = numberOf(ctx, input.number);
  const t = await target(ctx, input.repo);
  const j = await api(ctx, { method: "PATCH", path: `${t.path}/issues/${n}`, auth: t.auth, body: { state: "closed" } });
  return { closed: text(j.state) === "closed" };
}

// ---- work for agents

async function readRecord(ctx: GithubCtx, type: "pull_request" | "issue", recordId: string): Promise<Json> {
  const res = obj(await ctx.call("records.get", { type, recordId }));
  const record = obj(res.record);
  if (!text(record.id)) throw fail("validation.not_found", ctx.trace.traceId, { message: `There is no such ${type === "issue" ? "issue" : "pull request"} record.` });
  return obj(record.fields);
}

async function makeTask(ctx: GithubCtx, a: { title: string; why: string; summary: string; agentId: string; recordId: string; key: string }): Promise<string> {
  const res = obj(await ctx.call("tasks.create", {
    kind: "work", title: a.title, why: a.why, summary: a.summary, assigned: { kind: "agent", id: a.agentId }, recordId: a.recordId, idempotencyKey: a.key,
  }));
  const id = text(obj(res.task).id);
  if (!id) throw fail("provider.bad_response", ctx.trace.traceId, { message: "The task module answered without a task." });
  return id;
}

export async function prAskAuthorFix(ctx: GithubCtx, input: { recordId: string; checkName?: string; idempotencyKey?: string }): Promise<{ taskId: string; attempt: number }> {
  ensure(ctx);
  if (typeof input.recordId !== "string" || !/^rec_[a-z0-9]+$/.test(input.recordId)) bad(ctx, "That is not a record id.");
  if (input.checkName !== undefined && (typeof input.checkName !== "string" || input.checkName === "" || input.checkName.length > 200)) bad(ctx, "A check name is 1 to 200 characters.");
  const f = await readRecord(ctx, "pull_request", input.recordId);
  const repo = text(f.repo);
  const number = intOrUndef(f.number);
  const agent = text(f.author_agent);
  if (!repo || number === undefined) refuse(ctx, "This record is not a synced pull request.");
  if (text(f.state) !== "open") refuse(ctx, "Only an open pull request can be sent back to its author.");
  if (!/^agt_[a-z0-9]+$/.test(agent)) refuse(ctx, "This pull request has no author agent to ask. Assign the work to an agent instead.");
  const key = `${repo}#${number}`;
  const row = first(ctx.db.all(`SELECT * FROM github_fix WHERE "fixKey" = ?`, key));
  const rounds = num(row, "attempts");
  if (rounds >= MAX_FIX_ROUNDS) refuse(ctx, `The author agent has already been asked ${MAX_FIX_ROUNDS} times for this pull request. A person needs to look at it.`);
  const attempt = rounds + 1;
  const check = input.checkName ?? "the failing checks";
  const taskId = await makeTask(ctx, {
    title: `Fix ${check} on ${repo}#${number}`, why: `A check on this pull request is failing. This is round ${attempt} of ${MAX_FIX_ROUNDS}.`,
    summary: text(f.title) || `${repo}#${number}`, agentId: agent, recordId: input.recordId, key: `ghfix-${repo}-${number}-${attempt}`,
  });
  if (row) ctx.db.run(`UPDATE github_fix SET attempts = ?, "updatedAt" = ? WHERE "fixKey" = ?`, attempt, ctx.now(), key);
  else ctx.db.run(`INSERT INTO github_fix ("fixKey", "attempts", "updatedAt") VALUES (?, ?, ?)`, key, attempt, ctx.now());
  ctx.emit("github.fix_requested", `record/${input.recordId}`, { recordId: input.recordId, taskId, attempt });
  return { taskId, attempt };
}

export async function issueAssignAgent(ctx: GithubCtx, input: { recordId: string; agentId: string; idempotencyKey?: string }): Promise<{ taskId: string }> {
  ensure(ctx);
  if (typeof input.recordId !== "string" || !/^rec_[a-z0-9]+$/.test(input.recordId)) bad(ctx, "That is not a record id.");
  if (typeof input.agentId !== "string" || !/^agt_[a-z0-9]+$/.test(input.agentId)) bad(ctx, "That is not an agent id.");
  const f = await readRecord(ctx, "issue", input.recordId);
  const repo = text(f.repo);
  const number = intOrUndef(f.number);
  if (!repo || number === undefined) refuse(ctx, "This record is not a synced issue.");
  if (text(f.state) === "closed") refuse(ctx, "This issue is closed.");
  const body = text(f.body);
  const taskId = await makeTask(ctx, {
    title: `Resolve ${repo}#${number}: ${text(f.title) || "issue"}`, why: "An issue was handed to this agent. Its result is a changeset linked to the issue.",
    summary: body.length > 500 ? `${body.slice(0, 497)}...` : body || text(f.title) || `${repo}#${number}`, agentId: input.agentId, recordId: input.recordId,
    key: `ghassign-${input.recordId}-${input.agentId}`,
  });
  try {
    await ctx.call("records.update", { type: "issue", recordId: input.recordId, patch: { assigned_task: taskId } });
  } catch (e) {
    ctx.log.warn("github: could not note the task on the issue record", { code: codeOf(e) });   // the task exists and is linked by recordId; the field is a convenience
  }
  ctx.emit("github.issue_assigned", `record/${input.recordId}`, { recordId: input.recordId, taskId, agentId: input.agentId });
  return { taskId };
}
