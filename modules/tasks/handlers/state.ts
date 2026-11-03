// Tasks state machine and the capabilities that change or read a task (ARCH 4.7, spec 2.8, 4.1, 4.2).
// `tasks.transition` is the only writer of the status field; `tasks.act` (handlers/act.ts) and the Gate reach the same applyMove. The table of 4.7 lives in planMove.
// Group and role slots: the pipeline authorizes the call at level use on the task, so holders pass; the first Take locks the task to one person (tasks.take).
import { isTrustedService } from "../../../lib/trust.ts";
import {
  actionableByMe, allTasks, clean, emitTask, ensurePrefix, findTask, getTask, historyOf, holds, isOpen, isRequest, listTasks, myWork, needsYou, newTaskId, openIndex,
  out, outFor, page, raise, readPolicy, sameAssignee, touch, visibleTo, whoIs,
} from "../projections.ts";
import { ensureThread, syncThread, unseat } from "./thread.ts";
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

export interface Applied { task: Task; move: Move; from: TaskState; /** a group or role request closed by this call: the first action wins and others see "handled by" */ handled: boolean; /** a group or role task the caller started or handed in without a Take: it is theirs now */ took: boolean }
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
  // a group or role task started or handed in by one of its members is theirs, as a Take would make it: the others see who has it
  let took = false;
  if (t.kind === "work" && (move.action === "start" || move.action === "submit") && (t.assigned.kind === "group" || t.assigned.kind === "role") && t.takenBy === undefined && !isTrustedService(whoIs(ctx))) {
    t.takenBy = ctx.actingFor ?? ctx.principal.id; t.takenAt = ctx.now(); took = true;
  }
  let handled = false;
  if (!isOpen(to)) {
    delete t.snoozedUntil;
    if (addressed && (addressed.kind === "group" || addressed.kind === "role") && isRequest(t.kind)) { t.handledBy = ctx.principal.id; t.handledAt = ctx.now(); handled = true; }
  }
  touch(ctx, ctx.db, t);

  const by = ctx.principal.id;
  const hist = (type: string): { type: string; by: string; note?: string } => clean({ type, by, note });
  emitTask(ctx, ctx.db, "task.transitioned", t, { kind: t.kind, from, to, note }, hist(`transitioned:${to}`));
  if (to === "done") emitTask(ctx, ctx.db, "task.completed", t, { kind: t.kind, recordId: t.recordId, source: t.source }, hist("completed"));
  if (move.action === "send_back") emitTask(ctx, ctx.db, "task.sent_back", t, { by, note: note ?? "", reviewLoops: t.reviewLoops }, hist("sent_back"));
  if (move.action === "reject") emitTask(ctx, ctx.db, "task.rejected", t, { by, note: note ?? "" }, hist("rejected"));
  if (move.action === "approve" || move.action === "approve_review") emitTask(ctx, ctx.db, "task.approved", t, { kind: t.kind, by, forPerson: ctx.actingFor }, hist("approved"));
  // the baton of a work task reached its next holder: they are asked, the same way a request asks (Needs you, a notification naming the task)
  const next = t.kind === "work" ? batonNext(t, move.action) : undefined;
  if (next) emitTask(ctx, ctx.db, "task.requested", t, { kind: t.kind, title: t.title, assigned: next.to, step: next.step, by }, { type: "requested", by });
  return { task: t, move, from, handled, took };
}

/** Who a move of a work task hands the baton to, and for what: the reviewer, the approver, or the doer the work went back to. */
function batonNext(t: Task, action: MoveAction): { to: Assignee; step: "work" | "review" | "approval" } | undefined {
  if (t.state === "in_review" && t.reviewer) return { to: t.reviewer, step: "review" };
  if (t.state === "awaiting_approval" && t.approver) return { to: t.approver, step: "approval" };
  if (t.state === "doing" && (action === "send_back" || action === "reject")) return { to: t.assigned, step: "work" };
  return undefined;
}

/**
 * May the caller change this task (its fields, its people, its links)? Someone on it: a slot they hold by id or took, a group or role slot the kernel lets them use, its creator, the person
 * responsible for its agent; or anyone the kernel grants manage on it (an admin). The server itself always may. The pipeline checks the grant first; this is the task's own word.
 */
export function mayEdit(ctx: TasksCtx, t: Task): boolean {
  const who = whoIs(ctx);
  if (isTrustedService(who)) return true;
  const me = (id: string | undefined): boolean => id !== undefined && (id === who.id || id === who.actingFor);
  if (me(t.createdBy) || me(t.responsible) || me(t.takenBy)) return true;
  const can = (level: string): boolean => !!ctx.authorize && ctx.authorize({ perm: null, level }, { type: "task", id: t.id }).effect === "allow";
  for (const a of [t.assigned, t.reviewer, t.approver]) {
    if (!a) continue;
    if ((a.kind === "group" || a.kind === "role") ? t.takenBy === undefined && can("use") : me(a.id)) return true;
  }
  // the kernel's word alone is enough only at manage (an admin, the task's own manager): a Space-wide edit grant does not put a member on someone else's task
  return can("manage");
}
function mustEdit(ctx: TasksCtx, t: Task, what: string): void {
  if (!mayEdit(ctx, t)) raise(ctx, "validation.precondition_failed", `Only someone on this task can ${what}.`, { reason: "wrong_actor" });
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

/** An outside agent runs on its owner's machine on its owner's access: only that person gives it work. A teammate's task is refused here, in words, instead of sitting with nobody on it. */
export async function checkOutside(ctx: TasksCtx, who: ReadonlyArray<Assignee | undefined>): Promise<void> {
  for (const a of who) {
    if (a?.kind !== "agent" || !ctx.call) continue;
    const r = await ctx.call("agents.outside.usable", { agentId: a.id }).catch(() => null) as { usable?: boolean } | null;
    if (r?.usable === false) raise(ctx, "validation.precondition_failed", "Only the person who connected this outside agent can give it work.", { reason: "outside_agent" });
  }
}

export function checkSlots(ctx: TasksCtx, kind: TaskKind, s: { assigned: Assignee; reviewer?: Assignee | undefined; approver?: Assignee | undefined }, policy: Policy): void {
  checkAssignee(ctx, s.assigned, "assignee"); checkAssignee(ctx, s.reviewer, "reviewer"); checkAssignee(ctx, s.approver, "approver");
  if (kind === "work" && !policy.allowSelfReview && (sameAssignee(s.reviewer, s.assigned) || sameAssignee(s.approver, s.assigned))) {
    raise(ctx, "validation.precondition_failed", "The reviewer and the approver cannot be the person doing the work.", { reason: "self_review" });
  }
  if (s.approver && policy.requireHumanApprover && (s.approver.kind === "agent" || s.approver.kind === "automation")) {
    raise(ctx, "validation.precondition_failed", "This Space needs a person to approve.", { reason: "human_approver_required" });
  }
}

/** The person responsible for an agent: its owner, so a stuck or unanswered agent task has someone to land on. */
export async function responsibleFor(ctx: TasksCtx, a: Assignee): Promise<string | undefined> {
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

const MAX_START_NOTES = 20;
const MAX_NOTE_CHARS = 50_000;

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
  const resp = await responsibleFor(ctx, assigned);
  await checkOutside(ctx, [assigned, reviewer, approver]);

  const known = new Set(KIND_ACTIONS[kind].map((a) => a.key));
  const actions: ActionDef[] = (input.actions as ActionDef[] | undefined) ?? KIND_ACTIONS[kind].map((a) => ({ ...a }));
  for (const a of actions) if (!known.has(a.key)) raise(ctx, "validation.precondition_failed", `A ${kind} task has no action called ${a.key}.`, { reason: "unknown_action", action: a.key });

  const dependsOn: string[] = [...new Set<string>(input.dependsOn ?? [])];
  for (const d of dependsOn) if (!findTask(ctx.db, d)) raise(ctx, "validation.precondition_failed", "A task it waits on does not exist.", { reason: "dependency_missing", taskId: d });
  if (input.parentTaskId !== undefined && !findTask(ctx.db, input.parentTaskId)) raise(ctx, "validation.precondition_failed", "The parent task does not exist.", { reason: "parent_missing", taskId: input.parentTaskId });

  await ensurePrefix(ctx);
  const now = ctx.now();
  const t: Task = {
    id: newTaskId(), kind, title, state: INITIAL_STATE[kind], blocks: (input.blocks as Block[] | undefined) ?? [], actions, assigned,
    fileIds: [...new Set<string>(input.fileIds ?? [])], dependsOn, followers: [], workingNotes: {}, reviewLoops: 0, labels: [...new Set<string>(input.labels ?? [])], fields: (input.fields as Record<string, unknown> | undefined) ?? {},
    createdBy: ctx.principal.id, createdAt: now, updatedAt: now, version: 0,
  };
  if (nonEmpty(input.summary)) t.summary = input.summary;
  if (nonEmpty(input.why)) t.why = input.why;
  if (reviewer) t.reviewer = reviewer;
  if (approver) t.approver = approver;
  if (input.due !== undefined) t.due = input.due;
  if (input.effort !== undefined) t.effort = input.effort;
  if (input.priority !== undefined) t.priority = input.priority;
  if (input.start !== undefined) t.start = input.start;
  if (input.recur !== undefined) t.recur = input.recur;
  if (input.recordId !== undefined) t.recordId = input.recordId;
  if (input.source) t.source = input.source as TaskSource;
  if (input.parentTaskId !== undefined) t.parentTaskId = input.parentTaskId;
  if (input.expiresAt !== undefined) t.expiresAt = input.expiresAt;
  if (input.notes && typeof input.notes === "object") {
    // notes the task starts with: a brief, a checklist, a schema. The two reserved keys belong to a held act and are never taken from here.
    const notes: Record<string, string> = {};
    for (const [k, v] of Object.entries(input.notes as Record<string, unknown>).slice(0, MAX_START_NOTES)) if (!(k in RESERVED_NOTES) && typeof v === "string") notes[k] = v.slice(0, MAX_NOTE_CHARS);
    t.workingNotes = notes;
  }
  // a request that came from a chat lives in that chat: its feed is the conversation that asked, never a second thread beside it
  if (isRequest(kind) && t.source?.kind === "chat") t.threadId = t.source.id;
  else if (ctx.call) await ensureThread(ctx, t, ctx.thread);
  if (t.threadId === undefined && ctx.thread) t.threadId = ctx.thread;
  if (resp !== undefined) t.responsible = resp;
  touch(ctx, ctx.db, t);

  const by = ctx.principal.id;
  emitTask(ctx, ctx.db, "task.created", t, { kind, title, assigned, recordId: t.recordId, source: t.source }, { type: "created", by });
  if (isRequest(kind)) emitTask(ctx, ctx.db, "task.requested", t, { kind, title, assigned: holderOf(t), expiresAt: t.expiresAt }, { type: "requested", by });
  emitTask(ctx, ctx.db, "task.assigned", t, { slot: "assigned", to: assigned, from: null, title, by }, { type: "assigned", by });
  if (input.reviewer) emitTask(ctx, ctx.db, "task.assigned", t, { slot: "reviewer", to: reviewer, from: null, title, by }, { type: "assigned", by });
  if (input.approver) emitTask(ctx, ctx.db, "task.assigned", t, { slot: "approver", to: approver, from: null, title, by }, { type: "assigned", by });
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
  return clean({ tasks: p.rows.map((t) => outFor(ctx, t, idx)), next: p.next, total: p.total });
}

export async function needsYouList(ctx: TasksCtx, input: In): Promise<unknown> {
  const items = needsYou(ctx);
  const idx = openIndex(ctx.db);
  const limit = input.limit ?? 50;
  return { items: items.slice(0, limit).map((i) => clean({ task: outFor(ctx, i.task, idx), reason: i.reason, handledBy: i.handledBy, yourTurn: i.handledBy === undefined && i.yourTurn === true ? true : undefined })), total: items.length };
}

export async function countNeedsYou(ctx: TasksCtx, _input: In): Promise<unknown> {
  // exactly the rows of the Needs you group: every task whose next move is the reader's, each once
  const n = needsYou(ctx).filter((i) => i.handledBy === undefined && i.yourTurn === true).length;
  return { count: n };
}

export async function myWorkList(ctx: TasksCtx, input: In): Promise<unknown> {
  const r = myWork(ctx, (input.section ?? "open") as Section);
  const p = page(r.tasks, input.cursor, input.limit);
  const idx = openIndex(ctx.db);
  return clean({ tasks: p.rows.map((t) => outFor(ctx, t, idx)), counts: r.counts, next: p.next, total: p.total });
}

const EDIT_FIELDS = ["title", "summary", "why", "due", "effort", "priority", "labels", "start", "recur", "fields", "blocks", "parentTaskId"] as const;
const FIELD_WORDS: Record<string, string> = { title: "the title", summary: "the summary", why: "the reason", due: "the due date", effort: "the estimate", priority: "the priority", labels: "the labels", start: "the start date", recur: "the repeat", fields: "the fields", blocks: "the content", parentTaskId: "the parent" };
function wordsOf(k: string, v: unknown): string {
  if (v === undefined || v === null) return "empty";
  if ((k === "due" || k === "start") && typeof v === "number") return new Date(v).toISOString().slice(0, 10);
  if (k === "blocks") return "different";
  return typeof v === "string" ? `"${v}"` : Array.isArray(v) ? (v.length ? v.join(", ") : "empty") : JSON.stringify(v);
}
/** Refuse an edit made on an old version, and say what the fields it tried to change hold now. */
function staleVersion(ctx: TasksCtx, t: Task, input: In): never {
  const rec = t as unknown as Record<string, unknown>;
  const current: Record<string, unknown> = {};
  const lines: string[] = [];
  for (const k of EDIT_FIELDS) {
    if (!(k in input) || (input as Record<string, unknown>)[k] === undefined) continue;
    current[k] = rec[k] ?? null;
    lines.push(`${FIELD_WORDS[k] ?? k} is now ${wordsOf(k, rec[k])}`);
  }
  const what = lines.length ? ` Now ${lines.join("; ")}.` : "";
  // who changed it last, so the second person's page can say who
  const by = historyOf(ctx.db, t.id).find((h) => h.type === "updated")?.by;
  raise(ctx, "validation.precondition_failed", `This task changed while you were editing it.${what} Your change was not saved.`, { reason: "stale_version", version: t.version, updatedAt: t.updatedAt, current, ...(by ? { by } : {}) });
}

export async function update(ctx: TasksCtx, input: In): Promise<unknown> {
  const t = getTask(ctx, input.taskId);
  // linking the thread someone made on opening a task is open to anyone who sees it; every other change is for someone on the task
  const onlyThread = Object.keys(input).every((k) => k === "taskId" || k === "threadId" || k === "idempotencyKey" || k === "expectedVersion");
  if (onlyThread ? !visibleTo(ctx, t) && !isTrustedService(whoIs(ctx)) : !mayEdit(ctx, t)) raise(ctx, "validation.precondition_failed", "Only someone on this task can change it.", { reason: "wrong_actor" });
  if (!isOpen(t.state) && !onlyThread) raise(ctx, "validation.precondition_failed", "Reopen the task before editing it.", { reason: "closed" });
  // two people editing the same task: the second save is told it changed and what it is now, and nothing is overwritten
  if (typeof input.expectedVersion === "number" && input.expectedVersion !== t.version) staleVersion(ctx, t, input);
  const locked = t.source?.kind === "gate" || t.payloadHash !== undefined;
  const changed: string[] = [];
  const set = (k: "title" | "blocks" | "summary" | "why" | "due" | "effort" | "priority" | "labels" | "start" | "fields" | "recur" | "parentTaskId" | "workerThread", v: unknown): void => {
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
  if ("priority" in input && input.priority !== undefined) set("priority", input.priority ?? undefined);
  if ("labels" in input && input.labels !== undefined) set("labels", [...new Set<string>(input.labels)]);
  if ("start" in input && input.start !== undefined) set("start", input.start ?? undefined);
  if ("recur" in input && input.recur !== undefined) set("recur", input.recur ?? undefined);
  if ("fields" in input && input.fields !== undefined) {
    const next: Record<string, unknown> = { ...t.fields };
    for (const [k, v] of Object.entries(input.fields as Record<string, unknown>)) { if (v === null) delete next[k]; else next[k] = v; }
    set("fields", next);
  }
  if ("parentTaskId" in input && input.parentTaskId !== undefined) {
    const to: string | null = input.parentTaskId;
    if (to !== null) {
      // a child moves between parents: never under itself or one of its own children
      for (let at: string | undefined = to, hops = 0; at !== undefined && hops < 100; at = findTask(ctx.db, at)?.parentTaskId, hops++) {
        if (at === t.id) raise(ctx, "validation.precondition_failed", "A task cannot sit under itself.", { reason: "parent_loop" });
      }
      if (!findTask(ctx.db, to)) raise(ctx, "validation.precondition_failed", "The parent task does not exist.", { reason: "parent_missing", taskId: to });
    }
    set("parentTaskId", to ?? undefined);
  }
  if ("workerThread" in input && typeof input.workerThread === "string") set("workerThread", input.workerThread);
  // a task whose thread could not be made when it was created is linked to the one made later; a thread already linked is never replaced
  if ("threadId" in input && typeof input.threadId === "string" && t.threadId === undefined) { t.threadId = input.threadId; changed.push("threadId"); }
  if (changed.length) {
    touch(ctx, ctx.db, t);
    emitTask(ctx, ctx.db, "task.updated", t, { fields: changed }, { type: "updated", by: ctx.principal.id });
  }
  // a thread linked later gets the people and agents of the slots, as one made with the task does
  if (changed.includes("threadId")) await syncThread(ctx, t);
  return { task: out(ctx, t) };
}

export async function transition(ctx: TasksCtx, input: In): Promise<unknown> {
  const t = getTask(ctx, input.taskId);
  const who = whoIs(ctx);
  // a held act is approved or sent back through tasks.act, which mints the approval token and releases or drops the hold
  if (t.source?.kind === "gate" && !isTrustedService(who) && t.state === "awaiting_approval" && (input.to === "done" || input.to === "doing")) {
    raise(ctx, "validation.precondition_failed", "Approve or send back a held act from the request itself.", { reason: "use_act" });
  }
  const applied = applyMove(ctx, t, input.to as TaskState, { note: input.note, expectedFrom: input.expectedFrom });
  if (applied.took) await syncThread(ctx, t);
  return { task: out(ctx, t) };
}

export async function assign(ctx: TasksCtx, input: In): Promise<unknown> {
  const t = getTask(ctx, input.taskId);
  const slot = input.slot as Slot;
  const to: Assignee | null = input.to ? asAssignee(input.to) : null;
  mustEdit(ctx, t, "change who is on it");
  if (!isOpen(t.state)) raise(ctx, "validation.precondition_failed", "Reopen the task before changing who is on it.", { reason: "closed" });
  if (to === null && slot === "assigned") raise(ctx, "validation.precondition_failed", "A task always has someone it is assigned to.", { reason: "assigned_required" });
  if (to === null && ((slot === "reviewer" && t.state === "in_review") || (slot === "approver" && t.state === "awaiting_approval"))) {
    raise(ctx, "validation.precondition_failed", "The task is waiting on that person. Hand it to someone else instead.", { reason: "slot_in_use" });
  }
  const next = { assigned: t.assigned, reviewer: t.reviewer, approver: t.approver, [slot]: to ?? undefined } as { assigned: Assignee; reviewer?: Assignee | undefined; approver?: Assignee | undefined };
  checkSlots(ctx, t.kind, next, readPolicy(ctx.db));
  await checkOutside(ctx, [to ?? undefined]);
  const from = t[slot] ?? null;
  if (sameAssignee(from ?? undefined, to ?? undefined)) return { task: out(ctx, t) };
  if (to === null) delete (t as unknown as Record<string, unknown>)[slot]; else t[slot] = to;
  if (slot === "assigned") {
    delete t.takenBy; delete t.takenAt;
    const r = await responsibleFor(ctx, t.assigned);
    if (r !== undefined) t.responsible = r; else delete t.responsible;
  }
  touch(ctx, ctx.db, t);
  emitTask(ctx, ctx.db, "task.assigned", t, { slot, to, from, title: t.title, by: ctx.principal.id }, { type: "assigned", by: ctx.principal.id });
  await syncThread(ctx, t);
  // the one it was taken from leaves its thread, so they stop hearing a task that is no longer theirs
  await unseat(ctx, t, from);
  return { task: out(ctx, t) };
}

export async function snooze(ctx: TasksCtx, input: In): Promise<unknown> {
  const t = getTask(ctx, input.taskId);
  if (!isOpen(t.state)) raise(ctx, "validation.precondition_failed", "Only an open task can be snoozed.", { reason: "task_closed" });
  if (!actionableByMe(ctx, t) && !isTrustedService(ctx.principal)) raise(ctx, "validation.precondition_failed", "Only the person this task is waiting on can snooze it.", { reason: "wrong_actor" });
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
  // whoever took it is in its thread from now on
  await syncThread(ctx, t);
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

const CANCELERS: readonly Actor[] = ["assigned", "reviewer", "approver", "creator", "responsible"];
export const mayLetGo = (ctx: TasksCtx, t: Task): boolean => mayAct(t, { action: "cancel", to: "canceled", actors: CANCELERS, noteRequired: false }, whoIs(ctx));

/** Withdraw the open requests of a stopped chat or run, or one request or task, with a note. */
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
    if (!isOpen(t.state)) continue;
    // a source that stopped takes its requests with it; plain work is let go one task at a time, by someone on it
    if (!isRequest(t.kind)) {
      if (input.taskId === undefined) continue;
      if (!isTrustedService(ctx.principal) && !mayLetGo(ctx, t)) raise(ctx, "validation.precondition_failed", "Only someone on this task can let it go.", { reason: "wrong_actor" });
    }
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
  // following yourself needs only to see the task; adding someone else is for someone on it
  const self = f === ctx.principal.id || f === ctx.actingFor;
  if (self ? !visibleTo(ctx, t) && !isTrustedService(whoIs(ctx)) : !mayEdit(ctx, t)) raise(ctx, "validation.precondition_failed", "Only someone on this task can add a follower.", { reason: "wrong_actor" });
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
  if (f !== ctx.principal.id && f !== ctx.actingFor) mustEdit(ctx, t, "remove a follower");
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
  // a writer that names the value it started from is refused when someone changed the note meanwhile: nothing is overwritten, and the refusal says what the note holds now and who changed it.
  // An agent that names none may only append (the note was empty, or its new value starts with what it holds): anything else could erase what a person saved after the agent read it. A list note
  // (Done means, the ticks) an agent changed from a stale read is merged, as the page does for people: both changes stay.
  const held = t.workingNotes[key] ?? "";
  const named = typeof input.expectedFrom === "string";
  const agent = ctx.principal.kind === "agent";
  let writing = value;
  if (named ? held !== input.expectedFrom : agent && !(held === "" || value.startsWith(held))) {
    if (agent && named && LIST_NOTES.has(key)) writing = mergeList(input.expectedFrom, value, held);
    else {
      const by = historyOf(ctx.db, t.id).find((h) => h.type === "note_set" || h.type === "updated")?.by;
      const redo = agent ? ` It now says: ${held === "" ? "(empty)" : held}. Make your change again on top of that, and send expectedFrom with that text.` : "";
      raise(ctx, "validation.precondition_failed", `This task changed while you were editing it. The note ${key} is now different.${redo} Your change was not saved.`, { reason: "stale_version", version: t.version, updatedAt: t.updatedAt, current: { [key]: held }, ...(by ? { by } : {}) });
    }
  }
  const reserved = (RESERVED_NOTES as Record<string, "decisionId" | "payloadHash">)[key];
  if (reserved) {
    if (t.source?.kind !== "gate") raise(ctx, "validation.field_locked", "Only a held act carries that.", { field: key });
    if (t[reserved] !== undefined && t[reserved] !== value) raise(ctx, "validation.field_locked", "That value is set once.", { field: key });
    t[reserved] = value;
  } else {
    t.workingNotes = { ...t.workingNotes, [key]: writing };
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
  mustEdit(ctx, t, "link to it");
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
  mustEdit(ctx, t, "remove a link");
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
  mustEdit(ctx, t, "make it wait on another task");
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
  mustEdit(ctx, t, "stop it waiting");
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

/** The notes that are lists. Two writers changing one do not clash: both changes are kept (the page does the same for people, conflict.ts). */
const LIST_NOTES: ReadonlySet<string> = new Set(["done_means", "done_ticks"]);
const listOf = (v: string | undefined): unknown[] => { try { const x = JSON.parse(v ?? "[]") as unknown; return Array.isArray(x) ? x : []; } catch { return []; } };
/** The note as it becomes when the writer changed it from `base` to `mine` while it became `current`: the other change and the writer's, together. */
export function mergeList(base: string | undefined, mine: string, current: string | undefined): string {
  const b = listOf(base), m = listOf(mine), c = listOf(current);
  const has = (xs: unknown[], x: unknown): boolean => xs.some((y) => JSON.stringify(y) === JSON.stringify(x));
  const added = m.filter((x) => !has(b, x)), removed = b.filter((x) => !has(m, x));
  return JSON.stringify([...c.filter((x) => !has(removed, x)), ...added.filter((x) => !has(c, x))]);
}
