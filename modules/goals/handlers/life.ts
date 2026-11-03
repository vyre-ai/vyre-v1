// The life of a goal, shared by the capabilities, the consumers and the clock: its chat, root task, folder and grants; reading the source; check-ins; stuck; budget; the end.
// Everything that touches another module goes through ctx.call and is best effort where the goal can carry on without it: the activity says what could not be done, and the clock tries again.
import {
  DAY, HOUR, LIVE, POLL_MS, addReading, addTask, addThread, afterQuiet, better, clean, dispatch, emit, ensure, getGoal, goalOfTask, inQuiet, label, log, money, nextCheckin, progressOf, queueWake,
  reached, saveGoal, setStatus, signalOf, threadsOf, when,
} from "../projections.ts";
import type { Ended, Goal, GoalsCtx, Who } from "../projections.ts";
import { readSource, sourceWords } from "../sources.ts";

type Obj = Record<string, unknown>;
const why = (e: unknown): string => {
  const o = e as { message?: unknown; body?: { error?: { message?: unknown } } };
  const m = o?.body?.error?.message ?? o?.message;
  return typeof m === "string" && m !== "" ? m.slice(0, 200) : "it did not answer";
};
export async function tryCall<T = Obj>(ctx: GoalsCtx, cap: string, input: unknown): Promise<T | undefined> {
  if (!ctx.call) return undefined;
  try { return (await ctx.call(cap, input)) as T; } catch { return undefined; }
}
async function must<T = Obj>(ctx: GoalsCtx, cap: string, input: unknown): Promise<T> {
  if (!ctx.call) throw new Error(`${cap} cannot be reached from here`);
  return (await ctx.call(cap, input)) as T;
}

// ---- the plan's tasks, kept here so a list of goals needs no call per goal ----

export function setTaskState(ctx: GoalsCtx, taskId: string, state: string, title?: string, key?: string): void {
  ensure(ctx.db);
  ctx.db.run("UPDATE goals_task SET state = ?, title = COALESCE(?, title), key = COALESCE(?, key) WHERE task_id = ?", state, title ?? null, key ?? null, taskId);
}
export function taskCounts(ctx: Pick<GoalsCtx, "db">, goalId: string): { done: number; total: number } {
  ensure(ctx.db);
  const rows = ctx.db.all("SELECT state FROM goals_task WHERE goal_id = ? AND role = 'plan'", goalId) as Array<{ state: string | null }>;
  const live = rows.filter((r) => r.state !== "canceled");
  return { done: live.filter((r) => r.state === "done").length, total: live.length };
}
export function planTasks(ctx: Pick<GoalsCtx, "db">, goalId: string): Array<{ taskId: string; state: string; title: string; key?: string }> {
  ensure(ctx.db);
  return (ctx.db.all("SELECT task_id, state, title, key FROM goals_task WHERE goal_id = ? AND role = 'plan' ORDER BY rowid", goalId) as Obj[])
    .map((r) => clean({ taskId: String(r["task_id"]), state: String(r["state"] ?? "todo"), title: String(r["title"] ?? ""), key: typeof r["key"] === "string" ? r["key"] : undefined }) as { taskId: string; state: string; title: string; key?: string });
}
export function waits(ctx: Pick<GoalsCtx, "db">, goalId: string): Array<{ taskId: string; kind: string; title: string; assigned?: Who; since: number }> {
  ensure(ctx.db);
  return (ctx.db.all("SELECT * FROM goals_wait WHERE goal_id = ? ORDER BY since", goalId) as Obj[]).map((r) => clean({
    taskId: String(r["task_id"]), kind: String(r["kind"]), title: String(r["title"]), assigned: typeof r["assigned"] === "string" ? JSON.parse(String(r["assigned"])) as Who : undefined, since: Number(r["since"]),
  }) as { taskId: string; kind: string; title: string; assigned?: Who; since: number });
}

// ---- lines in the goal chat ----

export async function post(ctx: GoalsCtx, g: Goal, body: string, key: string, data?: Obj): Promise<string | undefined> {
  if (!g.threadId) return undefined;
  const blocks = data ? [{ type: "goal", v: 1, data: clean({ goalId: g.id, threadId: g.threadId, title: g.title, line: g.finish.line, status: g.status, deadline: g.deadline, ...data }) }] : undefined;
  const r = await tryCall<{ message?: { messageId?: string } }>(ctx, "chat.post", clean({ threadId: g.threadId, body, blocks, idempotencyKey: `goal-post:${g.id}:${key}` }));
  return r?.message?.messageId;
}
const unitOf = (g: Goal): string => (g.finish.unit ? ` ${g.finish.unit}` : "");
export function numberLine(g: Goal): string {
  const f = g.finish;
  if (f.kind === "number") return g.value === undefined ? `no number yet${g.readError ? ` (${g.readError})` : ""}` : `${g.value}${f.target !== undefined ? ` of ${f.target}` : ""}${unitOf(g)}`;
  if (f.kind === "checklist") { const items = f.items ?? []; return `${items.filter((i) => i.done).length} of ${items.length} done`; }
  return "done when the owner says so";
}

// ---- making what a goal needs: its chat, its root task, its folder ----

export async function ensureThread(ctx: GoalsCtx, g: Goal): Promise<string | undefined> {
  if (!g.threadId) {
    const r = await tryCall<{ thread?: { threadId?: string } }>(ctx, "chat.start", { kind: "chat", agentIds: [g.leadAgentId], scopeType: "goal", scopeId: g.id, title: g.title, idempotencyKey: `goal-thread:${g.id}` });
    if (!r?.thread?.threadId) return undefined;
    g.threadId = r.thread.threadId;
    addThread(ctx.db, g.id, g.threadId, "goal");
  }
  await seat(ctx, g);
  return g.threadId;
}
/** The owner and the helpers are in the goal chat: people as members, agents listening (they speak when mentioned). */
export async function seat(ctx: GoalsCtx, g: Goal): Promise<void> {
  if (!g.threadId) return;
  for (const p of new Set([g.owner, ...g.helpers.filter((h) => h.kind === "person").map((h) => h.id)])) await tryCall(ctx, "threads.members.add", { threadId: g.threadId, personId: p });
  for (const h of g.helpers) if (h.kind === "agent" && h.id !== g.leadAgentId) await tryCall(ctx, "threads.add_agent", { threadId: g.threadId, agentId: h.id, mode: "listen" });
}

export async function ensureRoot(ctx: GoalsCtx, g: Goal): Promise<string | undefined> {
  if (g.rootTaskId) return g.rootTaskId;
  const r = await tryCall<{ task?: { id?: string } }>(ctx, "tasks.create", {
    kind: "work", title: g.title, summary: g.finish.line, assigned: { kind: "agent", id: g.leadAgentId }, due: g.deadline,
    notes: { "goal.id": g.id, "goal.root": "1", "goal.title": g.title, "plan.parent": "1", "baton.owner": g.owner, brief: g.finish.line },
    idempotencyKey: `goal-root:${g.id}`,
  });
  if (!r?.task?.id) { log(ctx, g.id, "error", "The plan's parent task could not be made yet; trying again at the next check."); return undefined; }
  g.rootTaskId = r.task.id;
  addTask(ctx.db, g.id, r.task.id, "root");
  return g.rootTaskId;
}

const SUBS = ["Plan", "Drafts", "Research", "Reports"] as const;
async function childFolder(ctx: GoalsCtx, parentId: string, name: string, key: string): Promise<string | undefined> {
  const listed = await tryCall<{ folders?: Array<{ folderId: string; name: string }> }>(ctx, "files.list", { folder: parentId, limit: 500 });
  const found = listed?.folders?.find((f) => f.name.toLowerCase() === name.toLowerCase());
  if (found) return found.folderId;
  const made = await tryCall<{ folder?: { folderId?: string } }>(ctx, "files.folder.create", { parentId, name, idempotencyKey: key });
  return made?.folder?.folderId;
}
/** The goal's folder: <Project>/Goals/<title>, or Goals/<title> under the owner's own files. Subfolders are made only when first used. */
export async function ensureFolder(ctx: GoalsCtx, g: Goal, sub?: (typeof SUBS)[number]): Promise<string | undefined> {
  if (!g.folderId) {
    let parent: string | undefined;
    if (g.projectId) parent = (await tryCall<{ project?: { folderId?: string } }>(ctx, "projects.get", { projectId: g.projectId }))?.project?.folderId;
    if (!parent) parent = (await tryCall<{ roots?: Array<{ key: string; folderId?: string }> }>(ctx, "files.tree", {}))?.roots?.find((r) => r.key === "personal")?.folderId;
    if (!parent) { log(ctx, g.id, "error", "The goal's Files folder could not be made yet; trying again at the next check."); return undefined; }
    const goals = await childFolder(ctx, parent, "Goals", `goal-folder-root:${parent}`);
    if (!goals) return undefined;
    const id = await childFolder(ctx, goals, g.title.replace(/[/\\]/g, "-").slice(0, 120), `goal-folder:${g.id}`);
    if (!id) return undefined;
    g.folderId = id;
    log(ctx, g.id, "folder", "Made the goal's folder in Files.", id);
    await shareFolder(ctx, g);
  }
  if (!sub) return g.folderId;
  return childFolder(ctx, g.folderId, sub, `goal-folder:${g.id}:${sub}`);
}
/** Access follows the goal: the owner manages, the lead and helpers edit. One source tag per goal, so a helper who leaves loses exactly what the goal gave. */
export async function shareFolder(ctx: GoalsCtx, g: Goal): Promise<void> {
  if (!g.folderId) return;
  const resource = { type: "folder", id: g.folderId };
  const source = `goal:${g.id}`;
  await tryCall(ctx, "access.unshare", { resource, source });
  const subjects: Array<{ kind: string; id: string; level: string }> = [{ kind: "person", id: g.owner, level: "manage" }, { kind: "agent", id: g.leadAgentId, level: "edit" }];
  for (const h of g.helpers) if (!subjects.some((s) => s.id === h.id)) subjects.push({ kind: h.kind, id: h.id, level: "edit" });
  for (const s of subjects) await tryCall(ctx, "access.share", { resource, subject: { kind: s.kind, id: s.id }, level: s.level, source, idempotencyKey: `goal-share:${g.id}:${s.id}:${s.level}:${g.version}` });
}

// ---- the Gate: standing permissions are grants of the goal, live only in its chats while it runs ----

export async function syncGrants(ctx: GoalsCtx, g: Goal, opts: { press?: boolean } = {}): Promise<void> {
  const live = LIVE.has(g.status);
  const granted = g.permissions.filter((p) => p.granted === true).map((p) => ({ act: p.act, target: p.target }));
  const input = clean({ goalId: g.id, person: g.owner, threads: live ? threadsOf(ctx.db, g.id) : [], until: g.deadline + DAY, ...(opts.press ? { set: granted } : {}) });
  await tryCall(ctx, "gate.grants.goal", input);
}

// ---- reading the number ----

/** Read the source now and record what it said. Returns whether the number moved. A goal that reaches its finish line is done here, whatever woke it. */
export async function readNow(ctx: GoalsCtx, g: Goal, why: string): Promise<boolean> {
  const now = ctx.now();
  const r = await readSource(ctx, g);
  g.pollAt = now + POLL_MS;
  if (g.finish.kind !== "number") return false;
  addReading(ctx.db, g.id, now, r);
  const prev = g.value;
  if (!r.ok) {
    const fresh = g.readError !== r.error;
    g.readError = r.error ?? "the source did not answer"; g.readFails += 1;
    if (fresh) { emit(ctx, g, "goal.progress", { ok: false, error: r.error }); log(ctx, g.id, "reading", `Could not read ${sourceWords(g.finish.source)}: ${r.error}`); }
    return false;
  }
  delete g.readError; g.readFails = 0;
  if (r.value !== undefined) g.value = r.value;
  g.valueAt = now;
  if (g.startValue === undefined && r.value !== undefined) g.startValue = r.value;
  const moved = prev !== r.value;
  if (moved) {
    emit(ctx, g, "goal.progress", clean({ ok: true, value: r.value, prev, target: g.finish.target }));
    log(ctx, g.id, "reading", `${sourceWords(g.finish.source)}: ${r.value}${prev !== undefined ? ` (${(r.value ?? 0) - prev >= 0 ? "+" : ""}${(r.value ?? 0) - prev} since ${why === "checkin" ? "the last check-in" : "the last read"})` : ""}`);
  }
  if (LIVE.has(g.status) && reached(g)) { await endGoal(ctx, g, "done"); return moved; }
  // the number moving again ends a stuck spell at once
  if (moved && g.status === "stuck" && g.lastSignal !== undefined && r.value !== undefined && better(g, r.value, g.lastSignal)) await unstick(ctx, g, "The number moved again.");
  if (moved && LIVE.has(g.status) && prev !== undefined) queueWake(ctx, g, "source_changed", `${sourceWords(g.finish.source)} went from ${prev} to ${r.value}.`, `src:${g.id}:${Math.floor(now / (3 * HOUR))}`);
  return moved;
}

/** A finished task can finish a checklist item it is linked to. */
export async function tickFromTask(ctx: GoalsCtx, g: Goal, taskId: string): Promise<boolean> {
  if (g.finish.kind !== "checklist") return false;
  let changed = false;
  for (const i of g.finish.items ?? []) if (i.taskId === taskId && i.done !== true) { i.done = true; changed = true; log(ctx, g.id, "checklist", `Done: ${i.text} (its task finished)`); }
  if (changed) { emit(ctx, g, "goal.progress", { ok: true, value: (g.finish.items ?? []).filter((i) => i.done).length, target: (g.finish.items ?? []).length }); if (LIVE.has(g.status) && reached(g)) await endGoal(ctx, g, "done"); }
  return changed;
}

// ---- check-ins and stuck ----

export async function checkin(ctx: GoalsCtx, g: Goal): Promise<void> {
  const now = ctx.now();
  await readNow(ctx, g, "checkin");
  if (!LIVE.has(g.status)) return;
  g.checkins += 1; g.lastCheckinAt = now; g.nextCheckinAt = nextCheckin(g, now);
  const counts = taskCounts(ctx, g.id);
  const signal = signalOf(g, counts.done);
  const flat = signal === undefined || (g.lastSignal !== undefined && !better(g, signal, g.lastSignal));
  if (g.lastSignal === undefined && signal !== undefined) g.flatCheckins = 0;
  else g.flatCheckins = flat ? g.flatCheckins + 1 : 0;
  if (signal !== undefined) g.lastSignal = signal;
  log(ctx, g.id, "checkin", `Check-in ${g.checkins}: ${numberLine(g)}${g.flatCheckins > 0 ? `, no progress for ${g.flatCheckins} check-in${g.flatCheckins === 1 ? "" : "s"}` : ""}.`);
  if (g.flatCheckins >= g.stuckAfter && g.status !== "stuck") await stuck(ctx, g, stuckReason(ctx, g), ["Change the plan", "Extend the deadline"]);
  queueWake(ctx, g, "checkin", undefined, `checkin:${g.id}:${g.checkins}`);
}
export function stuckReason(ctx: GoalsCtx, g: Goal): string {
  const parts: string[] = [];
  if (g.readError) parts.push(`${sourceWords(g.finish.source)} could not be read: ${g.readError}.`);
  else parts.push(`No progress in ${g.flatCheckins} check-ins; ${numberLine(g)}${g.valueAt ? ` since ${when(g.valueAt, g.zone)}` : ""}.`);
  const w = waits(ctx, g.id);
  if (w.length > 0) parts.push(`Waiting on: ${w.slice(0, 3).map((x) => x.title).join("; ")}.`);
  return parts.join(" ");
}
/** Stuck: the status says why, and the owner hears once (one Unblock task in Needs you, held until their quiet hours end). */
export async function stuck(ctx: GoalsCtx, g: Goal, reason: string, options: string[]): Promise<void> {
  setStatus(ctx, g, "stuck", reason);
  if (!g.stuckTaskId) {
    const r = await tryCall<{ task?: { id?: string } }>(ctx, "tasks.create", {
      kind: "unblock", title: `Stuck: ${g.title}`, summary: `${reason}${options.length ? `\nOptions: ${options.map((o, i) => `${i + 1}. ${o}`).join(" ")}` : ""}`,
      assigned: { kind: "person", id: g.owner }, notes: { "goal.id": g.id, "goal.title": g.title }, idempotencyKey: `goal-stuck:${g.id}:${g.checkins}:${g.version}`,
    });
    if (r?.task?.id) {
      g.stuckTaskId = r.task.id;
      addTask(ctx.db, g.id, r.task.id, "notice");
      const until = afterQuiet(ctx.now(), g);
      if (until > ctx.now()) await tryCall(ctx, "tasks.snooze", { taskId: r.task.id, until });
    }
  }
  await post(ctx, g, `Stuck: ${reason}`, `stuck:${g.checkins}:${g.version}`, { kind: "stuck", summary: reason, needs: options, value: g.value, target: g.finish.target });
}
export async function unstick(ctx: GoalsCtx, g: Goal, why: string): Promise<void> {
  setStatus(ctx, g, waits(ctx, g.id).length > 0 ? "waiting" : "active");
  g.flatCheckins = 0;
  if (g.stuckTaskId) { await tryCall(ctx, "tasks.withdraw", { taskId: g.stuckTaskId, note: why }); delete g.stuckTaskId; }
  log(ctx, g.id, "status", why);
}

// ---- waiting on someone ----

export function addWait(ctx: GoalsCtx, g: Goal, t: { id: string; kind: string; title: string; assigned?: Who }): boolean {
  ensure(ctx.db);
  const made = ctx.db.run("INSERT OR IGNORE INTO goals_wait (goal_id, task_id, kind, title, assigned, since) VALUES (?, ?, ?, ?, ?, ?)", g.id, t.id, t.kind, t.title.slice(0, 200), t.assigned ? JSON.stringify(t.assigned) : null, ctx.now()).changes > 0;
  if (made) {
    log(ctx, g.id, "waiting", `Waiting: ${t.title}`, t.id);
    if (g.status === "active" || g.status === "planning") setStatus(ctx, g, "waiting", t.title);
  }
  return made;
}
export function dropWait(ctx: GoalsCtx, g: Goal, taskId: string, how: string): boolean {
  ensure(ctx.db);
  const row = ctx.db.all("SELECT title FROM goals_wait WHERE goal_id = ? AND task_id = ?", g.id, taskId)[0] as Obj | undefined;
  if (!row) return false;
  ctx.db.run("DELETE FROM goals_wait WHERE goal_id = ? AND task_id = ?", g.id, taskId);
  log(ctx, g.id, "answered", `${how}: ${String(row["title"])}`, taskId);
  if (g.status === "waiting" && waits(ctx, g.id).length === 0) setStatus(ctx, g, "active");
  return true;
}

// ---- budget ----

export async function spend(ctx: GoalsCtx, g: Goal, micros: number, turns: number): Promise<void> {
  g.spentMicros += Math.max(0, micros); g.turns += Math.max(0, turns);
  const b = g.budget;
  const used = Math.max(b.spendMicros ? g.spentMicros / b.spendMicros : 0, b.turns ? g.turns / b.turns : 0);
  if (used >= 1 && LIVE.has(g.status)) {
    setStatus(ctx, g, "paused", `The budget is used: ${budgetLine(g)}.`);
    await syncGrants(ctx, g);
    if (!g.budgetTaskId) {
      const r = await tryCall<{ task?: { id?: string } }>(ctx, "tasks.create", {
        kind: "unblock", title: `Budget used: ${g.title}`, summary: `${budgetLine(g)}. The goal is paused. Raise the budget to go on, or stop it.`,
        assigned: { kind: "person", id: g.owner }, notes: { "goal.id": g.id, "goal.title": g.title }, idempotencyKey: `goal-budget:${g.id}:${g.version}`,
      });
      if (r?.task?.id) { g.budgetTaskId = r.task.id; const until = afterQuiet(ctx.now(), g); if (until > ctx.now()) await tryCall(ctx, "tasks.snooze", { taskId: r.task.id, until }); }
    }
    await post(ctx, g, `Paused: the budget is used (${budgetLine(g)}). Raise it to go on.`, `budget-full:${g.version}`);
  } else if (used >= 0.8 && !g.budgetWarned) {
    g.budgetWarned = true;
    emit(ctx, g, "goal.budget_warned", { spentMicros: g.spentMicros, turns: g.turns, budget: g.budget });
    log(ctx, g.id, "budget", `80% of the budget used: ${budgetLine(g)}.`);
    await post(ctx, g, `80% of the budget is used: ${budgetLine(g)}.`, `budget-80:${g.version}`);
  }
}
export function budgetLine(g: Goal): string {
  const parts: string[] = [];
  parts.push(g.budget.spendMicros ? `${money(g.spentMicros)} of ${money(g.budget.spendMicros)}` : money(g.spentMicros));
  parts.push(g.budget.turns ? `${g.turns} of ${g.budget.turns} turns` : `${g.turns} turns`);
  return parts.join(", ");
}

// ---- the end ----

export function summaryOf(ctx: GoalsCtx, g: Goal, outcome: Ended, note?: string): string {
  const f = g.finish;
  const p = progressOf(g, taskCounts(ctx, g.id));
  const lines: string[] = [];
  if (f.kind === "number") lines.push(g.value === undefined ? "The number was never read." : `${outcome === "done" ? "Reached" : "Got to"} ${g.value}${f.target !== undefined ? ` of ${f.target}` : ""}${unitOf(g)}${p.percent !== undefined ? ` (${p.percent}%)` : ""}${outcome === "missed" ? ` by the deadline, ${when(g.deadline, g.zone)}` : ""}.`);
  else if (f.kind === "checklist") lines.push(`${p.itemsDone ?? 0} of ${p.items ?? 0} conditions met.`);
  const open = planTasks(ctx, g.id).filter((t) => t.state !== "done" && t.state !== "canceled");
  lines.push(`${p.tasksDone} of ${p.tasks} tasks done.${open.length ? ` Still open: ${open.slice(0, 4).map((t) => t.title).join("; ")}.` : ""}`);
  const w = waits(ctx, g.id);
  if (w.length) lines.push(`Still waiting on: ${w.slice(0, 3).map((x) => x.title).join("; ")}.`);
  lines.push(`Used ${budgetLine(g)}.`);
  if (note) lines.push(note);
  return lines.join(" ");
}
export async function endGoal(ctx: GoalsCtx, g: Goal, outcome: Ended, note?: string): Promise<void> {
  if (!LIVE.has(g.status) && g.status !== "paused" && g.status !== "draft") return;
  const now = ctx.now();
  g.summary = summaryOf(ctx, g, outcome, note);
  g.ended = outcome; g.endedAt = now;
  delete g.nextCheckinAt;
  setStatus(ctx, g, outcome);
  emit(ctx, g, "goal.ended", { outcome, summary: g.summary });
  log(ctx, g.id, "ended", `${label(outcome)}. ${g.summary}`);
  await syncGrants(ctx, g);
  // what was asked of people is withdrawn; open work stops when the goal is stopped, and stays for a person to finish or cancel otherwise
  for (const w of waits(ctx, g.id)) await tryCall(ctx, "tasks.withdraw", { taskId: w.taskId, note: `The goal ${outcome === "done" ? "is done" : outcome === "missed" ? "missed its deadline" : "was stopped"}.` });
  ctx.db.run("DELETE FROM goals_wait WHERE goal_id = ?", g.id);
  for (const id of [g.stuckTaskId, g.budgetTaskId]) if (id) await tryCall(ctx, "tasks.withdraw", { taskId: id, note: "The goal ended." });
  delete g.stuckTaskId; delete g.budgetTaskId;
  if (outcome === "stopped") for (const t of planTasks(ctx, g.id)) if (t.state !== "done" && t.state !== "canceled") await tryCall(ctx, "tasks.withdraw", { taskId: t.taskId, note: "The goal was stopped." });
  if (g.rootTaskId) await tryCall(ctx, "tasks.transition", { taskId: g.rootTaskId, to: outcome === "done" ? "done" : "canceled", note: g.summary.slice(0, 300) });
  const extendTo = outcome === "missed" ? afterQuiet(nextCheckin({ ...g, rhythm: { every: "day", at: "17:00" } }, now + 2 * DAY), g) : undefined;
  await post(ctx, g, `${label(outcome)}: ${g.summary}${extendTo ? ` Extend to ${when(extendTo, g.zone)}?` : ""}`, `ended:${outcome}:${g.version}`, clean({ kind: "ended", outcome, summary: g.summary, value: g.value, target: g.finish.target, unit: g.finish.unit }));
  // one last turn for the lead: the retrospective
  queueWake(ctx, g, "ended", `The goal ${outcome === "done" ? "is done" : outcome === "missed" ? "missed its deadline" : "was stopped"}. Write the retrospective with goals_complete.`, `ended:${g.id}:${outcome}:${now}`);
}

// ---- starting ----

/** Start a goal: its chat, its root task, its folder, the first reading, the plan it came with, its grants (only on the owner's press), and the first wake-up. */
export async function startGoal(ctx: GoalsCtx, g: Goal, opts: { press: boolean; plan?: PlanChild[] }): Promise<void> {
  const now = ctx.now();
  await ensureThread(ctx, g);
  setStatus(ctx, g, "planning");
  emit(ctx, g, "goal.started", { by: ctx.principal.id });
  log(ctx, g.id, "started", `Started. Finish line: ${g.finish.line}. Deadline ${when(g.deadline, g.zone)}.`);
  if (!opts.press) for (const p of g.permissions) p.granted = false;
  await ensureRoot(ctx, g);
  await ensureFolder(ctx, g);
  await readNow(ctx, g, "start");
  g.nextCheckinAt = nextCheckin(g, now);
  if (opts.plan && opts.plan.length > 0 && g.status === "planning") await addPlan(ctx, g, opts.plan);
  await syncGrants(ctx, g, { press: opts.press });
  if (LIVE.has(g.status)) queueWake(ctx, g, "start", g.permissions.some((p) => !p.granted) ? "Some standing permissions wait for the owner's own press; until then those acts are held for approval." : undefined, `start:${g.id}`);
}

export interface PlanChild { key: string; title: string; why: string; impact?: string; brief?: string; doneMeans?: string[]; assigned: Who; reviewer?: Who; approver?: Who; dependsOn?: string[]; due?: number }
export async function addPlan(ctx: GoalsCtx, g: Goal, children: PlanChild[]): Promise<Array<{ key: string; taskId: string; created: boolean }>> {
  const root = await ensureRoot(ctx, g);
  if (!root) throw new Error("the plan's parent task could not be made");
  const out = await must<{ children?: Array<{ key: string; taskId: string; shortKey?: string; created: boolean }> }>(ctx, "tasks.plan", {
    parentTaskId: root,
    children: children.map((c) => clean({
      key: c.key, title: c.title, brief: [c.brief?.trim(), `Why: ${c.why}`, c.impact ? `Expected: ${c.impact}` : undefined, `Part of the goal "${g.title}": ${g.finish.line}`].filter(Boolean).join("\n\n"),
      doneMeans: c.doneMeans, assigned: c.assigned, reviewer: c.reviewer, approver: c.approver, dependsOn: c.dependsOn, due: c.due,
      notes: clean({ "goal.id": g.id, "goal.title": g.title, "goal.why": c.why, "goal.impact": c.impact, "baton.owner": g.owner }),
    })),
  });
  const made = out.children ?? [];
  for (const c of made) {
    const src = children.find((x) => x.key === c.key);
    if (goalOfTask(ctx.db, c.taskId)?.goalId && goalOfTask(ctx.db, c.taskId)?.goalId !== g.id) continue;
    addTask(ctx.db, g.id, c.taskId, "plan");
    setTaskState(ctx, c.taskId, "todo", src?.title, c.shortKey);
    if (c.created) log(ctx, g.id, "plan", `Planned ${c.shortKey ? `${c.shortKey} ` : ""}${src?.title ?? ""}. Why: ${src?.why ?? ""}${src?.impact ? `. Expected: ${src.impact}` : ""}`, c.taskId);
  }
  if (g.status === "planning" && made.length > 0) setStatus(ctx, g, "active");
  return made.map((c) => ({ key: c.key, taskId: c.taskId, created: c.created }));
}

// ---- the clock ----

/** One pass over a goal: the deadline, the source, the check-in, wake-ups that went unanswered, and sending what is due. Safe to repeat. */
export async function tick(ctx: GoalsCtx, id: string): Promise<void> {
  const g = getGoal(ctx.db, id);
  if (!g) return;
  const now = ctx.now();
  if ((LIVE.has(g.status) || g.status === "paused") && now >= g.deadline) {
    await readNow(ctx, g, "deadline");
    if (LIVE.has(g.status) || g.status === "paused") await endGoal(ctx, g, reached(g) ? "done" : "missed");
  }
  if (LIVE.has(g.status)) {
    if (!g.threadId) await ensureThread(ctx, g);
    if (!g.rootTaskId) await ensureRoot(ctx, g);
    if (!g.folderId) await ensureFolder(ctx, g);
    if (g.nextCheckinAt !== undefined && now >= g.nextCheckinAt && !inQuiet(now, g)) await checkin(ctx, g);
    else if (g.pollAt === undefined || now >= g.pollAt) await readNow(ctx, g, "poll");
    if (g.nextCheckinAt === undefined && LIVE.has(g.status)) g.nextCheckinAt = nextCheckin(g, now);
    await retryUnanswered(ctx, g);
  }
  dispatch(ctx, g);
  saveGoal(ctx, g);
}

/** A wake-up the lead took and never answered with a check-in is offered once more; after that the goal is stuck, never silent. */
async function retryUnanswered(ctx: GoalsCtx, g: Goal): Promise<void> {
  const now = ctx.now();
  for (const r of ctx.db.all("SELECT id, attempt, sent_at FROM goals_wake WHERE goal_id = ? AND state IN ('sent', 'claimed') AND sent_at < ?", g.id, now - 45 * 60_000) as Obj[]) {
    const id = String(r["id"]);
    if (Number(r["attempt"]) < 2) {
      ctx.db.run("UPDATE goals_wake SET state = 'pending', reason = reason || ',retry', due_at = ? WHERE id = ?", now, id);
      log(ctx, g.id, "wake", "The last wake-up got no check-in; asking once more.", id);
    } else {
      ctx.db.run("UPDATE goals_wake SET state = 'dropped' WHERE id = ?", id);
      if (g.status !== "stuck") await stuck(ctx, g, "The lead agent stopped answering its wake-ups.", ["Ask the lead agent in the goal chat what is wrong", "Give the goal another lead agent"]);
    }
  }
}
