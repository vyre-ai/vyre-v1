// The crew (DESIGN-crew.md, steps 1 and 2): a project's repository on this computer, and teammate jobs. A job is a teammate agent working in its own copy of that repository, on its own branch, in its own thread
// under the lead's chat. Nothing new is made for it: the thread is a helper thread, the teammate is a project teammate, the work folder is the engine's per-thread folder with a clone in it (../crew-git.ts).
import { engineHost } from "../runtime.ts";
import { GitError, branchFacts, cleanBranch, commitLeftovers, git, initLocalRepo, landBranch, prepareClone, pushBase, repoHead } from "../crew-git.ts";
import { ensure, actorOf, mintEngineId, raise } from "../projections.ts";
import { workFolder } from "../sandbox.ts";
import { GUIDE_FILES } from "../../../lib/memory-guide.ts";
import fs from "node:fs";
import path from "node:path";
import type { EngineCtx } from "../projections.ts";
import { agentDisplay } from "../agent-names.ts";

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);

export interface CrewJob {
  jobId: string; threadId: string; leadThreadId: string; projectId?: string; agentId: string; name?: string; title: string; branch: string; base: string;
  state: "working" | "waiting" | "paused" | "lost" | "done" | "failed" | "stopped" | "merged"; startedAt: number; endedAt?: number; result?: Record<string, unknown>;
}

export function jobOut(r: Row, name?: string): CrewJob {
  let result: Record<string, unknown> | undefined;
  try { const j = r["result_json"] ? JSON.parse(String(r["result_json"])) : undefined; if (j && typeof j === "object") result = j as Record<string, unknown>; } catch { /* a result that is not JSON is no result */ }
  return {
    jobId: str(r["job_id"]), threadId: str(r["thread_id"]), leadThreadId: str(r["lead_thread_id"]), ...(str(r["project_id"]) !== "" ? { projectId: str(r["project_id"]) } : {}), agentId: str(r["agent_id"]), ...(name ? { name } : {}),
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

/** The repository of a chat that has its own work folder (a crew started in a chat with no project). */
export async function chatRepoGet(ctx: EngineCtx, input: { threadId: string }) {
  ensure(ctx.db);
  const r = repoRow(ctx, input.threadId);
  if (!r) return { repo: null };
  try { const head = await repoHead(r.path); return { repo: { threadId: input.threadId, path: r.path, baseBranch: r.base, branch: head.branch } }; } catch { return { repo: { threadId: input.threadId, path: r.path, baseBranch: r.base, branch: "" } }; }
}

/** The teammate's folder, made on the first call and left alone after. `dataDir` is the Space's; `asker` and `agentId` name the folder (it is per person, thread and agent). */
export async function ensureWorkspace(dataDir: string, asker: string, threadId: string, agentId: string, w: { repo: string; base: string; branch: string; name: string }): Promise<{ dir: string; created: boolean }> {
  const dir = workFolder(dataDir, asker, threadId, agentId);
  const made = await prepareClone({ repo: w.repo, dest: dir, branch: w.branch, base: w.base, ident: { name: w.name, email: `${slug(w.name)}@vyre.invalid` } });
  // the memory guide the engine writes beside the code is not part of the work: it stays out of what the teammate commits
  if (made.created) {
    const file = path.join(dir, ".git", "info", "exclude");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${GUIDE_FILES.map((f) => `/${f}`).join("\n")}\n`);
  }
  return { dir, created: made.created };
}

/** Every worker that outlives a turn is a task: the one the caller names, else a new one in its name. The worker note keeps the baton from starting a second turn on it. */
async function taskOfJob(ctx: EngineCtx, input: { taskId?: string; threadId: string; teammateId: string; title: string; brief: string }, n: number): Promise<string | undefined> {
  if (input.taskId) {
    await ctx.call("tasks.working_notes.set", { taskId: input.taskId, key: "worker.kind", value: "crew" }).catch((e: unknown) => ctx.log.warn("a crew task could not be marked", { taskId: input.taskId, error: e instanceof Error ? e.message : "error" }));
    return input.taskId;
  }
  try {
    const made = (await ctx.call("tasks.create", {
      title: input.title, assigned: { kind: "agent", id: input.teammateId }, source: { kind: "chat", id: input.threadId }, notes: { brief: input.brief, "worker.kind": "crew" }, idempotencyKey: `crew-task:${input.threadId}:${input.teammateId}:${n}`,
    })) as { task?: { id?: string } };
    return made.task?.id;
  } catch (e) { ctx.log.warn("a crew job could not get its task", { error: e instanceof Error ? e.message : "error" }); return undefined; }
}

/** The task knows where its work happens: the thread, the job and the branch. Best effort: the job runs whether or not this lands. */
async function bindJob(ctx: EngineCtx, taskId: string, threadId: string, jobId: string, branch: string): Promise<void> {
  const soft = async (cap: string, i: unknown): Promise<void> => { await ctx.call(cap, i).catch((e: unknown) => ctx.log.warn("a crew job could not be bound to its task", { taskId, cap, error: e instanceof Error ? e.message : "error" })); };
  await soft("tasks.update", { taskId, workerThread: threadId });
  await soft("tasks.working_notes.set", { taskId, key: "crew.job", value: jobId });
  await soft("tasks.working_notes.set", { taskId, key: "crew.branch", value: branch });
}

/**
 * The project's repository when it has none: a git repository on this computer, in the folder of the project's files (the same working copy the Files git panel shows), `main` as its start.
 * A project without a Files folder gets one beside the Space's data. Remembered like a repository a person named, so every later teammate starts from the same place.
 */
const makingRepo = new Map<string, Promise<{ path: string; base: string }>>();
export function startRepo(ctx: EngineCtx, scope: string, chatThreadId?: string): Promise<{ path: string; base: string }> {
  // two teammates started at once make the repository once
  const key = `${ctx.space}:${scope}`;
  const running = makingRepo.get(key);
  if (running) return running;
  const p = makeRepo(ctx, scope, chatThreadId).finally(() => makingRepo.delete(key));
  makingRepo.set(key, p);
  return p;
}

/** The Files folder a chat's work lives in: the one the chat is filed under, else a new one in the asker's Personal folder, shown as the chat's work folder. Undefined when Files cannot give one. */
async function chatFolder(ctx: EngineCtx, threadId: string): Promise<string | undefined> {
  try {
    const t = (await ctx.call("threads.get", { threadId })) as { thread?: { folderId?: string; title?: string } };
    if (t.thread?.folderId) return t.thread.folderId;
    const found = (await ctx.call("files.folder.search", { q: "Personal", scope: "folders", limit: 20 })) as { folders?: Array<{ folderId: string; name: string; path: string }> };
    const name = `Chat ${threadId.slice(-6)}${t.thread?.title ? ` ${t.thread.title.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 40)}` : ""}`.trim();
    for (const root of (found.folders ?? []).filter((f) => f.path === "Personal")) {
      try {
        const made = (await ctx.call("files.folder.create", { parentId: root.folderId, name, idempotencyKey: `crew-folder:${threadId}` })) as { folder: { folderId: string } };
        await ctx.call("threads.set_folder", { threadId, folderId: made.folder.folderId }).catch(() => undefined);
        return made.folder.folderId;
      } catch { /* not this person's Personal folder */ }
    }
  } catch (e) { ctx.log.warn("the chat's work folder could not be made in Files", { threadId, error: e instanceof Error ? e.message : "error" }); }
  return undefined;
}

/**
 * The repository of a project or of a chat, when it has none: a git repository on this computer, in the folder of the files (the same working copy the Files git panel shows), `main` as its start.
 * A project's is its own Files folder; a chat's is its work folder, made the first time it is needed. Without a Files folder the repository sits beside the Space's data. Remembered like a
 * repository a person named, so every later teammate starts from the same place.
 */
async function makeRepo(ctx: EngineCtx, scope: string, chatThreadId?: string): Promise<{ path: string; base: string }> {
  const again = repoRow(ctx, scope);
  if (again) return again;
  const dataDir = engineHost()?.dataDir;
  if (!dataDir) raise(ctx, "validation.precondition_failed", "This computer has no folders for the crew.");
  let folderId = "";
  if (chatThreadId) folderId = (await chatFolder(ctx, chatThreadId)) ?? "";
  else {
    try { folderId = str(((await ctx.call("projects.get", { projectId: scope })) as { project?: { folderId?: string } }).project?.folderId); } catch (e) { ctx.log.warn("the project's folder could not be read for its repository", { projectId: scope, error: e instanceof Error ? e.message : "error" }); }
  }
  // the Files folder's working copy first (its files go into the first commit), when the person may start history on it; the engine makes the repository itself when not
  if (folderId) await ctx.call("git.init", { folderId }).catch(() => undefined);
  const dir = folderId ? path.join(dataDir, "trees", folderId) : path.join(dataDir, "crew-repos", scope);
  try {
    const made = await initLocalRepo(dir);
    ensure(ctx.db);
    ctx.db.run(
      "INSERT INTO engine_crew_repo (project_id, path, base_branch, set_by, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (project_id) DO UPDATE SET path = excluded.path, base_branch = excluded.base_branch, set_by = excluded.set_by, at = excluded.at",
      scope, dir, made.branch, actorOf(ctx), ctx.now(),
    );
    return { path: dir, base: made.branch };
  } catch (e) { return gitFailure(ctx, e); }
}

const MATE_NAMES = ["Ember", "Birch", "Cedar", "Dune", "Flint", "Heron", "Ivy", "Juniper", "Kestrel", "Lark", "Maple", "Nova"];

/** The project this chat belongs to, when it does. */
async function projectOfChat(ctx: EngineCtx, threadId: string): Promise<string | undefined> {
  try {
    const t = (await ctx.call("threads.get", { threadId })) as { thread?: { scopeType?: string; scopeId?: string } };
    return t.thread?.scopeType === "project" && t.thread.scopeId ? t.thread.scopeId : undefined;
  } catch { return undefined; }
}

/**
 * A teammate nobody made first: an agent that belongs to this chat (or to the chat's project, when it is in one) and not to the Agents page. It is the asker's, so it holds what the asker holds.
 * Names come from a short list; a name already taken in the Space gets the end of the chat's id.
 */
async function makeMate(ctx: EngineCtx, o: { threadId: string; projectId?: string; name?: string; brief: string; taken: number }): Promise<{ agentId: string; name: string }> {
  const base = (o.name?.trim() || MATE_NAMES[o.taken % MATE_NAMES.length]!).slice(0, 40);
  const role = o.brief.replace(/\s+/g, " ").slice(0, 200);
  for (const name of [base, `${base} ${o.threadId.slice(-4)}`]) {
    try {
      if (o.projectId) {
        const made = (await ctx.call("projects.teammates.create", { projectId: o.projectId, name, role: "member", brief: role, idempotencyKey: `crew-mate:${o.threadId}:${name}` })) as { teammate: { agentId: string; name: string } };
        return { agentId: made.teammate.agentId, name: made.teammate.name };
      }
      const made = (await ctx.call("agents.create", { name, role, computer: false, projectId: o.threadId, idempotencyKey: `crew-mate:${o.threadId}:${name}` })) as { agent: { agentId: string } };
      return { agentId: made.agent.agentId, name };
    } catch (e) {
      const code = (e as { error?: { code?: string } })?.error?.code;
      if (code !== "validation.duplicate") throw e;
    }
  }
  return raise(ctx, "validation.bad_input", "Give the teammate a name nobody else has.");
}

export async function start(ctx: EngineCtx, input: { threadId: string; projectId?: string; teammateId?: string; name?: string; title: string; brief: string; model?: string; provider?: string; effort?: string; taskId?: string }) {
  ensure(ctx.db);
  // any chat can start a crew: the repository is the project's when the chat is in one, else the chat's own folder on this computer
  const projectId = input.projectId ?? (await projectOfChat(ctx, input.threadId));
  const scope = projectId ?? input.threadId;
  const repo = repoRow(ctx, scope) ?? (await startRepo(ctx, scope, projectId === undefined ? input.threadId : undefined));
  const title = input.title.trim();
  const brief = input.brief.trim();
  if (title === "" || title.length > 120) raise(ctx, "validation.bad_input", "Give the job a title of up to 120 characters.");
  if (brief === "") raise(ctx, "validation.bad_input", "Tell the teammate what to do.");
  let mate: { agentId: string; name: string };
  const count = Number((ctx.db.all("SELECT COUNT(DISTINCT agent_id) AS n FROM engine_crew_job WHERE lead_thread_id = ?", input.threadId)[0] as Row | undefined)?.["n"] ?? 0);
  if (input.teammateId === undefined) mate = await makeMate(ctx, { threadId: input.threadId, ...(projectId ? { projectId } : {}), ...(input.name ? { name: input.name } : {}), brief: input.brief.trim(), taken: count });
  else if (projectId) {
    const team = (await ctx.call("projects.teammates.list", { projectId })) as { teammates: Array<{ agentId: string; name: string }> };
    const found = team.teammates.find((m) => m.agentId === input.teammateId);
    if (!found) return raise(ctx, "validation.bad_input", "That agent is not a teammate of this project.");
    mate = found;
  } else {
    const got = (await ctx.call("agents.get", { agentId: input.teammateId })) as { agent?: { name?: string; teammateOf?: string } };
    if (got.agent?.teammateOf !== input.threadId) return raise(ctx, "validation.bad_input", "That agent is not a teammate of this chat.");
    mate = { agentId: input.teammateId, name: got.agent.name ?? "Teammate" };
  }
  const n = Number((ctx.db.all("SELECT COUNT(*) AS n FROM engine_crew_job WHERE project_id = ? AND agent_id = ?", projectId ?? "", mate.agentId)[0] as Row | undefined)?.["n"] ?? 0) + 1;
  const branch = cleanBranch(`crew/${slug(mate.name)}-${n}`);
  const asker = actorOf(ctx);
  const taskId = await taskOfJob(ctx, { ...input, title, brief, teammateId: mate.agentId }, n);
  const started = (await ctx.call("chat.helper.start", {
    threadId: input.threadId, title, instruction: brief, agentId: mate.agentId, crew: true,
    ...(input.model ? { model: input.model } : {}), ...(input.provider ? { provider: input.provider } : {}), ...(input.effort ? { effort: input.effort } : {}),
  })) as { helper: { threadId: string } };
  const jobId = mintEngineId("crw", ctx.now());
  ctx.db.run(
    "INSERT INTO engine_crew_job (job_id, thread_id, lead_thread_id, project_id, agent_id, asker, title, branch, base_branch, repo_path, state, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'working', ?)",
    jobId, started.helper.threadId, input.threadId, projectId ?? "", mate.agentId, asker, title, branch, repo.base, repo.path, ctx.now(),
  );
  // made now so the folder exists before anything else looks at it; the session opener asks for the same thing before the first turn and finds it done
  const dataDir = engineHost()?.dataDir;
  if (dataDir) {
    try { await ensureWorkspace(dataDir, asker, started.helper.threadId, mate.agentId, { repo: repo.path, base: repo.base, branch, name: mate.name }); } catch (e) { ctx.log.warn("the teammate's repository copy could not be made at start", { jobId, error: e instanceof Error ? e.message : String(e) }); }
  }
  if (taskId) await bindJob(ctx, taskId, started.helper.threadId, jobId, branch);
  ctx.emit("crew.job_started", input.threadId, { jobId, threadId: started.helper.threadId, leadThreadId: input.threadId, ...(projectId ? { projectId } : {}), agentId: mate.agentId, branch });
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
    names.set(id, (await agentDisplay((cap, i) => ctx.call(cap, i), id)).name);
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
  const name = (await agentDisplay((cap, i) => ctx.call(cap, i), str(r["agent_id"]))).name;
  return { workspace: { jobId: str(r["job_id"]), repo: str(r["repo_path"]), base: str(r["base_branch"]), branch: str(r["branch"]), name } };
}

/**
 * Brings a finished job's state in line with the repository: merged when its branch is part of the base (by the Merge button, the lead, a person in a terminal, anything), pushed when the remote's base has it.
 * A job still working is left alone. Answers the row as it stands after. Called when a card renders, when a person presses Merge or Push, and by the periodic sweep.
 */
export async function reconcile(ctx: EngineCtx, r: Row): Promise<Row> {
  const state = str(r["state"]);
  if (state === "working" || state === "waiting" || state === "paused") return r;
  const prior = jobOut(r).result ?? {};
  if (state === "merged" && prior["pushed"]) return r;
  const dataDir = engineHost()?.dataDir;
  if (!dataDir) return r;
  let facts: Awaited<ReturnType<typeof branchFacts>> = null;
  try { facts = await branchFacts({ repo: str(r["repo_path"]), clone: workFolder(dataDir, str(r["asker"]), str(r["thread_id"]), str(r["agent_id"])), branch: str(r["branch"]), base: str(r["base_branch"]) }); } catch { return r; }
  if (!facts || facts.ahead === 0 || !facts.merged) return r;
  const id = str(r["job_id"]);
  const event = { jobId: id, threadId: str(r["thread_id"]), leadThreadId: str(r["lead_thread_id"]), branch: str(r["branch"]) };
  if (state !== "merged") {
    ctx.db.run("UPDATE engine_crew_job SET state = 'merged', ended_at = COALESCE(ended_at, ?) WHERE job_id = ?", ctx.now(), id);
    ctx.emit("crew.job_merged", str(r["lead_thread_id"]), { ...event, landed: true });
  }
  if (facts.pushed && !prior["pushed"]) {
    ctx.db.run("UPDATE engine_crew_job SET result_json = ? WHERE job_id = ?", JSON.stringify({ ...prior, pushed: { at: ctx.now() } }), id);
    ctx.emit("crew.job_pushed", str(r["lead_thread_id"]), { ...event, branch: str(r["base_branch"]) });
  }
  return jobRow(ctx, id);
}

/** The periodic sweep: every job that is finished and not yet known as merged and pushed is checked against its repository. */
export async function reconcileAll(ctx: EngineCtx): Promise<string[]> {
  ensure(ctx.db);
  const rows = ctx.db.all("SELECT * FROM engine_crew_job WHERE state IN ('done', 'failed', 'stopped', 'lost', 'merged') ORDER BY started_at DESC LIMIT 50") as Row[];
  const changed: string[] = [];
  for (const r of rows) { const after = await reconcile(ctx, r); if (str(after["state"]) !== str(r["state"]) || str(after["result_json"]) !== str(r["result_json"])) changed.push(str(r["job_id"])); }
  return changed;
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
  ctx.db.run("UPDATE engine_crew_job SET state = 'stopped', ended_at = ? WHERE job_id = ? AND state IN ('working', 'waiting', 'paused', 'lost')", ctx.now(), input.jobId);
  return { job: jobOut(jobRow(ctx, input.jobId)) };
}

export async function merge(ctx: EngineCtx, input: { jobId: string }) {
  ensure(ctx.db);
  const r = await reconcile(ctx, jobRow(ctx, input.jobId));
  // a stale Merge on work that is already in the base is not an error: it says so
  if (str(r["state"]) === "merged") return { job: jobOut(r), landed: true, ref: str(r["branch"]), note: "Already merged." };
  const dataDir = engineHost()?.dataDir;
  if (!dataDir) raise(ctx, "validation.precondition_failed", "This computer has no work folders for the crew.");
  const dir = workFolder(dataDir, str(r["asker"]), str(r["thread_id"]), str(r["agent_id"]));
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
  const r = await reconcile(ctx, jobRow(ctx, input.jobId));
  if (str(r["state"]) === "merged" && jobOut(r).result?.["pushed"]) return { job: jobOut(r), pushed: true, note: "Already on the remote." };
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
