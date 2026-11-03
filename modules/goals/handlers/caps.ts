// The goals capabilities. Who may do what is decided here (a goal is not a kernel resource yet): see projections.ts canSee, mustControl, isOwnerPress, isLead.
import {
  ENDED, LIVE, activity, addTask, allGoals, clean, dispatch, emit, ensure, getGoal, goalOfTask, goalOut, isAdmin, isHelper, isLead, isOwner, isOwnerPress, isSystem, lineOut, note,
  money, mustControl, newGoalId, nextCheckin, openWake, progressOf, queueWake, raise, reached, readings, reasonWords, saveGoal, setStatus, visible, wakeById, when,
} from "../projections.ts";
import type { Finish, Goal, GoalsCtx, Permission, Retro, Who } from "../projections.ts";
import {
  addPlan, addWait, budgetLine, endGoal, ensureFolder, ensureThread, numberLine, planTasks, post, readNow, seat, shareFolder, startGoal, stuck, syncGrants, taskCounts, tryCall, waits,
} from "./life.ts";
import type { PlanChild, Seat } from "./life.ts";
import { sourceWords } from "../sources.ts";

type In = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
const me = (ctx: GoalsCtx): string => ctx.actingFor ?? ctx.principal.id;
const out = (ctx: GoalsCtx, g: Goal) => ({ goal: goalOut(g, taskCounts(ctx, g.id)) });
const QUIET = { from: "22:00", to: "08:00" };

function checkFinish(ctx: GoalsCtx, f: Finish): void {
  if (f.kind === "number") {
    if (f.target === undefined) raise(ctx, "validation.precondition_failed", "A number finish line needs a target.", { reason: "no_target" });
    if (!f.source) raise(ctx, "validation.precondition_failed", "A number finish line needs a source to read it from.", { reason: "no_source" });
  }
  if (f.kind === "checklist" && (f.items ?? []).length === 0) raise(ctx, "validation.precondition_failed", "A checklist finish line needs at least one condition.", { reason: "no_items" });
  const ids = new Set<string>();
  for (const i of f.items ?? []) { if (ids.has(i.id)) raise(ctx, "validation.precondition_failed", `Two conditions use the id ${i.id}.`, { reason: "duplicate_item" }); ids.add(i.id); }
}
function checkPermissions(ctx: GoalsCtx, ps: Permission[]): Permission[] {
  for (const p of ps) if ((p.act as string) === "pay") raise(ctx, "validation.precondition_failed", "Sending money always asks.", { reason: "money" });
  return ps.map((p) => ({ act: p.act, target: p.target, label: p.label, granted: false }));
}
async function zoneOf(ctx: GoalsCtx): Promise<string> {
  const r = await tryCall<{ row?: { value?: unknown } }>(ctx, "settings.get", { key: "profile.timezone" });
  return typeof r?.row?.value === "string" && r.row.value !== "" ? r.row.value : "UTC";
}
function overlaps(ctx: GoalsCtx, g: Goal): Array<{ goalId: string; title: string; recordId: string }> {
  const found: Array<{ goalId: string; title: string; recordId: string }> = [];
  for (const recordId of g.recordIds) {
    for (const r of ctx.db.all("SELECT goal_id FROM goals_link WHERE record_id = ? AND goal_id <> ?", recordId, g.id) as Array<{ goal_id: string }>) {
      const other = getGoal(ctx.db, r.goal_id);
      if (other && (LIVE.has(other.status) || other.status === "paused")) found.push({ goalId: other.id, title: other.title, recordId });
    }
  }
  return found;
}
function link(ctx: GoalsCtx, g: Goal): void {
  ctx.db.run("DELETE FROM goals_link WHERE goal_id = ?", g.id);
  for (const r of g.recordIds) ctx.db.run("INSERT OR IGNORE INTO goals_link (goal_id, record_id) VALUES (?, ?)", g.id, r);
}

function draftPlanOf(ctx: GoalsCtx, g: Goal): PlanChild[] {
  const row = ctx.db.all("SELECT result FROM goals_step WHERE goal_id = ? AND step_id = 'draft:plan'", g.id)[0] as { result?: string } | undefined;
  try { return JSON.parse(row?.result ?? "[]") as PlanChild[]; } catch { return []; }
}
function saveDraftPlan(ctx: GoalsCtx, g: Goal, plan: PlanChild[]): void {
  ctx.db.run("INSERT OR REPLACE INTO goals_step (goal_id, step_id, title, state, result, by, at) VALUES (?, 'draft:plan', 'The drafted plan', 'started', ?, ?, ?)", g.id, JSON.stringify(plan), ctx.principal.id, ctx.now());
}

export async function create(ctx: GoalsCtx, input: In) {
  ensure(ctx.db);
  const owner: string = input.owner ?? (me(ctx).startsWith("usr_") ? me(ctx) : "");
  if (!owner.startsWith("usr_")) raise(ctx, "validation.precondition_failed", "A goal belongs to a person: say who owns it.", { reason: "no_owner" });
  // an agent drafts for the person it works for, never for someone else
  if (owner !== me(ctx) && !isSystem(ctx) && !isAdmin(ctx)) raise(ctx, "validation.precondition_failed", "You can only make a goal for yourself.", { reason: "not_owner" });
  checkFinish(ctx, input.finish as Finish);
  if (input.deadline <= ctx.now()) raise(ctx, "validation.precondition_failed", "The deadline has passed.", { reason: "deadline_past" });
  const agent = await tryCall<{ agent?: { runtime?: string } }>(ctx, "agents.get", { agentId: input.leadAgentId });
  if (ctx.call && !agent?.agent) raise(ctx, "validation.not_found", "That agent does not exist.", { agentId: input.leadAgentId });
  if (agent?.agent?.runtime === "outside") raise(ctx, "validation.precondition_failed", "The lead of a goal works inside Vyre; an outside agent can be a helper.", { reason: "outside_lead" });
  const now = ctx.now();
  const g: Goal = clean({
    id: newGoalId(), title: String(input.title).trim(), outcome: input.outcome, finish: input.finish as Finish, deadline: input.deadline, owner, leadAgentId: input.leadAgentId,
    helpers: (input.helpers ?? []) as Who[], projectId: input.projectId, recordIds: input.recordIds ?? [], budget: input.budget ?? {}, rhythm: input.rhythm ?? { every: "day", at: "09:00" },
    zone: input.zone ?? (await zoneOf(ctx)), quiet: input.quiet === undefined ? QUIET : input.quiet, permissions: checkPermissions(ctx, input.permissions ?? []), status: "draft",
    sourceThreadId: input.sourceThreadId ?? ctx.thread, readFails: 0, checkins: 0, flatCheckins: 0, stuckAfter: input.stuckAfter ?? 3, spentMicros: 0, turns: 0, budgetWarned: false,
    createdBy: ctx.principal.id, createdAt: now, updatedAt: now, version: 0,
  }) as Goal;
  if (g.finish.kind === "checklist") g.finish.items = (g.finish.items ?? []).map((i) => ({ ...i, done: false }));
  saveGoal(ctx, g);
  link(ctx, g);
  const seated: Seat[] = [];
  await ensureThread(ctx, g, seated);
  emit(ctx, g, "goal.created", { title: g.title, owner: g.owner, leadAgentId: g.leadAgentId, status: g.status });
  note(ctx, g.id, "created", `Made by ${ctx.principal.kind === "agent" ? "an agent for the owner" : "the owner"}. Finish line: ${g.finish.line}.`);
  const found = overlaps(ctx, g);
  for (const o of found) note(ctx, g.id, "overlap", `Shares a record with the goal "${o.title}": work on it goes through tasks, one at a time.`, o.goalId);
  // the owner (in the app, or an outside agent under their setup grant) starts it at once; an agent's draft waits for the owner's press on its card
  const plan = (input.plan ?? []) as PlanChild[];
  if (isOwnerPress(ctx, g)) g.permissions = g.permissions.map((p) => ({ ...p, granted: true }));
  if (isOwner(ctx, g) && input.start !== false) await startGoal(ctx, g, { press: isOwnerPress(ctx, g), plan });
  else {
    g.permissions = g.permissions.map((p) => ({ ...p, granted: false }));
    ctx.db.run("INSERT OR REPLACE INTO goals_step (goal_id, step_id, title, state, result, by, at) VALUES (?, 'draft:plan', 'The drafted plan', 'started', ?, ?, ?)", g.id, JSON.stringify(plan), ctx.principal.id, now);
    const where = g.sourceThreadId ?? g.threadId;
    if (where) await tryCall(ctx, "chat.post", {
      threadId: where, body: `Goal drafted: ${g.title}. ${g.finish.line}. Press Start to begin.`, idempotencyKey: `goal-draft:${g.id}`,
      blocks: [{ type: "goal", v: 1, data: clean({ goalId: g.id, threadId: g.threadId ?? where, kind: "draft", title: g.title, line: g.finish.line, status: g.status, deadline: g.deadline, target: g.finish.target, unit: g.finish.unit, plan: plan.map((c) => `${c.title} (${c.why})`), permissions: g.permissions.map((p) => p.label) }) }],
    });
  }
  dispatch(ctx, g);
  saveGoal(ctx, g);
  return { ...out(ctx, g), overlaps: found, seated, plan: { drafted: !LIVE.has(g.status) ? plan.length : 0, attached: LIVE.has(g.status) ? plan.length : 0 } };
}

/** An agent acting for the owner may start a draft when the owner just asked for it in their own words: their message, in this goal's chat, a few minutes old. */
async function ownerAsked(ctx: GoalsCtx, g: Goal, messageId: unknown): Promise<boolean> {
  if (ctx.principal.kind !== "agent" || ctx.actingFor !== g.owner || typeof messageId !== "string") return false;
  for (const threadId of [g.sourceThreadId, g.threadId]) {
    if (!threadId) continue;
    const r = await tryCall<{ message?: { author?: { kind?: string; id?: string }; createdAt?: number } }>(ctx, "chat.message.get", { threadId, messageId });
    const m = r?.message;
    if (m?.author?.kind === "person" && m.author.id === g.owner && typeof m.createdAt === "number" && ctx.now() - m.createdAt <= 15 * 60_000) return true;
  }
  return false;
}

export async function confirm(ctx: GoalsCtx, input: In) {
  const g = visible(ctx, input.goalId);
  if (!isOwner(ctx, g) && !(await ownerAsked(ctx, g, input.messageId))) raise(ctx, "validation.precondition_failed", "Only the owner starts a goal. If the owner just asked you to start it, pass the id of their message; otherwise leave the Start button on the goal card for them.", { reason: "owner_only" });
  if (g.status !== "draft") raise(ctx, "validation.precondition_failed", `This goal is ${g.status} already.`, { reason: "not_draft" });
  const press = isOwnerPress(ctx, g);
  const pick = input.permissions as string[] | undefined;
  g.permissions = g.permissions.map((p) => ({ ...p, granted: press && (pick === undefined || pick.includes(p.label)) }));
  const row = ctx.db.all("SELECT result FROM goals_step WHERE goal_id = ? AND step_id = 'draft:plan'", g.id)[0] as { result?: string } | undefined;
  let plan: PlanChild[] = [];
  try { plan = JSON.parse(row?.result ?? "[]") as PlanChild[]; } catch { plan = []; }
  ctx.db.run("UPDATE goals_step SET state = 'done', done_at = ? WHERE goal_id = ? AND step_id = 'draft:plan'", ctx.now(), g.id);
  await startGoal(ctx, g, { press, plan });
  dispatch(ctx, g);
  saveGoal(ctx, g);
  return out(ctx, g);
}

export async function get(ctx: GoalsCtx, input: In) {
  const g = visible(ctx, input.goalId);
  // the plan as it stands: the goal keeps its tasks' states from their events; each is read again here for its holder and whether it is blocked
  const tasks: Array<Record<string, unknown>> = [];
  for (const t of planTasks(ctx, g.id).slice(0, 60)) {
    const got = (await tryCall<{ task?: { id: string; key?: string; title: string; state: string; assigned?: Who; blocked?: boolean } }>(ctx, "tasks.get", { taskId: t.taskId }))?.task;
    tasks.push(clean({ taskId: t.taskId, key: got?.key ?? t.key, title: got?.title ?? t.title, state: got?.state ?? t.state, assigned: got?.assigned, blocked: got?.blocked === true }));
  }
  return { ...out(ctx, g), tasks, ...(g.status === "draft" ? { draftPlan: draftPlanOf(ctx, g) } : {}), waiting: waits(ctx, g.id), activity: activity(ctx.db, g.id, 30), readings: readings(ctx.db, g.id) };
}

export async function list(ctx: GoalsCtx, input: In) {
  ensure(ctx.db);
  const who = me(ctx);
  let goals: Goal[];
  switch (input.scope) {
    case "mine": goals = allGoals(ctx.db, "owner = ? OR created_by = ?", who, ctx.principal.id); break;
    case "helping": goals = allGoals(ctx.db).filter((g) => g.leadAgentId === ctx.principal.id || g.helpers.some((h) => h.id === who || h.id === ctx.principal.id)); break;
    case "project": goals = input.projectId ? allGoals(ctx.db, "project_id = ?", input.projectId) : []; break;
    case "record": goals = input.recordId ? allGoals(ctx.db, "id IN (SELECT goal_id FROM goals_link WHERE record_id = ?)", input.recordId) : []; break;
    case "task": { const t = input.taskId ? goalOfTask(ctx.db, input.taskId) : undefined; goals = t ? allGoals(ctx.db, "id = ?", t.goalId) : []; break; }
    default: goals = allGoals(ctx.db);
  }
  const seen = goals.filter((g) => {
    try { visible(ctx, g.id); return true; } catch { return false; }
  }).filter((g) => input.open !== true || !ENDED.has(g.status));
  return { goals: seen.map((g) => lineOut(g, taskCounts(ctx, g.id))) };
}

export async function activityList(ctx: GoalsCtx, input: In) {
  const g = visible(ctx, input.goalId);
  return { activity: activity(ctx.db, g.id, input.limit ?? 50, input.before) };
}

export async function update(ctx: GoalsCtx, input: In) {
  const g = visible(ctx, input.goalId);
  mustControl(ctx, g);
  const fields: string[] = [];
  const set = <K extends keyof Goal>(k: K, v: Goal[K] | undefined, name = String(k)): void => { if (v !== undefined) { g[k] = v; fields.push(name); } };
  if (input.finish) { checkFinish(ctx, input.finish as Finish); if (input.finish.kind === "checklist") input.finish.items = input.finish.items.map((i: { id: string; done?: boolean }) => ({ ...i, done: (g.finish.items ?? []).find((o) => o.id === i.id)?.done ?? false })); }
  set("title", input.title?.trim()); set("outcome", input.outcome); set("finish", input.finish); set("deadline", input.deadline); set("rhythm", input.rhythm); set("zone", input.zone);
  set("helpers", input.helpers); set("recordIds", input.recordIds); set("stuckAfter", input.stuckAfter);
  const wasLead = g.leadAgentId, wasOwner = g.owner;
  if (input.leadAgentId !== undefined && input.leadAgentId !== g.leadAgentId) {
    if (ENDED.has(g.status)) raise(ctx, "validation.precondition_failed", `A ${g.status} goal keeps its lead.`, { reason: "ended" });
    const agent = await tryCall<{ agent?: { runtime?: string } }>(ctx, "agents.get", { agentId: input.leadAgentId });
    if (ctx.call && !agent?.agent) raise(ctx, "validation.not_found", "That agent does not exist.", { agentId: input.leadAgentId });
    if (agent?.agent?.runtime === "outside") raise(ctx, "validation.precondition_failed", "The lead of a goal works inside Vyre; an outside agent can be a helper.", { reason: "outside_lead" });
    g.leadAgentId = input.leadAgentId; fields.push("lead");
  }
  if (input.owner !== undefined && input.owner !== g.owner) {
    if (ENDED.has(g.status)) raise(ctx, "validation.precondition_failed", `A ${g.status} goal keeps its owner.`, { reason: "ended" });
    if (!String(input.owner).startsWith("usr_")) raise(ctx, "validation.precondition_failed", "A goal belongs to a person: say who owns it.", { reason: "no_owner" });
    g.owner = input.owner; fields.push("owner");
    // what the old owner allowed does not carry over: the new owner presses Start or grants again
    g.permissions = g.permissions.map((p) => ({ ...p, granted: false }));
  }
  if (input.plan !== undefined) {
    if (g.status !== "draft") raise(ctx, "validation.precondition_failed", "Only a draft has a plan to rewrite; a running goal's steps are its tasks.", { reason: "not_draft" });
    saveDraftPlan(ctx, g, input.plan as PlanChild[]); fields.push("plan");
  }
  if (input.quiet !== undefined) { g.quiet = input.quiet; fields.push("quiet"); }
  if (input.projectId !== undefined) { if (input.projectId === null) delete g.projectId; else g.projectId = input.projectId; fields.push("projectId"); }
  const budgetBefore = g.budget;
  if (input.budget) { g.budget = input.budget; fields.push("budget"); g.budgetWarned = false; }
  let pressGrants = false;
  if (input.permissions) {
    const press = isOwnerPress(ctx, g);
    g.permissions = checkPermissions(ctx, input.permissions).map((p) => ({ ...p, granted: press }));
    fields.push("permissions"); pressGrants = press;
  }
  if (fields.length === 0) return out(ctx, g);
  if (input.deadline !== undefined && input.deadline <= ctx.now()) raise(ctx, "validation.precondition_failed", "The deadline has passed.", { reason: "deadline_past" });
  if ((input.rhythm || input.zone || input.quiet !== undefined) && LIVE.has(g.status)) g.nextCheckinAt = nextCheckin(g, ctx.now());
  if (input.recordIds) link(ctx, g);
  if (input.title && g.folderId) await tryCall(ctx, "files.folder.rename", { folderId: g.folderId, name: g.title.replace(/[/\\]/g, "-").slice(0, 120) });
  if (input.title && g.rootTaskId) await tryCall(ctx, "tasks.update", { taskId: g.rootTaskId, title: g.title });
  let seated: Seat[] | undefined;
  if (g.leadAgentId !== wasLead && g.threadId) {
    if (!g.helpers.some((h) => h.kind === "agent" && h.id === wasLead)) await tryCall(ctx, "threads.remove_agent", { threadId: g.threadId, agentId: wasLead });
    await tryCall(ctx, "threads.add_agent", { threadId: g.threadId, agentId: g.leadAgentId, mode: "lead" });
    if (g.rootTaskId) await tryCall(ctx, "tasks.delegate", { taskId: g.rootTaskId, to: { kind: "agent", id: g.leadAgentId }, note: "The goal has a new lead." });
  }
  if (input.helpers || g.owner !== wasOwner || g.leadAgentId !== wasLead) { seated = await seat(ctx, g); await shareFolder(ctx, g); }
  if (g.owner !== wasOwner) await syncGrants(ctx, g, { press: false });
  emit(ctx, g, "goal.updated", { fields, by: ctx.principal.id });
  note(ctx, g.id, "edit", `Changed ${fields.join(", ")}.`);
  if (input.finish && LIVE.has(g.status)) { delete g.startValue; await readNow(ctx, g, "edit"); }
  if (input.permissions) await syncGrants(ctx, g, { press: pressGrants });
  // a raised budget lets a goal the budget paused go on
  if (input.budget && g.status === "paused" && g.statusReason?.startsWith("The budget is used") && !overBudget(g)) {
    await resumeGoal(ctx, g, "budget_raised");
    note(ctx, g.id, "budget", `Budget raised from ${money(budgetBefore.spendMicros ?? 0)} to ${money(g.budget.spendMicros ?? 0)}.`);
  }
  saveGoal(ctx, g);
  return { ...out(ctx, g), ...(seated ? { seated } : {}) };
}
const overBudget = (g: Goal): boolean => (g.budget.spendMicros !== undefined && g.spentMicros >= g.budget.spendMicros) || (g.budget.turns !== undefined && g.turns >= g.budget.turns);

export async function pause(ctx: GoalsCtx, input: In) {
  const g = visible(ctx, input.goalId);
  mustControl(ctx, g);
  if (!LIVE.has(g.status)) raise(ctx, "validation.precondition_failed", `A ${g.status} goal cannot be paused.`, { reason: "not_live" });
  setStatus(ctx, g, "paused", input.reason ?? "Paused by the owner.");
  await syncGrants(ctx, g);
  saveGoal(ctx, g);
  return out(ctx, g);
}
async function resumeGoal(ctx: GoalsCtx, g: Goal, reason: string): Promise<void> {
  setStatus(ctx, g, waits(ctx, g.id).length > 0 ? "waiting" : planTasks(ctx, g.id).length > 0 ? "active" : "planning");
  if (g.budgetTaskId) { await tryCall(ctx, "tasks.withdraw", { taskId: g.budgetTaskId, note: "The goal goes on." }); delete g.budgetTaskId; }
  g.nextCheckinAt = nextCheckin(g, ctx.now());
  await syncGrants(ctx, g);
  const open = planTasks(ctx, g.id).filter((t) => t.state !== "done" && t.state !== "canceled").map((t) => t.taskId);
  emit(ctx, g, "goal.resumed", { taskIds: open, by: ctx.principal.id });
  queueWake(ctx, g, reason, undefined, `${reason}:${g.id}:${ctx.now()}`);
  dispatch(ctx, g);
}
export async function resume(ctx: GoalsCtx, input: In) {
  const g = visible(ctx, input.goalId);
  mustControl(ctx, g);
  if (g.status !== "paused") raise(ctx, "validation.precondition_failed", "Only a paused goal resumes.", { reason: "not_paused" });
  if (overBudget(g)) raise(ctx, "validation.precondition_failed", `The budget is used (${budgetLine(g)}). Raise it first.`, { reason: "over_budget" });
  await resumeGoal(ctx, g, "resumed");
  saveGoal(ctx, g);
  return out(ctx, g);
}
export async function stop(ctx: GoalsCtx, input: In) {
  const g = visible(ctx, input.goalId);
  mustControl(ctx, g);
  if (ENDED.has(g.status)) raise(ctx, "validation.precondition_failed", `This goal is ${g.status} already.`, { reason: "ended" });
  await endGoal(ctx, g, "stopped", input.reason ? `Stopped: ${input.reason}` : undefined);
  dispatch(ctx, g);
  saveGoal(ctx, g);
  return out(ctx, g);
}
export async function finish(ctx: GoalsCtx, input: In) {
  const g = visible(ctx, input.goalId);
  if (!isOwner(ctx, g) && !isSystem(ctx)) raise(ctx, "validation.precondition_failed", "Only the owner says a goal is done.", { reason: "owner_only" });
  if (ENDED.has(g.status)) raise(ctx, "validation.precondition_failed", `This goal is ${g.status} already.`, { reason: "ended" });
  await endGoal(ctx, g, "done", input.note);
  dispatch(ctx, g);
  saveGoal(ctx, g);
  return out(ctx, g);
}
export async function extend(ctx: GoalsCtx, input: In) {
  const g = visible(ctx, input.goalId);
  mustControl(ctx, g);
  if (input.deadline <= ctx.now()) raise(ctx, "validation.precondition_failed", "Pick a time that has not passed.", { reason: "deadline_past" });
  if (g.status === "done" || g.status === "stopped" || g.status === "draft") raise(ctx, "validation.precondition_failed", `A ${g.status} goal cannot be extended.`, { reason: "not_extendable" });
  g.deadline = input.deadline;
  emit(ctx, g, "goal.extended", { deadline: g.deadline, by: ctx.principal.id });
  note(ctx, g.id, "extended", `Deadline moved to ${when(g.deadline, g.zone)}.`);
  if (g.status === "missed") {
    delete g.ended; delete g.endedAt;
    g.flatCheckins = 0;
    await resumeGoal(ctx, g, "extended");
  }
  if (g.rootTaskId) await tryCall(ctx, "tasks.update", { taskId: g.rootTaskId, due: g.deadline });
  saveGoal(ctx, g);
  return out(ctx, g);
}

export async function progress(ctx: GoalsCtx, input: In) {
  const g = visible(ctx, input.goalId);
  if (input.refresh === true && LIVE.has(g.status) && (g.valueAt === undefined || ctx.now() - g.valueAt >= 60_000)) { await readNow(ctx, g, "asked"); dispatch(ctx, g); saveGoal(ctx, g); }
  return { progress: progressOf(g, taskCounts(ctx, g.id)), readings: readings(ctx.db, g.id) };
}

export async function numberSet(ctx: GoalsCtx, input: In) {
  const g = visible(ctx, input.goalId);
  if (!isOwnerPress(ctx, g)) raise(ctx, "validation.precondition_failed", "Only the owner sets this number, in Vyre.", { reason: "owner_press_only" });
  if (g.finish.kind !== "number" || g.finish.source?.kind !== "manual") raise(ctx, "validation.precondition_failed", "This goal reads its number from a source.", { reason: "not_manual" });
  g.value = input.value;
  await readNow(ctx, g, "owner");
  if (LIVE.has(g.status) && reached(g)) await endGoal(ctx, g, "done");
  dispatch(ctx, g);
  saveGoal(ctx, g);
  return out(ctx, g);
}
export async function checklistTick(ctx: GoalsCtx, input: In) {
  const g = visible(ctx, input.goalId);
  if (!isOwnerPress(ctx, g)) raise(ctx, "validation.precondition_failed", "Only the owner ticks a condition, in Vyre.", { reason: "owner_press_only" });
  const item = (g.finish.items ?? []).find((i) => i.id === input.itemId);
  if (g.finish.kind !== "checklist" || !item) raise(ctx, "validation.not_found", "That condition does not exist.");
  item.done = input.done === true;
  note(ctx, g.id, "checklist", `${item.done ? "Done" : "Not done"}: ${item.text}`);
  emit(ctx, g, "goal.progress", { ok: true, value: (g.finish.items ?? []).filter((i) => i.done).length, target: (g.finish.items ?? []).length });
  if (LIVE.has(g.status) && reached(g)) await endGoal(ctx, g, "done");
  dispatch(ctx, g);
  saveGoal(ctx, g);
  return out(ctx, g);
}

/** The lead (or the owner) adds steps to the plan. Every step says why. */
export async function plan(ctx: GoalsCtx, input: In) {
  const g = visible(ctx, input.goalId);
  // the agent that drafted a goal may add to its plan before the owner presses Start
  const drafter = g.status === "draft" && g.createdBy === ctx.principal.id;
  if (!isLead(ctx, g) && !isOwner(ctx, g) && !isSystem(ctx) && !drafter) raise(ctx, "validation.precondition_failed", "The lead agent or the owner plans this goal.", { reason: "not_lead" });
  if (g.status === "draft") {
    // a draft has no tasks yet: the steps join the drafted plan and become tasks when the owner presses Start
    const incoming = input.children as PlanChild[];
    const keys = new Set(incoming.map((c) => c.key));
    const drafted = [...draftPlanOf(ctx, g).filter((c) => !keys.has(c.key)), ...incoming];
    saveDraftPlan(ctx, g, drafted);
    note(ctx, g.id, "plan", `Added ${incoming.length} step${incoming.length === 1 ? "" : "s"} to the drafted plan. They become tasks when the owner starts the goal.`);
    saveGoal(ctx, g);
    return { tasks: [], drafted: drafted.length };
  }
  if (!LIVE.has(g.status)) raise(ctx, "validation.precondition_failed", `A ${g.status} goal takes no new tasks.`, { reason: "not_live" });
  const tasks = await addPlan(ctx, g, input.children as PlanChild[]);
  saveGoal(ctx, g);
  return { tasks };
}

/** The check-in: the number in it is the goal's own reading, never the agent's. */
export async function report(ctx: GoalsCtx, input: In) {
  const g = visible(ctx, input.goalId);
  if (!isLead(ctx, g) && !isOwner(ctx, g)) raise(ctx, "validation.precondition_failed", "The lead agent posts the check-ins of this goal.", { reason: "not_lead" });
  const wake = input.wakeId ? wakeById(ctx.db, input.wakeId) : openWake(ctx.db, g.id);
  const key = wake ? `report:${wake.id}` : `report:${g.checkins}:${ctx.now()}`;
  const prev = (ctx.db.all("SELECT value FROM goals_reading WHERE goal_id = ? AND ok = 1 AND value IS NOT NULL AND at <= ? ORDER BY at DESC LIMIT 1", g.id, g.lastCheckinAt ? g.lastCheckinAt - 1 : 0)[0] as { value?: number } | undefined)?.value;
  const messageId = await post(ctx, g, `${numberLine(g)}. ${input.summary}`, key, clean({
    kind: "update", summary: input.summary, done: input.done, next: input.next, value: g.finish.kind === "number" ? g.value : undefined, prev, target: g.finish.target, unit: g.finish.unit,
    needs: waits(ctx, g.id).map((w) => w.title),
  }));
  // a check-in answers every wake-up that is out: a wake that arrived while the lead was already working is covered by the turn that was running
  ctx.db.run("UPDATE goals_wake SET state = 'reported', reported_at = ? WHERE goal_id = ? AND state IN ('sent', 'claimed')", ctx.now(), g.id);
  emit(ctx, g, "goal.reported", { wakeId: wake?.id, by: ctx.principal.id }, key);
  note(ctx, g.id, "report", input.summary, messageId);
  dispatch(ctx, g);
  saveGoal(ctx, g);
  return clean({ posted: messageId !== undefined, messageId, value: g.value });
}

/** One Waiting-on item per decision: the same decision asked again answers what the first ask got. */
export async function ask(ctx: GoalsCtx, input: In) {
  const g = visible(ctx, input.goalId);
  if (!isLead(ctx, g) && !isHelper(ctx, g)) raise(ctx, "validation.precondition_failed", "The agents of this goal ask its questions.", { reason: "not_lead" });
  const step = `ask:${String(input.decision).toLowerCase().replace(/[^a-z0-9_-]+/g, "-")}`;
  const row = ctx.db.all("SELECT result FROM goals_step WHERE goal_id = ? AND step_id = ?", g.id, step)[0] as { result?: string } | undefined;
  if (row?.result) {
    const t = await tryCall<{ task?: { state?: string; workingNotes?: Record<string, string> } }>(ctx, "tasks.get", { taskId: row.result });
    return clean({ taskId: row.result, asked: false, answer: t?.task?.workingNotes?.["answer"] ?? t?.task?.workingNotes?.["outputs"] });
  }
  const to = input.to ?? g.owner;
  const r = await tryCall<{ task?: { id?: string } }>(ctx, "tasks.create", {
    kind: "answer", title: `${g.title}: ${String(input.question).slice(0, 100)}`, summary: input.question, assigned: { kind: "person", id: to },
    ...(input.options?.length ? { blocks: [{ type: "question", data: { prompt: input.question, mode: "single", options: input.options.map((o: string) => ({ label: o, value: o })), allowOther: true } }] } : {}),
    notes: { "goal.id": g.id, "goal.title": g.title, "goal.decision": step }, idempotencyKey: `goal-ask:${g.id}:${step}`,
  });
  if (!r?.task?.id) raise(ctx, "validation.precondition_failed", "The question could not be asked; say it in the goal chat instead.", { reason: "ask_failed" });
  ctx.db.run("INSERT OR IGNORE INTO goals_step (goal_id, step_id, title, state, result, by, at) VALUES (?, ?, ?, 'done', ?, ?, ?)", g.id, step, input.question, r.task.id, ctx.principal.id, ctx.now());
  addTask(ctx.db, g.id, r.task.id, "ask");
  addWait(ctx, g, { id: r.task.id, kind: "answer", title: input.question, assigned: { kind: "person", id: to } });
  saveGoal(ctx, g);
  return { taskId: r.task.id, asked: true };
}

export async function markStuck(ctx: GoalsCtx, input: In) {
  const g = visible(ctx, input.goalId);
  if (!isLead(ctx, g) && !isOwner(ctx, g)) raise(ctx, "validation.precondition_failed", "The lead agent says when this goal is stuck.", { reason: "not_lead" });
  if (!LIVE.has(g.status)) raise(ctx, "validation.precondition_failed", `A ${g.status} goal cannot be stuck.`, { reason: "not_live" });
  if (g.status === "stuck" && g.stuckTaskId) return out(ctx, g);
  await stuck(ctx, g, input.reason, input.options);
  saveGoal(ctx, g);
  return out(ctx, g);
}

/** The retrospective. An owner-says-done goal whose work is finished asks the owner instead of ending itself. */
export async function complete(ctx: GoalsCtx, input: In) {
  const g = visible(ctx, input.goalId);
  if (!isLead(ctx, g) && !isOwner(ctx, g)) raise(ctx, "validation.precondition_failed", "The lead agent writes the retrospective.", { reason: "not_lead" });
  const retro = input.retro as Retro;
  if (!ENDED.has(g.status)) {
    if (g.finish.kind !== "owner") raise(ctx, "validation.precondition_failed", `The goal is not over: ${numberLine(g)}. It ends when the source says so or at the deadline.`, { reason: "not_ended" });
    const r = await ask(ctx, { goalId: g.id, decision: "owner-done", question: `Is "${g.title}" done? ${retro.summary}`, options: ["Yes, it is done", "Not yet"] });
    return { saved: false, askedOwner: true, taskId: r.taskId };
  }
  g.retro = retro;
  note(ctx, g.id, "retro", `Retrospective: ${retro.summary}`);
  const text = [`# Retrospective: ${g.title}`, "", `${g.ended === "done" ? "Done" : g.ended === "missed" ? "Missed" : "Stopped"}. ${g.summary ?? ""}`, "", retro.summary, "",
    "## What worked", ...retro.worked.map((w) => `- ${w}`), "", "## What did not", ...retro.didNot.map((w) => `- ${w}`), ...(retro.playbook ? ["", "## Playbook", retro.playbook] : [])].join("\n");
  const reports = await ensureFolder(ctx, g, "Reports");
  if (reports) await tryCall(ctx, "files.create", { folderId: reports, name: "Retrospective.md", content: { text }, mime: "text/markdown", idempotencyKey: `goal-retro:${g.id}` });
  const memo = `Goal "${g.title}" (${g.ended}): ${retro.summary} Worked: ${retro.worked.join("; ")}. Did not: ${retro.didNot.join("; ")}.`;
  await tryCall(ctx, "memory.remember", clean({ text: memo, layer: "space", kind: "retrospective", threadId: g.threadId }));
  if (g.projectId) await tryCall(ctx, "memory.remember", { text: memo, layer: "project", projectId: g.projectId, kind: "retrospective" });
  const wake = openWake(ctx.db, g.id);
  if (wake) ctx.db.run("UPDATE goals_wake SET state = 'reported', reported_at = ? WHERE id = ?", ctx.now(), wake.id);
  await post(ctx, g, `Retrospective: ${retro.summary}${retro.playbook ? " A playbook is in Reports; say so and it becomes a skill." : ""}`, "retro");
  emit(ctx, g, "goal.reported", { wakeId: wake?.id, by: ctx.principal.id }, `retro:${g.id}`);
  saveGoal(ctx, g);
  return { saved: true, askedOwner: false };
}

export async function searchPast(ctx: GoalsCtx, input: In) {
  const q = String(input.query ?? "").toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const past = allGoals(ctx.db, "status IN ('done', 'missed', 'stopped')").filter((g) => { try { visible(ctx, g.id); return true; } catch { return false; } });
  const score = (g: Goal): number => q.reduce((n, w) => n + (`${g.title} ${g.finish.line} ${g.retro?.summary ?? ""}`.toLowerCase().includes(w) ? 1 : 0), 0);
  const ranked = past.map((g) => ({ g, s: score(g) })).filter((x) => q.length === 0 || x.s > 0).sort((a, b) => b.s - a.s || (b.g.endedAt ?? 0) - (a.g.endedAt ?? 0)).slice(0, input.limit ?? 5);
  return { goals: ranked.map(({ g }) => clean({ goalId: g.id, title: g.title, line: g.finish.line, ended: g.ended, value: g.value, target: g.finish.target, endedAt: g.endedAt, retro: g.retro })) };
}

export async function sources(ctx: GoalsCtx, input: In) {
  const types = (await tryCall<{ types?: Array<{ key: string; title?: string }> }>(ctx, "schema.describe", {}))?.types ?? [];
  const records: Array<{ type: string; title: string; count?: number }> = [];
  for (const t of types.slice(0, 25)) {
    const c = await tryCall<{ count?: number }>(ctx, "records.counts", { type: t.key });
    records.push({ type: t.key, title: t.title ?? t.key, ...(c?.count !== undefined ? { count: c.count } : {}) });
  }
  const cons = (await tryCall<{ connections?: Array<Record<string, unknown>> }>(ctx, "connections.list", { whose: "all", limit: 100 }))?.connections ?? [];
  const connections = cons.map((c) => ({ connectionId: String(c["connectionId"] ?? c["id"] ?? ""), connector: String(c["connector"] ?? c["key"] ?? ""), name: String(c["name"] ?? c["label"] ?? c["connector"] ?? "") })).filter((c) => c.connectionId !== "");
  const mcp: Array<{ server: string; tools: string[] }> = [];
  if (input.leadAgentId) {
    const tools = (await tryCall<{ tools?: Array<{ server?: string; name?: string; readOnly?: boolean }> }>(ctx, "engine.mcp.tools", { agentId: input.leadAgentId }))?.tools ?? [];
    for (const t of tools) {
      if (!t.server || !t.name) continue;
      const row = mcp.find((m) => m.server === t.server) ?? (mcp.push({ server: t.server, tools: [] }), mcp[mcp.length - 1]!);
      row.tools.push(t.name);
    }
  }
  return { records, connections, mcp };
}

/** Claim a step before an act; a step done before answers its result, so a retried wake never repeats it. */
export async function step(ctx: GoalsCtx, input: In) {
  const g = visible(ctx, input.goalId);
  if (!isLead(ctx, g) && !isHelper(ctx, g) && !isOwner(ctx, g)) raise(ctx, "validation.precondition_failed", "Only the goal's agents and owner take its steps.", { reason: "not_on_goal" });
  const stepId = String(input.stepId);
  if (stepId.startsWith("ask:") || stepId.startsWith("draft:")) raise(ctx, "validation.precondition_failed", "That step id is kept for the goal itself.", { reason: "reserved" });
  const idempotencyKey = `goal:${g.id}:step:${stepId}`;
  const row = ctx.db.all("SELECT state, result FROM goals_step WHERE goal_id = ? AND step_id = ?", g.id, stepId)[0] as { state?: string; result?: string } | undefined;
  if (row?.state === "done") return clean({ state: "already_done" as const, result: row.result ?? undefined, idempotencyKey });
  if (input.finish === true) {
    ctx.db.run("INSERT INTO goals_step (goal_id, step_id, title, state, result, by, at, done_at) VALUES (?, ?, ?, 'done', ?, ?, ?, ?) ON CONFLICT (goal_id, step_id) DO UPDATE SET state = 'done', result = excluded.result, done_at = excluded.done_at",
      g.id, stepId, input.title ?? null, input.result ?? null, ctx.principal.id, ctx.now(), ctx.now());
    emit(ctx, g, "goal.step_done", { stepId, by: ctx.principal.id }, `step:${g.id}:${stepId}`);
    note(ctx, g.id, "step", `Done: ${input.title ?? stepId}${input.result ? `. ${String(input.result).slice(0, 200)}` : ""}`, stepId);
    saveGoal(ctx, g);
    return clean({ state: "done" as const, result: input.result, idempotencyKey });
  }
  if (!row) {
    ctx.db.run("INSERT INTO goals_step (goal_id, step_id, title, state, by, at) VALUES (?, ?, ?, 'started', ?, ?)", g.id, stepId, input.title ?? null, ctx.principal.id, ctx.now());
    note(ctx, g.id, "step", `Started: ${input.title ?? stepId}`, stepId);
    saveGoal(ctx, g);
  }
  return { state: "started" as const, idempotencyKey };
}

export async function folder(ctx: GoalsCtx, input: In) {
  const g = visible(ctx, input.goalId);
  if (!isLead(ctx, g) && !isHelper(ctx, g) && !isOwner(ctx, g) && !isSystem(ctx)) raise(ctx, "validation.precondition_failed", "Only the people and agents of this goal use its folder.", { reason: "not_on_goal" });
  const id = await ensureFolder(ctx, g, input.sub);
  saveGoal(ctx, g);
  if (!id) raise(ctx, "validation.precondition_failed", "The goal's folder could not be made; try again in a minute.", { reason: "no_folder" });
  return { folderId: id, path: `Goals/${g.title}${input.sub ? `/${input.sub}` : ""}` };
}

// ---- what the lead reads at each wake-up ----

export async function brief(ctx: GoalsCtx, input: In) {
  const g = visible(ctx, input.goalId);
  return { text: briefText(ctx, g) };
}
export function briefText(ctx: GoalsCtx, g: Goal): string {
  const now = ctx.now();
  const f = g.finish;
  const p = progressOf(g, taskCounts(ctx, g.id));
  const out: string[] = [];
  out.push(`${g.title} (goalId ${g.id}). Status: ${g.status}${g.statusReason ? ` (${g.statusReason})` : ""}.`);
  out.push(`Finish line: ${f.line}.${g.outcome ? ` Outcome wanted: ${g.outcome}.` : ""}`);
  const left = g.deadline - now;
  out.push(`Deadline: ${when(g.deadline, g.zone)} (${left > 0 ? `${Math.floor(left / 3_600_000)} hours left` : "passed"}).`);
  out.push(`The owner's time now: ${when(now, g.zone)} (${g.zone}). Write every time in check-ins, summaries and the retrospective in this zone, as the owner reads it, never in UTC.`);
  if (f.kind === "number") {
    const pace = paceOf(g, now);
    out.push(`The number, read by Vyre from ${sourceWords(f.source)}: ${g.value ?? "not read yet"}${f.target !== undefined ? ` of ${f.target}` : ""}${f.unit ? ` ${f.unit}` : ""}${p.percent !== undefined ? ` (${p.percent}%)` : ""}${g.valueAt ? `, read ${when(g.valueAt, g.zone)}` : ""}.${pace ? ` ${pace}` : ""}`);
    if (g.readError) out.push(`The source could not be read: ${g.readError}. Say so in your check-in; do not guess the number.`);
  } else if (f.kind === "checklist") out.push(`Conditions:\n${(f.items ?? []).map((i) => `- [${i.done ? "x" : " "}] ${i.text}${i.taskId ? ` (done when task ${i.taskId} is done)` : ""}`).join("\n")}`);
  else out.push("The owner says when it is done. When the work is finished, call goals_complete and it asks them.");
  const wake = openWake(ctx.db, g.id);
  if (wake) out.push(`You were woken because: ${reasonWords(wake.reason)}${wake.detail ? `\n${wake.detail}` : ""}\nwakeId ${wake.id}. End this turn with goals_checkin_post {goalId, wakeId, summary, done, next}${wake.reason.includes("ended") ? ", after goals_complete with the retrospective" : ""}.`);
  const tasks = planTasks(ctx, g.id);
  out.push(tasks.length ? `The plan (tasks under the goal, ${p.tasksDone} of ${p.tasks} done):\n${tasks.slice(0, 25).map((t) => `- ${t.key ? `${t.key} ` : ""}${t.title} [${t.state}] (taskId ${t.taskId})`).join("\n")}` : "There is no plan yet. Research first (see your skill), then make it with goals_plan_update.");
  const w = waits(ctx, g.id);
  if (w.length) out.push(`Waiting on people:\n${w.map((x) => `- ${x.title} (taskId ${x.taskId}, since ${when(x.since, g.zone)})`).join("\n")}\nDo not ask again for what is waiting.`);
  if (g.helpers.length) out.push(`Helpers: ${g.helpers.map((h) => `${h.kind} ${h.id}`).join(", ")}.`);
  const granted = g.permissions.filter((x) => x.granted), pending = g.permissions.filter((x) => !x.granted);
  out.push(granted.length ? `Standing permissions (these acts go without asking, in this goal's chats only): ${granted.map((x) => x.label).join("; ")}.` : "No standing permissions: every outward act is held for the owner's approval.");
  if (pending.length) out.push(`Not granted yet (held for approval): ${pending.map((x) => x.label).join("; ")}.`);
  out.push(`Budget: ${budgetLine(g)}. Quiet hours ${g.quiet ? `${g.quiet.from} to ${g.quiet.to}` : "none"}: no messages to people then.`);
  const others = ctx.db.all("SELECT DISTINCT l2.goal_id AS id FROM goals_link l1 JOIN goals_link l2 ON l1.record_id = l2.record_id AND l2.goal_id <> l1.goal_id WHERE l1.goal_id = ?", g.id) as Array<{ id: string }>;
  const live = others.map((o) => getGoal(ctx.db, o.id)).filter((o): o is Goal => !!o && LIVE.has(o.status));
  if (live.length) out.push(`Records this goal shares with other goals: ${live.map((o) => `"${o.title}"`).join(", ")}. Change those records through tasks, never directly.`);
  const steps = ctx.db.all("SELECT step_id, state FROM goals_step WHERE goal_id = ? AND step_id NOT LIKE 'draft:%' ORDER BY at DESC LIMIT 15", g.id) as Array<{ step_id: string; state: string }>;
  if (steps.length) out.push(`Steps already taken (never repeat a done one): ${steps.map((s) => `${s.step_id} (${s.state})`).join(", ")}.`);
  if (g.folderId) out.push(`The goal's folder in Files: folderId ${g.folderId}. Save drafts, research, exports and reports there (goals_folder gives a subfolder).`);
  return out.join("\n\n");
}
/** On pace or not: where a straight line from the start to the target says the number should be now. */
export function paceOf(g: Goal, now: number): string | undefined {
  const f = g.finish;
  if (f.kind !== "number" || f.target === undefined || g.value === undefined || g.startValue === undefined || now >= g.deadline) return undefined;
  const span = g.deadline - g.createdAt;
  if (span <= 0) return undefined;
  const expected = g.startValue + (f.target - g.startValue) * Math.min(1, (now - g.createdAt) / span);
  const ahead = f.direction === "down" ? g.value <= expected : g.value >= expected;
  return `On a straight line it would be about ${Math.round(expected)} now: ${ahead ? "on pace" : "behind pace"}.`;
}

// ---- system ----

export async function wakeClaim(ctx: GoalsCtx, input: In) {
  if (!isSystem(ctx)) raise(ctx, "validation.precondition_failed", "Only the server claims a wake-up.", { reason: "system_only" });
  const g = getGoal(ctx.db, input.goalId);
  const w = wakeById(ctx.db, input.wakeId);
  if (!g || !w || w.goalId !== g.id) return { claimed: false };
  const okStatus = LIVE.has(g.status) || (ENDED.has(g.status) && w.reason.split(",").includes("ended"));
  if (!okStatus) { ctx.db.run("UPDATE goals_wake SET state = 'dropped' WHERE id = ?", w.id); return { claimed: false }; }
  const won = ctx.db.run("UPDATE goals_wake SET state = 'claimed', claimed_at = ? WHERE id = ? AND state = 'sent' AND attempt = ?", ctx.now(), w.id, input.attempt).changes > 0;
  return won ? clean({ claimed: true, threadId: g.threadId, leadAgentId: g.leadAgentId, owner: g.owner }) : { claimed: false };
}
export async function go(ctx: GoalsCtx, input: In) {
  const g = getGoal(ctx.db, input.goalId);
  return g ? { go: LIVE.has(g.status), status: g.status } : { go: true };
}

