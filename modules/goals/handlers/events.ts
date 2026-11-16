// What the goals module reads from the event log: its tasks moving, turns in its chats (budget), turns parked on a person (waiting), mentions (folder access). Each is safe to read twice.
import {
  ENDED,
  LIVE,
  addTask,
  addThread,
  allGoals,
  dispatch,
  ensure,
  blockOf,
  blocksWhere,
  getGoal,
  goalOfTask,
  goalOfThread,
  openWake,
  note,
  queueWake,
  rootOf,
  saveGoal,
  setStatus,
  threadsOf,
} from "../projections.ts";
import type { Goal, GoalsCtx, Who } from "../projections.ts";
import { whoToken } from "../../../lib/words/time.ts";
import { failureClause, failureWhy } from "../../../lib/words/failure.ts";
import {
  BACKOFF_MS,
  MAX_TRIES,
  addWait,
  dropWait,
  ensureFolder,
  hold,
  holdsAtOnce,
  resumeBlock,
  setTaskState,
  spend,
  syncGrants,
  tick,
  tickFromTask,
  tryCall,
  unstick,
} from "./life.ts";

type Obj = Record<string, unknown>;
interface Ev {
  name: string;
  id?: string;
  payload: Obj;
}
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const REQUESTS = new Set(["approve", "answer", "unblock", "review"]);
const anyLive = (ctx: GoalsCtx): boolean => {
  ensure(ctx.db);
  return (
    ctx.db.all(
      "SELECT 1 AS x FROM goals_goal WHERE status IN ('planning', 'active', 'waiting', 'stuck', 'paused') LIMIT 1",
    ).length > 0
  );
};
interface TaskRow {
  id: string;
  kind: string;
  title: string;
  state: string;
  parentTaskId?: string;
  threadId?: string;
  key?: string;
  assigned?: Who;
  workingNotes?: Record<string, string>;
}

function finishGoal(ctx: GoalsCtx, g: Goal): void {
  dispatch(ctx, g);
  saveGoal(ctx, g);
}

/** A task of a goal, or a new one under its plan: keep its state, its thread, and what waits on whom. */
export async function onTask(ctx: GoalsCtx, ev: Ev): Promise<string[]> {
  const taskId = str(ev.payload["taskId"]);
  if (!taskId) return [];
  let known = goalOfTask(ctx.db, taskId);
  let task: TaskRow | undefined;
  const read = async (): Promise<TaskRow | undefined> =>
    (task ??= (await tryCall<{ task?: TaskRow }>(ctx, "tasks.get", { taskId }))?.task);
  // the root's children settled: all done, or one is blocked or asks
  if (ev.name === "task.children_settled") {
    const goalId = rootOf(ctx.db, taskId);
    const g = goalId ? getGoal(ctx.db, goalId) : undefined;
    if (!g || !LIVE.has(g.status)) return [];
    const reason = str(ev.payload["reason"]);
    queueWake(
      ctx,
      g,
      reason === "finished" ? "task_done" : reason === "blocked" ? "task_blocked" : "task_asked",
      reason === "finished" ? "Every task in the plan is done." : undefined,
      `settled:${taskId}:${reason}:${str(ev.payload["childId"])}`,
    );
    finishGoal(ctx, g);
    return [g.id];
  }
  if (!known) {
    if ((ev.name !== "task.created" && ev.name !== "task.updated") || !anyLive(ctx)) return [];
    const t = await read();
    if (!t?.parentTaskId) return [];
    const viaRoot = rootOf(ctx.db, t.parentTaskId);
    const viaPlan = goalOfTask(ctx.db, t.parentTaskId);
    const goalId = viaRoot ?? (viaPlan?.role === "plan" ? viaPlan.goalId : undefined);
    if (!goalId) return [];
    const g = getGoal(ctx.db, goalId);
    if (!g || ENDED.has(g.status)) return [];
    if (REQUESTS.has(t.kind)) {
      addTask(ctx.db, g.id, t.id, "ask");
      addWait(ctx, g, { id: t.id, kind: t.kind, title: t.title, ...(t.assigned ? { assigned: t.assigned } : {}) });
    } else if (viaRoot && t.kind === "work") {
      addTask(ctx.db, g.id, t.id, "plan");
      setTaskState(ctx, t.id, t.state, t.title, t.key);
      note(ctx, g.id, "plan", `Planned ${t.key ? `${t.key} ` : ""}${t.title}.`, t.id);
      if (g.status === "planning") setStatus(ctx, g, "active");
    } else return [];
    known = goalOfTask(ctx.db, t.id);
    finishGoal(ctx, g);
  }
  if (!known) return [];
  const g = getGoal(ctx.db, known.goalId);
  if (!g) return [];
  if (ev.name === "task.created" || ev.name === "task.updated") {
    const t = await read();
    if (t?.threadId && known.role === "plan" && addThread(ctx.db, g.id, t.threadId, "task")) await syncGrants(ctx, g);
    if (t && known.role === "plan") setTaskState(ctx, t.id, t.state, t.title, t.key);
    finishGoal(ctx, g);
    return [g.id];
  }
  const to =
    ev.name === "task.transitioned" ? str(ev.payload["to"]) : ev.name === "task.completed" ? "done" : "canceled";
  const closed = to === "done" || to === "canceled";
  if (known.role === "plan") {
    setTaskState(ctx, taskId, to);
    if (to === "done" && ev.name !== "task.transitioned") {
      const t = await read();
      note(ctx, g.id, "task", `${t?.key ? `${t.key} ` : ""}${t?.title ?? taskId} is done.`, taskId);
      await keepOutputs(ctx, g, taskId);
      await tickFromTask(ctx, g, taskId);
      if (LIVE.has(g.status)) queueWake(ctx, g, "task_done", `Done: ${t?.title ?? taskId}`, `task:${taskId}:done`);
    }
  } else if (closed && (known.role === "ask" || known.role === "notice")) {
    const answered = dropWait(ctx, g, taskId, to === "done" ? "Answered" : "Withdrawn");
    if (known.role === "notice" && taskId === g.stuckTaskId && to === "done" && g.status === "stuck")
      await unstick(ctx, g, `${whoToken(g.owner)} answered the question. Active again.`);
    // the owner pressing Done on the "check-ins paused" item says they did the thing: ask the held wake-up again now
    if (known.role === "notice" && to === "done" && blockOf(ctx.db, g.id)?.taskId === taskId) resumeBlock(ctx, g);
    else if ((answered || known.role === "notice") && LIVE.has(g.status) && to === "done")
      queueWake(ctx, g, "answered", undefined, `ans:${taskId}`);
  }
  finishGoal(ctx, g);
  return [g.id];
}

/** Every turn in a goal's chats that ran counts against its budget: a turn that failed did no work and costs nothing. */
export async function onTurn(ctx: GoalsCtx, ev: Ev): Promise<string[]> {
  const threadId = str(ev.payload["threadId"]);
  const goalId = threadId ? goalOfThread(ctx.db, threadId) : undefined;
  const g = goalId ? getGoal(ctx.db, goalId) : undefined;
  if (!g) return [];
  // one count per turn, however often the event is read
  if (
    ctx.db.run(
      "INSERT OR IGNORE INTO goals_step (goal_id, step_id, title, state, by, at) VALUES (?, ?, NULL, 'done', 'turn', ?)",
      g.id,
      `turn:${str(ev.payload["turnId"])}`,
      ctx.now(),
    ).changes === 0
  )
    return [];
  if (ev.name === "turn.completed") await spend(ctx, g, Number(ev.payload["costMicros"] ?? 0), 1);
  // the lead's turn ended and the wake-up it was on got no check-in: a passing trouble is tried again, a cause only the person can fix waits and says so, never silent
  if (str(ev.payload["agentId"]) === g.leadAgentId && (LIVE.has(g.status) || ENDED.has(g.status))) {
    const at = ev.payload["resetsAt"];
    await unanswered(
      ctx,
      g,
      ev.name === "turn.failed" ? str(ev.payload["code"]) : undefined,
      typeof at === "number" && Number.isFinite(at) ? at : undefined,
    );
  }
  finishGoal(ctx, g);
  return [g.id];
}

/** Something that may have cleared what holds a goal's check-ins back (a turn of its lead ended well, a sign-in was saved): the held wake-up is asked again, once. */
export async function onCleared(ctx: GoalsCtx, ev: Ev): Promise<string[]> {
  ensure(ctx.db);
  const held = blocksWhere(ctx.db, "wake_id IN (SELECT id FROM goals_wake WHERE state = 'waiting')");
  const woken: string[] = [];
  for (const b of held) {
    const g = getGoal(ctx.db, b.goalId);
    if (!g || !LIVE.has(g.status)) continue;
    if (ev.name === "turn.completed") {
      if (str(ev.payload["agentId"]) !== g.leadAgentId) continue;
    } else if (b.code === "engine.vault_locked" || b.cause === "limit" || b.cause === "transient") continue; // a saved sign-in does not unlock a Vault or lift a limit
    if (resumeBlock(ctx, g)) {
      note(ctx, g.id, "wake", `${whoToken(g.leadAgentId)} is asked to check in again: the cause may be gone.`);
      saveGoal(ctx, g);
      dispatch(ctx, g);
      woken.push(g.id);
    }
  }
  return woken;
}

/** A turn in a goal's chat parked on a person (a held send, a question): the goal waits on them, and says on whom. */
export async function onWaiting(ctx: GoalsCtx, ev: Ev): Promise<string[]> {
  const threadId = str(ev.payload["threadId"]),
    taskId = str(ev.payload["taskId"]);
  const goalId = threadId && taskId ? goalOfThread(ctx.db, threadId) : undefined;
  const g = goalId ? getGoal(ctx.db, goalId) : undefined;
  if (!g || !LIVE.has(g.status)) return [];
  const t = (await tryCall<{ task?: TaskRow }>(ctx, "tasks.get", { taskId }))?.task;
  if (!t || t.state === "done" || t.state === "canceled") return [];
  addTask(ctx.db, g.id, t.id, "ask");
  addWait(ctx, g, { id: t.id, kind: t.kind, title: t.title, ...(t.assigned ? { assigned: t.assigned } : {}) });
  finishGoal(ctx, g);
  return [g.id];
}

/** A person mentioned in a goal's chat may read its folder. */
export async function onMention(ctx: GoalsCtx, ev: Ev): Promise<string[]> {
  const threadId = str(ev.payload["threadId"]),
    personId = str(ev.payload["personId"]);
  const goalId = threadId ? goalOfThread(ctx.db, threadId) : undefined;
  const g = goalId ? getGoal(ctx.db, goalId) : undefined;
  if (!g?.folderId || !personId.startsWith("usr_") || personId === g.owner || g.helpers.some((h) => h.id === personId))
    return [];
  await tryCall(ctx, "access.share", {
    resource: { type: "folder", id: g.folderId },
    subject: { kind: "person", id: personId },
    level: "view",
    source: `goal:${g.id}:mention`,
    idempotencyKey: `goal-mention:${g.id}:${personId}:${globalThis.crypto.randomUUID()}`,
  });
  note(
    ctx,
    g.id,
    "access",
    `${whoToken(personId)} can now open the goal's folder. They were mentioned in the goal chat.`,
    personId,
  );
  saveGoal(ctx, g);
  return [g.id];
}

/** The clock: every live or paused goal, and ended goals with a last wake-up to send. */
export async function sweep(ctx: GoalsCtx): Promise<string[]> {
  ensure(ctx.db);
  const ids = allGoals(
    ctx.db,
    "status IN ('planning', 'active', 'waiting', 'stuck', 'paused') OR id IN (SELECT goal_id FROM goals_wake WHERE state = 'pending')",
  ).map((g) => g.id);
  for (const id of ids) {
    try {
      await tick(ctx, id);
    } catch (e) {
      note(
        ctx,
        id,
        "error",
        "The check-in did not run: something went wrong that Vyre could not read. It tries again at the next one.",
        undefined,
        { error: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200) },
      );
    }
  }
  return ids;
}
export const goalThreads = threadsOf;

/** A finished task's outputs land in the goal's folder, a copy each, once. The task keeps its own. */
export async function keepOutputs(ctx: GoalsCtx, g: Goal, taskId: string): Promise<number> {
  if (!g.folderId) return 0;
  const t = (await tryCall<{ task?: { fileIds?: string[]; title?: string } }>(ctx, "tasks.get", { taskId }))?.task;
  let n = 0;
  for (const fileId of (t?.fileIds ?? []).slice(0, 20)) {
    if (
      await tryCall(ctx, "files.copy", { fileId, toFolderId: g.folderId, idempotencyKey: `goal-out:${g.id}:${fileId}` })
    )
      n++;
  }
  if (n > 0)
    note(
      ctx,
      g.id,
      "files",
      `Kept ${n} file${n === 1 ? "" : "s"} from "${t?.title ?? taskId}" in the goal's folder.`,
      taskId,
    );
  return n;
}

/** Files people drop into the goal chat are kept in the goal's folder too. */
export async function onMessage(ctx: GoalsCtx, ev: Ev): Promise<string[]> {
  const threadId = str(ev.payload["threadId"]),
    messageId = str(ev.payload["messageId"]);
  const goalId = threadId ? goalOfThread(ctx.db, threadId) : undefined;
  if (!goalId || !messageId) return [];
  const author = ev.payload["author"] as { kind?: string } | undefined;
  if (author?.kind !== "person") return [];
  const g = getGoal(ctx.db, goalId);
  if (!g) return [];
  const m = (await tryCall<{ message?: { attachments?: string[] } }>(ctx, "chat.message.get", { threadId, messageId }))
    ?.message;
  const files = (m?.attachments ?? []).slice(0, 20);
  if (files.length === 0) return [];
  if (!g.folderId) await ensureFolder(ctx, g);
  if (!g.folderId) return [];
  let n = 0;
  for (const fileId of files)
    if (
      await tryCall(ctx, "files.copy", {
        fileId,
        toFolderId: g.folderId,
        idempotencyKey: `goal-drop:${g.id}:${fileId}`,
      })
    )
      n++;
  if (n > 0)
    note(ctx, g.id, "files", `Kept ${n} file${n === 1 ? "" : "s"} from the goal chat in the goal's folder.`, messageId);
  saveGoal(ctx, g);
  return [g.id];
}

/** A wake-up the lead took and ended its turn on without a check-in. */
async function unanswered(
  ctx: GoalsCtx,
  g: Goal,
  code: string | undefined,
  resetsAt: number | undefined,
): Promise<void> {
  const w = openWake(ctx.db, g.id);
  if (!w || w.state !== "claimed") return;
  const why = failureWhy(code);
  // a goal that has ended holds nothing back and asks nothing of its owner: its last wake-up (the retrospective) that cannot run is said in the activity and let go
  if (ENDED.has(g.status) && (holdsAtOnce(why) || blockOf(ctx.db, g.id) || w.attempt >= MAX_TRIES)) {
    ctx.db.run("UPDATE goals_wake SET state = 'dropped' WHERE id = ?", w.id);
    note(
      ctx,
      g.id,
      "wake",
      `${whoToken(g.leadAgentId)} could not write the retrospective: ${failureClause(code)}.`,
      w.id,
      { code: code ?? null, wakeId: w.id, attempt: w.attempt },
    );
    return;
  }
  // a cause only the person can fix, a usage limit, or a trouble that came back after its retries waits (the owner is told once); a passing trouble is tried again with a longer wait each time
  if (holdsAtOnce(why) || blockOf(ctx.db, g.id) || w.attempt >= MAX_TRIES) {
    await hold(ctx, g, w, code ?? "", resetsAt);
    return;
  }
  const wait = BACKOFF_MS[Math.min(w.attempt, BACKOFF_MS.length) - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!;
  ctx.db.run(
    "UPDATE goals_wake SET state = 'pending', reason = CASE WHEN (',' || reason || ',') LIKE '%,retry,%' THEN reason ELSE reason || ',retry' END, due_at = ? WHERE id = ?",
    ctx.now() + wait,
    w.id,
  );
  const mins = Math.max(1, Math.round(wait / 60_000));
  // a failed turn says why in plain words; the code stays in the row's data for an admin and is never part of a sentence
  note(
    ctx,
    g.id,
    "wake",
    `${whoToken(g.leadAgentId)} could not check in: ${failureClause(code)}. Trying again in ${mins} minute${mins === 1 ? "" : "s"}.`,
    w.id,
    { code: code ?? null, wakeId: w.id, attempt: w.attempt },
  );
}
