// The crew (DESIGN-crew.md, steps 1 and 2): a project's repository on this computer, and teammate jobs. A job is a teammate agent working in its own copy of that repository, on its own branch, in its own thread
// under the lead's chat. Nothing new is made for it: the thread is a helper thread, the teammate is a project teammate, the work folder is the engine's per-thread folder with a clone in it (../crew-git.ts).
import { engineHost } from "../runtime.ts";
import { GitError, cleanBranch, commitLeftovers, git, landBranch, prepareClone, pushBase, repoHead } from "../crew-git.ts";
import { ensure, actorOf, mintEngineId, raise } from "../projections.ts";
import { workFolder } from "../sandbox.ts";
import { GUIDE_FILES } from "../../../lib/memory-guide.ts";
import fs from "node:fs";
import path from "node:path";
import type { EngineCtx } from "../projections.ts";

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);

export interface CrewJob {
  jobId: string; threadId: string; leadThreadId: string; projectId: string; agentId: string; name?: string; title: string; branch: string; base: string;
  state: "working" | "waiting" | "done" | "failed" | "stopped" | "merged"; startedAt: number; endedAt?: number; result?: Record<string, unknown>;
}

export function jobOut(r: Row, name?: string): CrewJob {
  let result: Record<string, unknown> | undefined;
  try { const j = r["result_json"] ? JSON.parse(String(r["result_json"])) : undefined; if (j && typeof j === "object") result = j as Record<string, unknown>; } catch { /* a result that is not JSON is no result */ }
  return {
    jobId: str(r["job_id"]), threadId: str(r["thread_id"]), leadThreadId: str(r["lead_thread_id"]), projectId: str(r["project_id"]), agentId: str(r["agent_id"]), ...(name ? { name } : {}),
    title: str(r["title"]), branch: str(r["branch"]), base: str(r["base_branch"]), state: str(r["state"]) as CrewJob["state"], startedAt: num(r["started_at"]),
    ...(r["ended_at"] !== null && r["ended_at"] !== undefined ? { endedAt: num(r["ended_at"]) } : {}), ...(result ? { result } : {}),
  };
}

const slug = (s: string): string => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "teammate";

function gitFailure(ctx: EngineCtx, e: unknown): never {
  if (e instanceof GitError) return raise(ctx, e.code === "validation.bad_input" ? "validation.bad_input" : "internal.unavailable", e.message);
  throw e;
}

export function repoRow(ctx: EngineCtx, projectId: string): { path: string; base: string } | null {
  const r = ctx.db.all("SELECT path, base_branch FROM engine_crew_repo WHERE project_id = ?", projectId)[0] as Row | undefined;
  return r ? { path: str(r["path"]), base: str(r["base_branch"]) } : null;
}

export async function repoSet(ctx: EngineCtx, input: { projectId: string; path: string; baseBranch?: string }) {
  ensure(ctx.db);
  try {
    const head = await repoHead(input.path);
    const base = cleanBranch(input.baseBranch ?? head.branch);
    const has = await git(["rev-parse", "--verify", "--quiet", `refs/heads/${base}`], input.path);
    if (has.code !== 0) raise(ctx, "validation.bad_input", `The repository has no branch called ${base}.`);
    ctx.db.run(
      "INSERT INTO engine_crew_repo (project_id, path, base_branch, set_by, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (project_id) DO UPDATE SET path = excluded.path, base_branch = excluded.base_branch, set_by = excluded.set_by, at = excluded.at",
      input.projectId, input.path, base, actorOf(ctx), ctx.now(),
    );
    return { repo: { projectId: input.projectId, path: input.path, baseBranch: base, branch: head.branch } };
  } catch (e) { return gitFailure(ctx, e); }
}

export async function repoGet(ctx: EngineCtx, input: { projectId: string }) {
  ensure(ctx.db);
  const r = repoRow(ctx, input.projectId);
  if (!r) return { repo: null };
  try { const head = await repoHead(r.path); return { repo: { projectId: input.projectId, path: r.path, baseBranch: r.base, branch: head.branch } }; } catch { return { repo: { projectId: input.projectId, path: r.path, baseBranch: r.base, branch: "" } }; }
}

/** The teammate's folder, made on the first call and left alone after. `dataDir` is the Space's; `asker` names the folder (it is per person and thread). */
export async function ensureWorkspace(dataDir: string, asker: string, threadId: string, w: { repo: string; base: string; branch: string; name: string }): Promise<{ dir: string; created: boolean }> {
  const dir = workFolder(dataDir, asker, threadId);
  const made = await prepareClone({ repo: w.repo, dest: dir, branch: w.branch, base: w.base, ident: { name: w.name, email: `${slug(w.name)}@vyre.invalid` } });
  // the memory guide the engine writes beside the code is not part of the work: it stays out of what the teammate commits
  if (made.created) {
    const file = path.join(dir, ".git", "info", "exclude");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${GUIDE_FILES.map((f) => `/${f}`).join("\n")}\n`);
  }
  return { dir, created: made.created };
}

export async function start(ctx: EngineCtx, input: { threadId: string; projectId: string; teammateId: string; title: string; brief: string; model?: string; provider?: string; effort?: string }) {
  ensure(ctx.db);
  const repo = repoRow(ctx, input.projectId);
  if (!repo) raise(ctx, "validation.precondition_failed", "Say where the project's repository is first.");
  const title = input.title.trim();
  const brief = input.brief.trim();
  if (title === "" || title.length > 120) raise(ctx, "validation.bad_input", "Give the job a title of up to 120 characters.");
  if (brief === "") raise(ctx, "validation.bad_input", "Tell the teammate what to do.");
  const team = (await ctx.call("projects.teammates.list", { projectId: input.projectId })) as { teammates: Array<{ agentId: string; name: string }> };
  const mate = team.teammates.find((m) => m.agentId === input.teammateId);
  if (!mate) raise(ctx, "validation.bad_input", "That agent is not a teammate of this project.");
  const n = Number((ctx.db.all("SELECT COUNT(*) AS n FROM engine_crew_job WHERE project_id = ? AND agent_id = ?", input.projectId, mate.agentId)[0] as Row | undefined)?.["n"] ?? 0) + 1;
  const branch = cleanBranch(`crew/${slug(mate.name)}-${n}`);
  const asker = actorOf(ctx);
  const started = (await ctx.call("chat.helper.start", {
    threadId: input.threadId, title, instruction: brief, agentId: mate.agentId, crew: true,
    ...(input.model ? { model: input.model } : {}), ...(input.provider ? { provider: input.provider } : {}), ...(input.effort ? { effort: input.effort } : {}),
  })) as { helper: { threadId: string } };
  const jobId = mintEngineId("crw", ctx.now());
  ctx.db.run(
    "INSERT INTO engine_crew_job (job_id, thread_id, lead_thread_id, project_id, agent_id, asker, title, branch, base_branch, repo_path, state, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'working', ?)",
    jobId, started.helper.threadId, input.threadId, input.projectId, mate.agentId, asker, title, branch, repo.base, repo.path, ctx.now(),
  );
  // made now so the folder exists before anything else looks at it; the session opener asks for the same thing before the first turn and finds it done
  const dataDir = engineHost()?.dataDir;
  if (dataDir) {
    try { await ensureWorkspace(dataDir, asker, started.helper.threadId, { repo: repo.path, base: repo.base, branch, name: mate.name }); } catch (e) { ctx.log.warn("the teammate's repository copy could not be made at start", { jobId, error: e instanceof Error ? e.message : String(e) }); }
  }
  ctx.emit("crew.job_started", input.threadId, { jobId, threadId: started.helper.threadId, leadThreadId: input.threadId, projectId: input.projectId, agentId: mate.agentId, branch });
  const row = ctx.db.all("SELECT * FROM engine_crew_job WHERE job_id = ?", jobId)[0] as Row;
  return { job: jobOut(row, mate.name) };
}

export async function list(ctx: EngineCtx, input: { threadId: string }) {
  ensure(ctx.db);
  const rows = ctx.db.all("SELECT * FROM engine_crew_job WHERE lead_thread_id = ? ORDER BY started_at DESC, rowid DESC", input.threadId) as Row[];
  const names = new Map<string, string>();
  for (const r of rows) {
    const id = str(r["agent_id"]);
    if (names.has(id)) continue;
    try { const a = (await ctx.call("agents.get", { agentId: id })) as { agent?: { name?: string } }; if (a.agent?.name) names.set(id, a.agent.name); } catch { /* the id stands */ }
  }
  const waits = ctx.db.all("SELECT * FROM engine_crew_wait WHERE lead_thread_id = ? AND state = 'pending' ORDER BY started_at DESC, rowid DESC", input.threadId) as Row[];
  return { jobs: rows.map((r) => jobOut(r, names.get(str(r["agent_id"])))), waits: waits.map(waitOut) };
}

export function waitOut(r: Row) {
  return { waitId: str(r["wait_id"]), kind: "checks" as const, label: str(r["label"]), state: "pending" as const, done: num(r["done"]), total: num(r["total"]), startedAt: num(r["started_at"]) };
}

export async function wait(ctx: EngineCtx, input: { threadId: string; repo: string; number: number }) {
  ensure(ctx.db);
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(input.repo)) raise(ctx, "validation.bad_input", "Name the repository as owner/name.");
  const t = (await ctx.call("threads.get", { threadId: input.threadId })) as { thread: { agents: Array<{ agentId: string; mode: string }> } };
  const lead = t.thread.agents.find((a) => a.mode === "lead")?.agentId;
  if (!lead) raise(ctx, "validation.precondition_failed", "This chat has no lead to wake.");
  const waitId = mintEngineId("cwt", ctx.now());
  const label = `${input.repo}#${input.number}`;
  ctx.db.run("INSERT INTO engine_crew_wait (wait_id, lead_thread_id, agent_id, asker, kind, repo, number, label, state, started_at) VALUES (?, ?, ?, ?, 'checks', ?, ?, ?, 'pending', ?)", waitId, input.threadId, lead, actorOf(ctx), input.repo, input.number, label, ctx.now());
  return { wait: waitOut(ctx.db.all("SELECT * FROM engine_crew_wait WHERE wait_id = ?", waitId)[0] as Row) };
}

export async function workspace(ctx: EngineCtx, input: { threadId: string }) {
  ensure(ctx.db);
  const r = ctx.db.all("SELECT * FROM engine_crew_job WHERE thread_id = ?", input.threadId)[0] as Row | undefined;
  if (!r) return { workspace: null };
  let name = str(r["agent_id"]);
  try { const a = (await ctx.call("agents.get", { agentId: str(r["agent_id"]) })) as { agent?: { name?: string } }; if (a.agent?.name) name = a.agent.name; } catch { /* the id stands */ }
  return { workspace: { jobId: str(r["job_id"]), repo: str(r["repo_path"]), base: str(r["base_branch"]), branch: str(r["branch"]), name } };
}

function jobRow(ctx: EngineCtx, jobId: string): Row {
  const r = ctx.db.all("SELECT * FROM engine_crew_job WHERE job_id = ?", jobId)[0] as Row | undefined;
  if (!r) raise(ctx, "validation.not_found", "There is no such teammate job.");
  return r;
}

export async function message(ctx: EngineCtx, input: { jobId: string; body: string }) {
  ensure(ctx.db);
  const r = jobRow(ctx, input.jobId);
  const body = input.body.trim();
  if (body === "") raise(ctx, "validation.bad_input", "Write something to send.");
  await ctx.call("chat.post", { threadId: str(r["thread_id"]), body, mentions: [{ kind: "agent", id: str(r["agent_id"]) }], idempotencyKey: `crew-msg-${input.jobId}-${ctx.trace.traceId}` });
  return { sent: true };
}

export async function stop(ctx: EngineCtx, input: { jobId: string }) {
  ensure(ctx.db);
  const r = jobRow(ctx, input.jobId);
  await ctx.call("engine.stop_all", { threadId: str(r["thread_id"]) });
  ctx.db.run("UPDATE engine_crew_job SET state = 'stopped', ended_at = ? WHERE job_id = ? AND state IN ('working', 'waiting')", ctx.now(), input.jobId);
  return { job: jobOut(jobRow(ctx, input.jobId)) };
}

export async function merge(ctx: EngineCtx, input: { jobId: string }) {
  ensure(ctx.db);
  const r = jobRow(ctx, input.jobId);
  const dataDir = engineHost()?.dataDir;
  if (!dataDir) raise(ctx, "validation.precondition_failed", "This computer has no work folders for the crew.");
  const dir = workFolder(dataDir, str(r["asker"]), str(r["thread_id"]));
  try {
    await commitLeftovers(dir, `Work in progress by ${str(r["agent_id"])}`);
    const landed = await landBranch({ repo: str(r["repo_path"]), clone: dir, branch: str(r["branch"]), base: str(r["base_branch"]) });
    if (landed.landed) {
      ctx.db.run("UPDATE engine_crew_job SET state = 'merged', ended_at = COALESCE(ended_at, ?) WHERE job_id = ?", ctx.now(), input.jobId);
      ctx.emit("crew.job_merged", str(r["lead_thread_id"]), { jobId: input.jobId, threadId: str(r["thread_id"]), leadThreadId: str(r["lead_thread_id"]), branch: str(r["branch"]), landed: true });
    }
    return { job: jobOut(jobRow(ctx, input.jobId)), landed: landed.landed, ref: landed.ref, ...(landed.note ? { note: landed.note } : {}) };
  } catch (e) { return gitFailure(ctx, e); }
}

export async function push(ctx: EngineCtx, input: { jobId: string }) {
  ensure(ctx.db);
  const r = jobRow(ctx, input.jobId);
  if (str(r["state"]) !== "merged") raise(ctx, "validation.precondition_failed", "Merge the teammate's work first, then push.");
  try {
    const out = await pushBase({ repo: str(r["repo_path"]), base: str(r["base_branch"]) });
    if (out.pushed) {
      const prior = jobOut(r).result ?? {};
      ctx.db.run("UPDATE engine_crew_job SET result_json = ? WHERE job_id = ?", JSON.stringify({ ...prior, pushed: { at: ctx.now(), ...(out.remote ? { remote: out.remote } : {}) } }), input.jobId);
      ctx.emit("crew.job_pushed", str(r["lead_thread_id"]), { jobId: input.jobId, threadId: str(r["thread_id"]), leadThreadId: str(r["lead_thread_id"]), branch: str(r["base_branch"]) });
    }
    return { job: jobOut(jobRow(ctx, input.jobId)), pushed: out.pushed, ...(out.note ? { note: out.note } : {}) };
  } catch (e) { return gitFailure(ctx, e); }
}
