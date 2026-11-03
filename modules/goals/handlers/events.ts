// What the goals module reads from the event log: its tasks moving, turns in its chats (budget), turns parked on a person (waiting), mentions (folder access). Each is safe to read twice.
import { ENDED, LIVE, addTask, addThread, allGoals, dispatch, ensure, getGoal, goalOfTask, goalOfThread, note, queueWake, rootOf, saveGoal, setStatus, threadsOf } from "../projections.ts";
import type { Goal, GoalsCtx, Who } from "../projections.ts";
import { addWait, dropWait, setTaskState, spend, syncGrants, tick, tickFromTask, tryCall, unstick } from "./life.ts";

type Obj = Record<string, unknown>;
interface Ev { name: string; id?: string; payload: Obj }
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const REQUESTS = new Set(["approve", "answer", "unblock", "review"]);
const anyLive = (ctx: GoalsCtx): boolean => { ensure(ctx.db); return ctx.db.all("SELECT 1 AS x FROM goals_goal WHERE status IN ('planning', 'active', 'waiting', 'stuck', 'paused') LIMIT 1").length > 0; };
interface TaskRow { id: string; kind: string; title: string; state: string; parentTaskId?: string; threadId?: string; key?: string; assigned?: Who; workingNotes?: Record<string, string> }

function finishGoal(ctx: GoalsCtx, g: Goal): void { dispatch(ctx, g); saveGoal(ctx, g); }

/** A task of a goal, or a new one under its plan: keep its state, its thread, and what waits on whom. */
export async function onTask(ctx: GoalsCtx, ev: Ev): Promise<string[]> {
  const taskId = str(ev.payload["taskId"]);
  if (!taskId) return [];
  let known = goalOfTask(ctx.db, taskId);
  let task: TaskRow | undefined;
  const read = async (): Promise<TaskRow | undefined> => (task ??= (await tryCall<{ task?: TaskRow }>(ctx, "tasks.get", { taskId }))?.task);
  // the root's children settled: all done, or one is blocked or asks
  if (ev.name === "task.children_settled") {
    const goalId = rootOf(ctx.db, taskId);
    const g = goalId ? getGoal(ctx.db, goalId) : undefined;
    if (!g || !LIVE.has(g.status)) return [];
    const reason = str(ev.payload["reason"]);
    queueWake(ctx, g, reason === "finished" ? "task_done" : reason === "blocked" ? "task_blocked" : "task_asked", reason === "finished" ? "Every task in the plan is done." : undefined, `settled:${taskId}:${reason}:${str(ev.payload["childId"])}`);
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
    if (REQUESTS.has(t.kind)) { addTask(ctx.db, g.id, t.id, "ask"); addWait(ctx, g, { id: t.id, kind: t.kind, title: t.title, ...(t.assigned ? { assigned: t.assigned } : {}) }); }
    else if (viaRoot && t.kind === "work") { addTask(ctx.db, g.id, t.id, "plan"); setTaskState(ctx, t.id, t.state, t.title, t.key); note(ctx, g.id, "plan", `Planned ${t.key ? `${t.key} ` : ""}${t.title}`, t.id); if (g.status === "planning") setStatus(ctx, g, "active"); }
    else return [];
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
  const to = ev.name === "task.transitioned" ? str(ev.payload["to"]) : ev.name === "task.completed" ? "done" : "canceled";
  const closed = to === "done" || to === "canceled";
  if (known.role === "plan") {
    setTaskState(ctx, taskId, to);
    if (to === "done" && ev.name !== "task.transitioned") {
      const t = await read();
      note(ctx, g.id, "task", `Done: ${t?.key ? `${t.key} ` : ""}${t?.title ?? taskId}`, taskId);
      await tickFromTask(ctx, g, taskId);
      if (LIVE.has(g.status)) queueWake(ctx, g, "task_done", `Done: ${t?.title ?? taskId}`, `task:${taskId}:done`);
    }
  } else if (closed && (known.role === "ask" || known.role === "notice")) {
    const answered = dropWait(ctx, g, taskId, to === "done" ? "Answered" : "Withdrawn");
    if (known.role === "notice" && taskId === g.stuckTaskId && to === "done" && g.status === "stuck") await unstick(ctx, g, "The owner answered the stuck notice.");
    if ((answered || known.role === "notice") && LIVE.has(g.status) && to === "done") queueWake(ctx, g, "answered", undefined, `ans:${taskId}`);
  }
  finishGoal(ctx, g);
  return [g.id];
}

/** Every turn in a goal's chats counts against its budget. */
export async function onTurn(ctx: GoalsCtx, ev: Ev): Promise<string[]> {
  const threadId = str(ev.payload["threadId"]);
  const goalId = threadId ? goalOfThread(ctx.db, threadId) : undefined;
  const g = goalId ? getGoal(ctx.db, goalId) : undefined;
  if (!g) return [];
  // one count per turn, however often the event is read
  if (ctx.db.run("INSERT OR IGNORE INTO goals_step (goal_id, step_id, title, state, by, at) VALUES (?, ?, NULL, 'done', 'turn', ?)", g.id, `turn:${str(ev.payload["turnId"])}`, ctx.now()).changes === 0) return [];
  await spend(ctx, g, Number(ev.payload["costMicros"] ?? 0), 1);
  finishGoal(ctx, g);
  return [g.id];
}

/** A turn in a goal's chat parked on a person (a held send, a question): the goal waits on them, and says on whom. */
export async function onWaiting(ctx: GoalsCtx, ev: Ev): Promise<string[]> {
  const threadId = str(ev.payload["threadId"]), taskId = str(ev.payload["taskId"]);
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
  const threadId = str(ev.payload["threadId"]), personId = str(ev.payload["personId"]);
  const goalId = threadId ? goalOfThread(ctx.db, threadId) : undefined;
  const g = goalId ? getGoal(ctx.db, goalId) : undefined;
  if (!g?.folderId || !personId.startsWith("usr_") || personId === g.owner || g.helpers.some((h) => h.id === personId)) return [];
  await tryCall(ctx, "access.share", { resource: { type: "folder", id: g.folderId }, subject: { kind: "person", id: personId }, level: "view", source: `goal:${g.id}:mention`, idempotencyKey: `goal-mention:${g.id}:${personId}` });
  note(ctx, g.id, "access", `${personId} was mentioned in the goal chat and can read its folder.`, personId);
  saveGoal(ctx, g);
  return [g.id];
}

/** The clock: every live or paused goal, and ended goals with a last wake-up to send. */
export async function sweep(ctx: GoalsCtx): Promise<string[]> {
  ensure(ctx.db);
  const ids = allGoals(ctx.db, "status IN ('planning', 'active', 'waiting', 'stuck', 'paused') OR id IN (SELECT goal_id FROM goals_wake WHERE state = 'pending')").map((g) => g.id);
  for (const id of ids) {
    try { await tick(ctx, id); } catch (e) { note(ctx, id, "error", `The goal's clock failed once: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`); }
  }
  return ids;
}
export const goalThreads = threadsOf;
