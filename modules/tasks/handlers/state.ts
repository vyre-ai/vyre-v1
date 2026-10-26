// Tasks state machine and the capabilities that change or read a task (ARCH 4.7, spec 2.8, 4.1, 4.2).
// `tasks.transition` is the only writer of the status field; `tasks.act` (handlers/act.ts) and the Gate reach the same applyMove. The table of 4.7 lives in planMove.
// Group and role slots: the pipeline authorizes the call at level use on the task, so holders pass; the first Take locks the task to one person (tasks.take).
import { isTrustedService } from "../../../lib/trust.ts";
import {
  actionableByMe, allTasks, clean, emitTask, findTask, getTask, historyOf, holds, isBlocked, isOpen, isRequest, listTasks, myWork, needsYou, newTaskId, openIndex,
  out, page, raise, readPolicy, sameAssignee, toOut, touch, visibleTo, whoIs,
} from "../projections.ts";
import type {
  ActionDef, Assignee, Block, ListFilter, Policy, Section, Slot, Task, TaskKind, TaskSource, TaskState, TasksCtx, Who,
} from "../projections.ts";

// ---- kinds (mirror of manifests/tasks.ts taskKinds; the manifest is frozen, ruling 9) ----

export const INITIAL_STATE: Record<TaskKind, TaskState> = {
  work: "todo", approve: "awaiting_approval", review: "in_review", answer: "todo", unblock: "todo", signature: "doing",
};
export const KIND_ACTIONS: Record<TaskKind, ActionDef[]> = {
  work: [],
  approve: [{ key: "approve", label: "Approve", note: "optional" }, { key: "reject", label: "Send back", note: "required" }],
  review: [{ key: "approve", label: "Looks good", note: "optional" }, { key: "send_back", label: "Send back", note: "required" }],
  answer: [{ key: "answer", label: "Answer", note: "optional" }, { key: "dismiss", label: "Dismiss", note: "optional" }],
  unblock: [{ key: "resolved", label: "Done, continue", note: "optional" }, { key: "cannot", label: "Can't do this", note: "required" }],
  signature: [],
};

// ---- the 4.7 table ----

export type MoveAction = "start" | "submit" | "approve_review" | "send_back" | "approve" | "reject" | "cancel" | "reopen";
type Actor = Slot | "creator" | "responsible";
export interface Move { action: MoveAction; to: TaskState; actors: readonly Actor[]; noteRequired: boolean }
export type Plan = { ok: true; move: Move } | { ok: false; why: string };

const mv = (action: MoveAction, to: TaskState, actors: readonly Actor[], noteRequired = false): Plan => ({ ok: true, move: { action, to, actors, noteRequired } });
const no = (why: string): Plan => ({ ok: false, why });

/** Where does "submit" lead for this task: In review when it has a reviewer, else Awaiting approval when it has an approver, else Done. */
export function submitTarget(t: Pick<Task, "reviewer" | "approver">): TaskState {
  return t.reviewer ? "in_review" : t.approver ? "awaiting_approval" : "done";
}
/** Where does approving a review lead: Awaiting approval when there is an approver, else Done. */
export function afterReview(t: Pick<Task, "approver">): TaskState {
  return t.approver ? "awaiting_approval" : "done";
}

export function planMove(t: Pick<Task, "state" | "reviewer" | "approver">, to: TaskState): Plan {
  const from = t.state;
  if (from === to) return no(`The task is already ${label(to)}.`);
  if (to === "canceled") return isOpen(from) ? mv("cancel", "canceled", ["assigned", "reviewer", "approver", "creator", "responsible"]) : no("A finished task cannot be canceled.");
  if (!isOpen(from)) return to === "todo" ? mv("reopen", "todo", ["assigned", "creator"]) : no(`A ${label(from)} task can only be reopened.`);
  switch (from) {
    case "todo":
    case "doing": {
      if (to === "doing") return from === "todo" ? mv("start", "doing", ["assigned"]) : no("The task is already being worked on.");
      if (to === "todo") return no("A started task cannot go back to To do.");
      if (to === submitTarget(t)) return mv("submit", to, ["assigned"]);
      if (to === "in_review") return no("The task has no reviewer.");
      if (to === "awaiting_approval") return t.reviewer ? no("The reviewer comes before the approver.") : no("The task has no approver.");
      return no(t.reviewer || t.approver ? "The task needs its review and approval before it is Done." : "That move is not allowed.");
    }
    case "in_review": {
      if (to === "doing") return mv("send_back", "doing", ["reviewer"], true);
      if (to === afterReview(t)) return mv("approve_review", to, ["reviewer"]);
      return no("A task in review is approved, sent back or canceled.");
    }
    case "awaiting_approval": {
      if (to === "done") return mv("approve", "done", ["approver"]);
      if (to === "doing") return mv("reject", "doing", ["approver"], true);
      return no("A task awaiting approval is approved, sent back or canceled.");
    }
    default:
      return no("That move is not allowed.");
  }
}

const LABELS: Record<TaskState, string> = { todo: "To do", doing: "Doing", in_review: "In review", awaiting_approval: "Awaiting approval", done: "Done", canceled: "Canceled" };
export const label = (s: TaskState): string => LABELS[s];

function mayAct(t: Task, move: Move, who: Who): boolean {
  if (isTrustedService(who)) return true;
  const me = (id: string | undefined): boolean => id !== undefined && (id === who.id || id === who.actingFor);
  return move.actors.some((a) => (a === "creator" ? me(t.createdBy) : a === "responsible" ? me(t.responsible) : holds(t, a, who)));
}

const isAgentLike = (k: string): boolean => k === "agent" || k === "automation";

export interface Applied { task: Task; move: Move; from: TaskState; /** a group or role request closed by this call: the first action wins and others see "handled by" */ handled: boolean }
export interface Checked { move: Move; note: string | undefined }

/** Check a move against the table of 4.7: the state, the actor, the note, the review-loop limit and the self-review and human-approver policies. Writes nothing,
 *  so tasks.act can check first, release a held act, and only then commit. */
export function checkMove(ctx: TasksCtx, t: Task, to: TaskState, o: { note?: string | undefined; expectedFrom?: TaskState | undefined } = {}, policy: Policy = readPolicy(ctx.db)): Checked {
  const who = whoIs(ctx);
  if (o.expectedFrom !== undefined && o.expectedFrom !== t.state) raise(ctx, "validation.precondition_failed", `The task is ${label(t.state)} now, not ${label(o.expectedFrom)}.`, { reason: "stale_state", state: t.state });
  const plan = planMove(t, to);
  if (!plan.ok) raise(ctx, "validation.precondition_failed", plan.why, { reason: "illegal_transition", from: t.state, to });
  const move = plan.move;
  if (!mayAct(t, move, who)) raise(ctx, "validation.precondition_failed", "Only the person this step belongs to can do that.", { reason: "wrong_actor", action: move.action });
  const note = o.note?.trim();
  if (move.noteRequired && !note) raise(ctx, "validation.precondition_failed", "Add a note so the sender knows what to change.", { reason: "note_required", action: move.action });
  const judging = move.action === "approve_review" || move.action === "approve" || move.action === "send_back" || move.action === "reject";
  if (judging && !isTrustedService(who)) {
    if (t.kind === "work" && !policy.allowSelfReview && holds(t, "assigned", who) && (t.assigned.kind === "person" || t.assigned.kind === "agent")) {
      raise(ctx, "validation.precondition_failed", "You cannot review or approve your own work.", { reason: "self_review" });
    }
    if ((move.action === "approve" || move.action === "approve_review") && policy.requireHumanApprover && ctx.principal.kind !== "person") {
      raise(ctx, "validation.precondition_failed", "This Space needs a person to approve.", { reason: "human_approver_required" });
    }
  }
  if (move.action === "send_back" && isAgentLike(ctx.principal.kind) && t.reviewLoops >= policy.reviewLoopLimit) {
    raise(ctx, "validation.precondition_failed", `Work was sent back ${t.reviewLoops} times already. A person decides now.`, { reason: "review_loop_limit", limit: policy.reviewLoopLimit });
  }
  return { move, note };
}

/** Write a checked move and emit its events. */
export function commitMove(ctx: TasksCtx, t: Task, to: TaskState, c: Checked): Applied {
  const { move, note } = c;
  const from = t.state;
  const slot = from === "todo" || from === "doing" ? "assigned" : from === "in_review" ? "reviewer" : from === "awaiting_approval" ? "approver" : null;
  const addressed = slot ? t[slot] : undefined;
  t.state = to;
  if (move.action === "send_back") t.reviewLoops += 1;
  if (move.action === "reopen") { t.reviewLoops = 0; delete t.takenBy; delete t.takenAt; delete t.handledBy; delete t.handledAt; }
  let handled = false;
  if (!isOpen(to)) {
    delete t.snoozedUntil;
    if (addressed && (addressed.kind === "group" || addressed.kind === "role") && isRequest(t.kind)) { t.handledBy = ctx.principal.id; t.handledAt = ctx.now(); handled = true; }
  }
  touch(ctx, ctx.db, t);

  const by = ctx.principal.id;
  const hist = (type: string): { type: string; by: string; note?: string } => clean({ type, by, note });
  emitTask(ctx, ctx.db, "task.transitioned", t, { kind: t.kind, from, to, note }, hist("transitioned"));
  if (to === "done") emitTask(ctx, ctx.db, "task.completed", t, { kind: t.kind, recordId: t.recordId, source: t.source }, hist("completed"));
  if (move.action === "send_back") emitTask(ctx, ctx.db, "task.sent_back", t, { by, note: note ?? "", reviewLoops: t.reviewLoops }, hist("sent_back"));
  if (move.action === "reject") emitTask(ctx, ctx.db, "task.rejected", t, { by, note: note ?? "" }, hist("rejected"));
  if (move.action === "approve" || move.action === "approve_review") emitTask(ctx, ctx.db, "task.approved", t, { kind: t.kind, by, forPerson: ctx.actingFor }, hist("approved"));
  return { task: t, move, from, handled };
}

export function applyMove(ctx: TasksCtx, t: Task, to: TaskState, o: { note?: string | undefined; expectedFrom?: TaskState | undefined } = {}, policy: Policy = readPolicy(ctx.db)): Applied {
  return commitMove(ctx, t, to, checkMove(ctx, t, to, o, policy));
}

// ---- helpers shared by the capabilities ----

type In = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
const asAssignee = (v: unknown): Assignee => v as Assignee;
const nonEmpty = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0;

function checkAssignee(ctx: TasksCtx, a: Assignee | undefined, what: string): void {
  if (a && !nonEmpty(a.id)) raise(ctx, "validation.precondition_failed", `The ${what} needs an id.`, { reason: "bad_assignee" });
}

function checkSlots(ctx: TasksCtx, kind: TaskKind, s: { assigned: Assignee; reviewer?: Assignee | undefined; approver?: Assignee | undefined }, policy: Policy): void {
  checkAssignee(ctx, s.assigned, "assignee"); checkAssignee(ctx, s.reviewer, "reviewer"); checkAssignee(ctx, s.approver, "approver");
  if (kind === "work" && !policy.allowSelfReview && (sameAssignee(s.reviewer, s.assigned) || sameAssignee(s.approver, s.assigned))) {
    raise(ctx, "validation.precondition_failed", "The reviewer and the approver cannot be the person doing the work.", { reason: "self_review" });
  }
  if (s.approver && policy.requireHumanApprover && (s.approver.kind === "agent" || s.approver.kind === "automation")) {
    raise(ctx, "validation.precondition_failed", "This Space needs a person to approve.", { reason: "human_approver_required" });
  }
}

/** The person responsible for an agent: its owner, so a stuck or unanswered agent task has someone to land on. */
async function responsibleFor(ctx: TasksCtx, a: Assignee): Promise<string | undefined> {
  if (a.kind !== "agent" || !ctx.call) return undefined;
  try {
    const r = (await ctx.call("access.principals.get", { principal: { kind: "agent", id: a.id } })) as { principal?: { owner?: unknown } } | null;
    const owner = r?.principal?.owner;
    return typeof owner === "string" && owner.length > 0 ? owner : undefined;
  } catch { return undefined; }
}

function holderOf(t: Pick<Task, "kind" | "assigned" | "reviewer" | "approver">): Assignee {
  return t.kind === "approve" && t.approver ? t.approver : t.kind === "review" && t.reviewer ? t.reviewer : t.assigned;
}

function reachable(db: TasksCtx["db"], from: string, target: string, seen = new Set<string>()): boolean {
  if (from === target) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  const t = findTask(db, from);
  return !!t && t.dependsOn.some((d) => reachable(db, d, target, seen));
}

// ---- capabilities ----

export async function create(ctx: TasksCtx, input: In): Promise<unknown> {
  const policy = readPolicy(ctx.db);
  const kind: TaskKind = input.kind ?? "work";
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) raise(ctx, "validation.precondition_failed", "A task needs a title.", { reason: "title_required" });
  const assigned = asAssignee(input.assigned);
  let reviewer: Assignee | undefined = input.reviewer ? asAssignee(input.reviewer) : undefined;
  let approver: Assignee | undefined = input.approver ? asAssignee(input.approver) : undefined;
  // an Approve request is addressed to its approver and a Review request to its reviewer; the Gate puts the resolved approver in the slot
  if (kind === "approve" && !approver) approver = assigned;
  if (kind === "review" && !reviewer) reviewer = assigned;
  checkSlots(ctx, kind, { assigned, reviewer, approver }, policy);

  const known = new Set(KIND_ACTIONS[kind].map((a) => a.key));
  const actions: ActionDef[] = (input.actions as ActionDef[] | undefined) ?? KIND_ACTIONS[kind].map((a) => ({ ...a }));
  for (const a of actions) if (!known.has(a.key)) raise(ctx, "validation.precondition_failed", `A ${kind} task has no action called ${a.key}.`, { reason: "unknown_action", action: a.key });

  const dependsOn: string[] = [...new Set<string>(input.dependsOn ?? [])];
  for (const d of dependsOn) if (!findTask(ctx.db, d)) raise(ctx, "validation.precondition_failed", "A task it waits on does not exist.", { reason: "dependency_missing", taskId: d });
  if (input.parentTaskId !== undefined && !findTask(ctx.db, input.parentTaskId)) raise(ctx, "validation.precondition_failed", "The parent task does not exist.", { reason: "parent_missing", taskId: input.parentTaskId });

  const now = ctx.now();
  const t: Task = {
    id: newTaskId(), kind, title, state: INITIAL_STATE[kind], blocks: (input.blocks as Block[] | undefined) ?? [], actions, assigned,
    fileIds: [...new Set<string>(input.fileIds ?? [])], dependsOn, followers: [], workingNotes: {}, reviewLoops: 0,
    createdBy: ctx.principal.id, createdAt: now, updatedAt: now, version: 0,
  };
  if (nonEmpty(input.summary)) t.summary = input.summary;
  if (nonEmpty(input.why)) t.why = input.why;
  if (reviewer) t.reviewer = reviewer;
  if (approver) t.approver = approver;
  if (input.due !== undefined) t.due = input.due;
  if (input.effort !== undefined) t.effort = input.effort;
  if (input.recordId !== undefined) t.recordId = input.recordId;
  if (input.source) t.source = input.source as TaskSource;
  if (input.parentTaskId !== undefined) t.parentTaskId = input.parentTaskId;
  if (input.expiresAt !== undefined) t.expiresAt = input.expiresAt;
  if (ctx.thread) t.threadId = ctx.thread;
  const resp = await responsibleFor(ctx, assigned);
  if (resp !== undefined) t.responsible = resp;
  touch(ctx, ctx.db, t);

  const by = ctx.principal.id;
  emitTask(ctx, ctx.db, "task.created", t, { kind, title, assigned, recordId: t.recordId, source: t.source }, { type: "created", by });
  if (isRequest(kind)) emitTask(ctx, ctx.db, "task.requested", t, { kind, title, assigned: holderOf(t), expiresAt: t.expiresAt }, { type: "requested", by });
  emitTask(ctx, ctx.db, "task.assigned", t, { slot: "assigned", to: assigned, from: null }, { type: "assigned", by });
  if (input.reviewer) emitTask(ctx, ctx.db, "task.assigned", t, { slot: "reviewer", to: reviewer, from: null }, { type: "assigned", by });
  if (input.approver) emitTask(ctx, ctx.db, "task.assigned", t, { slot: "approver", to: approver, from: null }, { type: "assigned", by });
  return { task: out(ctx, t) };
}

export async function get(ctx: TasksCtx, input: In): Promise<unknown> {
  const t = getTask(ctx, input.taskId);
  if (!visibleTo(ctx, t)) raise(ctx, "permission.not_found", "That task is not available.");
  return { task: out(ctx, t) };
}

export async function list(ctx: TasksCtx, input: In): Promise<unknown> {
  const f: ListFilter = { scope: input.scope, states: input.states, kinds: input.kinds, recordId: input.recordId, runId: input.runId, assignee: input.assignee, includeSnoozed: input.includeSnoozed };
  const rows = listTasks(ctx, f);
  const p = page(rows, input.cursor, input.limit);
  const idx = openIndex(ctx.db);
  return clean({ tasks: p.rows.map((t) => toOut(t, idx)), next: p.next, total: p.total });
}

export async function needsYouList(ctx: TasksCtx, input: In): Promise<unknown> {
  const items = needsYou(ctx);
  const idx = openIndex(ctx.db);
  const limit = input.limit ?? 50;
  return { items: items.slice(0, limit).map((i) => clean({ task: toOut(i.task, idx), reason: i.reason, handledBy: i.handledBy })), total: items.length };
}

export async function countNeedsYou(ctx: TasksCtx, _input: In): Promise<unknown> {
  const idx = openIndex(ctx.db);
  const n = needsYou(ctx).filter((i) => i.handledBy === undefined && isRequest(i.task.kind) && !isBlocked(i.task, idx) && actionableByMe(ctx, i.task)).length;
  return { count: n };
}

export async function myWorkList(ctx: TasksCtx, input: In): Promise<unknown> {
  const r = myWork(ctx, (input.section ?? "open") as Section);
  const p = page(r.tasks, input.cursor, input.limit);
  const idx = openIndex(ctx.db);
  return clean({ tasks: p.rows.map((t) => toOut(t, idx)), counts: r.counts, next: p.next, total: p.total });
}

export async function update(ctx: TasksCtx, input: In): Promise<unknown> {
  const t = getTask(ctx, input.taskId);
  if (!isOpen(t.state)) raise(ctx, "validation.precondition_failed", "Reopen the task before editing it.", { reason: "closed" });
  const locked = t.source?.kind === "gate" || t.payloadHash !== undefined;
  const changed: string[] = [];
  const set = (k: "title" | "blocks" | "summary" | "why" | "due" | "effort", v: unknown): void => {
    const rec = t as unknown as Record<string, unknown>;
    if (JSON.stringify(rec[k]) === JSON.stringify(v)) return;
    if (v === undefined) delete rec[k]; else rec[k] = v;
    changed.push(k);
  };
  if ("title" in input && input.title !== undefined) {
    const title = String(input.title).trim();
    if (!title) raise(ctx, "validation.precondition_failed", "A task needs a title.", { reason: "title_required" });
    if (locked && title !== t.title) raise(ctx, "validation.field_locked", "This request is the exact act that was held, so its title is locked.", { field: "title" });
    set("title", title);
  }
  if ("blocks" in input && input.blocks !== undefined) {
    if (locked && JSON.stringify(input.blocks) !== JSON.stringify(t.blocks)) raise(ctx, "validation.field_locked", "This request shows the exact act that was held, so its preview is locked.", { field: "blocks" });
    set("blocks", input.blocks as Block[]);
  }
  if ("summary" in input && input.summary !== undefined) set("summary", nonEmpty(input.summary) ? input.summary : undefined);
  if ("why" in input && input.why !== undefined) set("why", nonEmpty(input.why) ? input.why : undefined);
  if ("due" in input && input.due !== undefined) set("due", input.due === null ? undefined : (input.due as number));
  if ("effort" in input && input.effort !== undefined) set("effort", input.effort === null ? undefined : (input.effort as number));
  if (changed.length) {
    touch(ctx, ctx.db, t);
    emitTask(ctx, ctx.db, "task.updated", t, { fields: changed }, { type: "updated", by: ctx.principal.id });
  }
  return { task: out(ctx, t) };
}

export async function transition(ctx: TasksCtx, input: In): Promise<unknown> {
  const t = getTask(ctx, input.taskId);
  const who = whoIs(ctx);
  // a held act is approved or sent back through tasks.act, which mints the approval token and releases or drops the hold
  if (t.source?.kind === "gate" && !isTrustedService(who) && t.state === "awaiting_approval" && (input.to === "done" || input.to === "doing")) {
    raise(ctx, "validation.precondition_failed", "Approve or send back a held act from the request itself.", { reason: "use_act" });
  }
  applyMove(ctx, t, input.to as TaskState, { note: input.note, expectedFrom: input.expectedFrom });
  return { task: out(ctx, t) };
}

export async function assign(ctx: TasksCtx, input: In): Promise<unknown> {
  const t = getTask(ctx, input.taskId);
  const slot = input.slot as Slot;
  const to: Assignee | null = input.to ? asAssignee(input.to) : null;
  if (!isOpen(t.state)) raise(ctx, "validation.precondition_failed", "Reopen the task before changing who is on it.", { reason: "closed" });
  if (to === null && slot === "assigned") raise(ctx, "validation.precondition_failed", "A task always has someone it is assigned to.", { reason: "assigned_required" });
  if (to === null && ((slot === "reviewer" && t.state === "in_review") || (slot === "approver" && t.state === "awaiting_approval"))) {
    raise(ctx, "validation.precondition_failed", "The task is waiting on that person. Hand it to someone else instead.", { reason: "slot_in_use" });
  }
  const next = { assigned: t.assigned, reviewer: t.reviewer, approver: t.approver, [slot]: to ?? undefined } as { assigned: Assignee; reviewer?: Assignee | undefined; approver?: Assignee | undefined };
  checkSlots(ctx, t.kind, next, readPolicy(ctx.db));
  const from = t[slot] ?? null;
  if (sameAssignee(from ?? undefined, to ?? undefined)) return { task: out(ctx, t) };
  if (to === null) delete (t as unknown as Record<string, unknown>)[slot]; else t[slot] = to;
  if (slot === "assigned") {
    delete t.takenBy; delete t.takenAt;
    const r = await responsibleFor(ctx, t.assigned);
    if (r !== undefined) t.responsible = r; else delete t.responsible;
  }
  touch(ctx, ctx.db, t);
  emitTask(ctx, ctx.db, "task.assigned", t, { slot, to, from }, { type: "assigned", by: ctx.principal.id });
  return { task: out(ctx, t) };
}

export async function snooze(ctx: TasksCtx, input: In): Promise<unknown> {
  const t = getTask(ctx, input.taskId);
  if (!isRequest(t.kind) || !isOpen(t.state)) raise(ctx, "validation.precondition_failed", "Only an open request can be snoozed.", { reason: "not_a_request" });
  if (!actionableByMe(ctx, t) && !isTrustedService(ctx.principal)) raise(ctx, "validation.precondition_failed", "Only the person this request is waiting on can snooze it.", { reason: "wrong_actor" });
  const until: number | null = input.until ?? null;
  if (until !== null && until <= ctx.now()) raise(ctx, "validation.precondition_failed", "Pick a time in the future.", { reason: "past_time" });
  if (until === null) delete t.snoozedUntil; else t.snoozedUntil = until;
  touch(ctx, ctx.db, t);
  emitTask(ctx, ctx.db, "task.snoozed", t, { until }, { type: "snoozed", by: ctx.principal.id });
  return { task: out(ctx, t) };
}

export async function take(ctx: TasksCtx, input: In): Promise<unknown> {
  const t = getTask(ctx, input.taskId);
  const me = ctx.principal.id;
  if (!isOpen(t.state)) raise(ctx, "validation.precondition_failed", "A finished task cannot be taken.", { reason: "closed" });
  if (t.assigned.kind !== "group" && t.assigned.kind !== "role") raise(ctx, "validation.precondition_failed", "Only a task given to a group or a role is taken.", { reason: "not_shared" });
  if (t.takenBy === me) return { task: out(ctx, t) };
  if (t.takenBy !== undefined) raise(ctx, "validation.precondition_failed", `Taken by ${t.takenBy}.`, { reason: "taken", takenBy: t.takenBy });
  t.takenBy = me; t.takenAt = ctx.now();
  touch(ctx, ctx.db, t);
  emitTask(ctx, ctx.db, "task.taken", t, { by: me }, { type: "taken", by: me });
  return { task: out(ctx, t) };
}

export async function release(ctx: TasksCtx, input: In): Promise<unknown> {
  const t = getTask(ctx, input.taskId);
  const me = ctx.principal.id;
  if (t.takenBy === undefined) raise(ctx, "validation.precondition_failed", "Nobody has taken this task.", { reason: "not_taken" });
  if (t.takenBy !== me && t.takenBy !== ctx.actingFor && !isTrustedService(ctx.principal)) raise(ctx, "validation.precondition_failed", `Only ${t.takenBy} can give it back.`, { reason: "wrong_actor" });
  const by = t.takenBy;
  delete t.takenBy; delete t.takenAt;
  touch(ctx, ctx.db, t);
  emitTask(ctx, ctx.db, "task.released", t, { by }, { type: "released", by: me });
  return { task: out(ctx, t) };
}

/** Withdraw the open requests of a stopped chat or run, or one request, with a note. */
export async function withdraw(ctx: TasksCtx, input: In): Promise<unknown> {
  const hasSource = input.sourceKind !== undefined && input.sourceId !== undefined;
  if (input.taskId === undefined && !hasSource) raise(ctx, "validation.bad_input", "Say which request to withdraw: a task, or a source kind and id.", { errors: ["/taskId: required unless sourceKind and sourceId are given"] });
  const note = String(input.note ?? "").trim();
  if (!note) raise(ctx, "validation.precondition_failed", "Add a note that says why.", { reason: "note_required" });
  const rows = input.taskId !== undefined
    ? allTasks(ctx.db, "c.id = ?", input.taskId)
    : allTasks(ctx.db, "m.source_kind = ? AND m.source_id = ?", input.sourceKind, input.sourceId);
  let n = 0;
  for (const t of rows) {
    if (!isRequest(t.kind) || !isOpen(t.state)) continue;
    if (input.taskId !== undefined && hasSource && (t.source?.kind !== input.sourceKind || t.source?.id !== input.sourceId)) continue;
    t.state = "canceled";
    delete t.snoozedUntil;
    touch(ctx, ctx.db, t);
    emitTask(ctx, ctx.db, "task.withdrawn", t, { note, sourceKind: t.source?.kind, sourceId: t.source?.id }, { type: "withdrawn", by: ctx.principal.id, note });
    n += 1;
  }
  return { withdrawn: n };
}

export async function followersAdd(ctx: TasksCtx, input: In): Promise<unknown> {
  const t = getTask(ctx, input.taskId);
  const f = String(input.follower ?? "").trim();
  if (!f) raise(ctx, "validation.bad_input", "Say who follows.", { errors: ["/follower: required"] });
  if (!t.followers.includes(f)) {
    t.followers = [...t.followers, f];
    touch(ctx, ctx.db, t);
    emitTask(ctx, ctx.db, "task.follower_added", t, { follower: f }, { type: "follower_added", by: ctx.principal.id });
  }
  return { task: out(ctx, t) };
}
export async function followersRemove(ctx: TasksCtx, input: In): Promise<unknown> {
  const t = getTask(ctx, input.taskId);
  const f = String(input.follower ?? "");
  if (t.followers.includes(f)) {
    t.followers = t.followers.filter((x) => x !== f);
    touch(ctx, ctx.db, t);
    emitTask(ctx, ctx.db, "task.follower_removed", t, { follower: f }, { type: "follower_removed", by: ctx.principal.id });
  }
  return { task: out(ctx, t) };
}

/** Reserved working-note keys. A Gate hold writes its decision id and payload hash once; they land in columns, never in the notes, and are never edited. */
export const RESERVED_NOTES = { decision_id: "decisionId", payload_hash: "payloadHash" } as const;

export async function notesSet(ctx: TasksCtx, input: In): Promise<unknown> {
  const t = getTask(ctx, input.taskId);
  const key = String(input.key ?? "");
  if (!key.trim()) raise(ctx, "validation.bad_input", "A note needs a key.", { errors: ["/key: required"] });
  const value = String(input.value ?? "");
  const reserved = (RESERVED_NOTES as Record<string, "decisionId" | "payloadHash">)[key];
  if (reserved) {
    if (t.source?.kind !== "gate") raise(ctx, "validation.field_locked", "Only a held act carries that.", { field: key });
    if (t[reserved] !== undefined && t[reserved] !== value) raise(ctx, "validation.field_locked", "That value is set once.", { field: key });
    t[reserved] = value;
  } else {
    t.workingNotes = { ...t.workingNotes, [key]: value };
  }
  touch(ctx, ctx.db, t);
  emitTask(ctx, ctx.db, "task.note_set", t, { key, by: ctx.principal.id }, { type: "note_set", by: ctx.principal.id });
  return { task: out(ctx, t) };
}
export async function notesDelete(ctx: TasksCtx, input: In): Promise<unknown> {
  const t = getTask(ctx, input.taskId);
  const key = String(input.key ?? "");
  if (key in RESERVED_NOTES) raise(ctx, "validation.field_locked", "That value is never removed.", { field: key });
  if (key in t.workingNotes) {
    const rest = { ...t.workingNotes }; delete rest[key];
    t.workingNotes = rest;
    touch(ctx, ctx.db, t);
    emitTask(ctx, ctx.db, "task.note_set", t, { key, by: ctx.principal.id }, { type: "note_set", by: ctx.principal.id });
  }
  return { task: out(ctx, t) };
}

function linkTarget(ctx: TasksCtx, input: In): { kind: "record" | "file"; id: string } {
  const hasRecord = nonEmpty(input.recordId), hasFile = nonEmpty(input.fileId);
  if (hasRecord === hasFile) raise(ctx, "validation.bad_input", "Give a record or a file, not both and not neither.", { errors: ["/recordId or /fileId: exactly one"] });
  return hasRecord ? { kind: "record", id: input.recordId as string } : { kind: "file", id: input.fileId as string };
}
export async function linksAdd(ctx: TasksCtx, input: In): Promise<unknown> {
  const t = getTask(ctx, input.taskId);
  const l = linkTarget(ctx, input);
  const by = ctx.principal.id;
  if (l.kind === "record") {
    if (t.recordId === l.id) return { task: out(ctx, t) };
    const prev = t.recordId;
    t.recordId = l.id;
    touch(ctx, ctx.db, t);
    if (prev !== undefined) emitTask(ctx, ctx.db, "task.link_changed", t, { op: "removed", linkKind: "record", linkId: prev }, { type: "link_removed", by });
    emitTask(ctx, ctx.db, "task.link_changed", t, { op: "added", linkKind: "record", linkId: l.id }, { type: "link_added", by });
  } else {
    if (t.fileIds.includes(l.id)) return { task: out(ctx, t) };
    t.fileIds = [...t.fileIds, l.id];
    touch(ctx, ctx.db, t);
    emitTask(ctx, ctx.db, "task.link_changed", t, { op: "added", linkKind: "file", linkId: l.id }, { type: "link_added", by });
  }
  return { task: out(ctx, t) };
}
export async function linksRemove(ctx: TasksCtx, input: In): Promise<unknown> {
  const t = getTask(ctx, input.taskId);
  const l = linkTarget(ctx, input);
  const by = ctx.principal.id;
  if (l.kind === "record") {
    if (t.recordId !== l.id) return { task: out(ctx, t) };
    delete t.recordId;
  } else {
    if (!t.fileIds.includes(l.id)) return { task: out(ctx, t) };
    t.fileIds = t.fileIds.filter((f) => f !== l.id);
  }
  touch(ctx, ctx.db, t);
  emitTask(ctx, ctx.db, "task.link_changed", t, { op: "removed", linkKind: l.kind, linkId: l.id }, { type: "link_removed", by });
  return { task: out(ctx, t) };
}

export async function dependenciesAdd(ctx: TasksCtx, input: In): Promise<unknown> {
  const t = getTask(ctx, input.taskId);
  const dep = String(input.dependsOnId);
  if (dep === t.id) raise(ctx, "validation.precondition_failed", "A task cannot wait on itself.", { reason: "self_dependency" });
  if (!findTask(ctx.db, dep)) raise(ctx, "validation.precondition_failed", "The task it would wait on does not exist.", { reason: "dependency_missing", taskId: dep });
  if (t.dependsOn.includes(dep)) return { task: out(ctx, t) };
  if (reachable(ctx.db, dep, t.id)) raise(ctx, "validation.precondition_failed", "That would make two tasks wait on each other.", { reason: "dependency_cycle" });
  t.dependsOn = [...t.dependsOn, dep];
  touch(ctx, ctx.db, t);
  emitTask(ctx, ctx.db, "task.link_changed", t, { op: "added", linkKind: "dependency", linkId: dep }, { type: "link_added", by: ctx.principal.id });
  return { task: out(ctx, t) };
}
export async function dependenciesRemove(ctx: TasksCtx, input: In): Promise<unknown> {
  const t = getTask(ctx, input.taskId);
  const dep = String(input.dependsOnId);
  if (t.dependsOn.includes(dep)) {
    t.dependsOn = t.dependsOn.filter((d) => d !== dep);
    touch(ctx, ctx.db, t);
    emitTask(ctx, ctx.db, "task.link_changed", t, { op: "removed", linkKind: "dependency", linkId: dep }, { type: "link_removed", by: ctx.principal.id });
  }
  return { task: out(ctx, t) };
}

export async function history(ctx: TasksCtx, input: In): Promise<unknown> {
  const t = getTask(ctx, input.taskId);
  if (!visibleTo(ctx, t)) raise(ctx, "permission.not_found", "That task is not available.");
  const p = page(historyOf(ctx.db, t.id), input.cursor, input.limit);
  return clean({ entries: p.rows, next: p.next, total: p.total });
}
