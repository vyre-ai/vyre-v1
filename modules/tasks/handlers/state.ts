// Task state machine (ARCH 4.7, spec 2.8). One primitive, six stored states.
// Blocked is derived and is never a stored state. Approve is a kind on this machine, not a second queue.
// The responsible person is the human who owns the open step: the taker, the current slot when it is a person, or the creator.
// Three slots (Assigned, Reviewer, Approver). Each slot is a human, an agent, or a group or role (an automation is allowed by the contract too).

export const TASK_STATES = ["todo", "doing", "in_review", "awaiting_approval", "done", "canceled"] as const;
export type TaskState = (typeof TASK_STATES)[number];

export const TASK_KINDS = ["work", "approve", "review", "answer", "unblock", "signature"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const SLOTS = ["assigned", "reviewer", "approver"] as const;
export type SlotName = (typeof SLOTS)[number];

export const PARTY_KINDS = ["person", "agent", "group", "role", "automation"] as const;
export type PartyKind = (typeof PARTY_KINDS)[number];

/** How a slot is filled. Group and role share one class: the first Take locks it. */
export type SlotFill = "human" | "agent" | "group_or_role" | "automation";

export interface Party {
  kind: PartyKind;
  id: string;
}

export interface Actor {
  kind: "person" | "agent" | "actor" | "service";
  id: string;
}

export interface Policy {
  reviewLoopLimit: number;
  allowSelfReview: boolean;
  requireHumanApprover: boolean;
}

export const DEFAULT_POLICY: Policy = {
  reviewLoopLimit: 2,
  allowSelfReview: false,
  requireHumanApprover: false,
};

export interface TaskBlock {
  type: string;
  v?: number;
  data: unknown;
}

export interface TaskActionDef {
  key: string;
  label: string;
  note?: "required" | "optional";
}

export interface TaskSource {
  kind: "chat" | "run" | "gate" | "journey" | "manual";
  id: string;
}

export const TRANSITION_ACTIONS = [
  "start", "submit", "complete", "cancel", "reopen",
  "approve", "reject", "send_back", "answer", "dismiss", "resolved", "cannot",
] as const;
export type TransitionAction = (typeof TRANSITION_ACTIONS)[number];

const NOTE_REQUIRED = new Set<string>(["send_back", "reject", "cannot"]);
const OPEN: ReadonlySet<TaskState> = new Set(["todo", "doing", "in_review", "awaiting_approval"]);

export interface Machine {
  state: TaskState;
  kind: TaskKind;
  assigned: Party;
  reviewer?: Party;
  approver?: Party;
  reviewLoops: number;
  takenBy?: string;
  createdBy: string;
}

export interface StepOk {
  ok: true;
  to: TaskState;
  reviewLoops: number;
  takenBy?: string;
  events: Array<"task.sent_back" | "task.approved" | "task.rejected" | "task.completed" | "task.handled">;
}

export interface StepNo {
  ok: false;
  code: "validation.precondition_failed";
  reason: string;
}

export type StepResult = StepOk | StepNo;

export function isTaskState(v: unknown): v is TaskState {
  return typeof v === "string" && (TASK_STATES as readonly string[]).includes(v);
}

export function isTaskKind(v: unknown): v is TaskKind {
  return typeof v === "string" && (TASK_KINDS as readonly string[]).includes(v);
}

export function isOpen(state: TaskState): boolean {
  return OPEN.has(state);
}

export function sameParty(a: Party, b: Party): boolean {
  return a.kind === b.kind && a.id === b.id;
}

export function slotFill(party: Party): SlotFill {
  if (party.kind === "person") return "human";
  if (party.kind === "agent") return "agent";
  if (party.kind === "group" || party.kind === "role") return "group_or_role";
  return "automation";
}

/** Approve and Answer requests from the Gate or an agent start here. Work starts at todo. */
export function initialState(kind: TaskKind): TaskState {
  if (kind === "approve") return "awaiting_approval";
  if (kind === "review") return "in_review";
  if (kind === "signature") return "doing";
  return "todo";
}

export const DEFAULT_ACTIONS: Record<TaskKind, readonly TaskActionDef[]> = {
  work: [
    { key: "start", label: "Start" },
    { key: "take", label: "Take" },
    { key: "submit", label: "Submit" },
    { key: "complete", label: "Done" },
    { key: "cancel", label: "Cancel", note: "optional" },
    { key: "reopen", label: "Reopen" },
  ],
  approve: [
    { key: "approve", label: "Approve", note: "optional" },
    { key: "reject", label: "Send back", note: "required" },
    { key: "delegate", label: "Hand over", note: "optional" },
    { key: "snooze", label: "Snooze" },
  ],
  review: [
    { key: "approve", label: "Looks good", note: "optional" },
    { key: "send_back", label: "Send back", note: "required" },
    { key: "delegate", label: "Hand over", note: "optional" },
    { key: "snooze", label: "Snooze" },
  ],
  answer: [
    { key: "answer", label: "Answer", note: "optional" },
    { key: "dismiss", label: "Dismiss", note: "optional" },
    { key: "delegate", label: "Hand over", note: "optional" },
    { key: "snooze", label: "Snooze" },
  ],
  unblock: [
    { key: "resolved", label: "Done, continue", note: "optional" },
    { key: "cannot", label: "Can't do this", note: "required" },
    { key: "delegate", label: "Hand over", note: "optional" },
    { key: "snooze", label: "Snooze" },
  ],
  signature: [
    { key: "cancel", label: "Cancel the request", note: "optional" },
    { key: "reopen", label: "Reopen" },
    { key: "complete", label: "Signed" },
  ],
};

export function currentParty(task: { state: TaskState; assigned: Party; reviewer?: Party; approver?: Party }): Party {
  if (task.state === "in_review" && task.reviewer) return task.reviewer;
  if (task.state === "awaiting_approval" && task.approver) return task.approver;
  return task.assigned;
}

export interface Responsible {
  personId: string | null;
  via: "taken" | "assignee" | "reviewer" | "approver" | "creator" | "none";
}

/**
 * The human a stuck task falls back to. A group or role has no person until someone Takes it.
 * An agent slot falls back to the creator when that creator is a person.
 */
export function responsiblePerson(task: Machine): Responsible {
  if (task.takenBy) return { personId: task.takenBy, via: "taken" };
  const current = currentParty(task);
  if (slotFill(current) === "human") {
    if (task.state === "in_review" && task.reviewer && sameParty(current, task.reviewer)) return { personId: current.id, via: "reviewer" };
    if (task.state === "awaiting_approval" && task.approver && sameParty(current, task.approver)) return { personId: current.id, via: "approver" };
    return { personId: current.id, via: "assignee" };
  }
  if (slotFill(task.assigned) === "human") return { personId: task.assigned.id, via: "assignee" };
  if (task.createdBy.startsWith("usr_")) return { personId: task.createdBy, via: "creator" };
  return { personId: null, via: "none" };
}

export interface BlockRow {
  id: string;
  state: TaskState;
  kind: TaskKind;
  parentTaskId?: string;
  dependsOn: readonly string[];
}

/** Open Unblock child, or a dependency that is missing or not Done. Canceled does not satisfy a dependency. */
export function isBlocked(task: { id: string; dependsOn: readonly string[] }, all: readonly BlockRow[]): boolean {
  for (const id of task.dependsOn) {
    const dep = all.find((row) => row.id === id);
    if (!dep || dep.state !== "done") return true;
  }
  return all.some((row) => row.parentTaskId === task.id && row.kind === "unblock" && isOpen(row.state));
}

export function dependencyCycle(tasks: readonly { id: string; dependsOn: readonly string[] }[], taskId: string, dependsOnId: string): boolean {
  if (dependsOnId === taskId) return true;
  const byId = new Map(tasks.map((row) => [row.id, row]));
  const seen = new Set<string>();
  const stack = [dependsOnId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined) break;
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const row = byId.get(id);
    if (row) for (const next of row.dependsOn) stack.push(next);
  }
  return false;
}

const DAY_MS = 86_400_000;

export function utcDayStart(now: number): number {
  return Math.floor(now / DAY_MS) * DAY_MS;
}

export type ReadyReason = "ready" | "due_today" | "overdue" | "blocking";

export interface TaskRecord {
  id: string;
  kind: TaskKind;
  title: string;
  summary?: string;
  why?: string;
  state: TaskState;
  blocks: TaskBlock[];
  actions: TaskActionDef[];
  assigned: Party;
  reviewer?: Party;
  approver?: Party;
  takenBy?: string;
  due?: number;
  effort?: number;
  recordId?: string;
  fileIds: string[];
  source?: TaskSource;
  parentTaskId?: string;
  dependsOn: string[];
  followers: string[];
  workingNotes: Record<string, string>;
  threadId?: string;
  reviewLoops: number;
  snoozedUntil?: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  payloadHash?: string;
  decisionId?: string;
  expiresAt?: number;
  version: number;
}

export interface TaskView {
  id: string;
  kind: TaskKind;
  title: string;
  summary?: string;
  why?: string;
  state: TaskState;
  blocked: boolean;
  blocks: TaskBlock[];
  actions: TaskActionDef[];
  assigned: Party;
  reviewer?: Party;
  approver?: Party;
  takenBy?: string;
  due?: number;
  effort?: number;
  recordId?: string;
  fileIds: string[];
  source?: TaskSource;
  parentTaskId?: string;
  dependsOn: string[];
  followers: string[];
  workingNotes: Record<string, string>;
  threadId?: string;
  reviewLoops: number;
  snoozedUntil?: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export function machineOf(task: TaskRecord): Machine {
  const machine: Machine = {
    state: task.state,
    kind: task.kind,
    assigned: task.assigned,
    reviewLoops: task.reviewLoops,
    createdBy: task.createdBy,
  };
  if (task.reviewer) machine.reviewer = task.reviewer;
  if (task.approver) machine.approver = task.approver;
  if (task.takenBy) machine.takenBy = task.takenBy;
  return machine;
}

export function toView(task: TaskRecord, all: readonly TaskRecord[]): TaskView {
  const view: TaskView = {
    id: task.id,
    kind: task.kind,
    title: task.title,
    state: task.state,
    blocked: isBlocked(task, all),
    blocks: task.blocks,
    actions: task.actions,
    assigned: task.assigned,
    fileIds: task.fileIds,
    dependsOn: task.dependsOn,
    followers: task.followers,
    workingNotes: task.workingNotes,
    reviewLoops: task.reviewLoops,
    createdBy: task.createdBy,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
  if (task.summary !== undefined) view.summary = task.summary;
  if (task.why !== undefined) view.why = task.why;
  if (task.reviewer) view.reviewer = task.reviewer;
  if (task.approver) view.approver = task.approver;
  if (task.takenBy !== undefined) view.takenBy = task.takenBy;
  if (task.due !== undefined) view.due = task.due;
  if (task.effort !== undefined) view.effort = task.effort;
  if (task.recordId !== undefined) view.recordId = task.recordId;
  if (task.source) view.source = task.source;
  if (task.parentTaskId !== undefined) view.parentTaskId = task.parentTaskId;
  if (task.threadId !== undefined) view.threadId = task.threadId;
  if (task.snoozedUntil !== undefined) view.snoozedUntil = task.snoozedUntil;
  return view;
}

export function isCurrentActor(task: Machine, id: string): boolean {
  const party = currentParty(task);
  if (party.kind === "group" || party.kind === "role") return task.takenBy === id;
  return party.id === id;
}

export function isAssignee(task: Machine, id: string): boolean {
  if (task.takenBy === id) return true;
  if (task.assigned.kind === "group" || task.assigned.kind === "role") return false;
  return task.assigned.id === id;
}

export function blocksAnother(task: TaskRecord, all: readonly TaskRecord[]): boolean {
  if (!isOpen(task.state)) return false;
  return all.some((other) => {
    if (other.id === task.id || !isOpen(other.state) || !other.dependsOn.includes(task.id)) return false;
    if (other.source?.kind === "run") return true;
    return other.assigned.id !== task.assigned.id;
  });
}

export function needsYouReason(
  task: TaskRecord,
  principalId: string,
  now: number,
  all: readonly TaskRecord[],
): { reason: ReadyReason; handledBy?: string } | null {
  if (!isOpen(task.state)) return null;
  if (task.snoozedUntil !== undefined && task.snoozedUntil > now) return null;
  const machine = machineOf(task);
  const actor = isCurrentActor(machine, principalId);
  const assignee = isAssignee(machine, principalId);
  if (!actor && !assignee) return null;
  const blocked = isBlocked(task, all);
  const request = task.kind === "approve" || task.kind === "review" || task.kind === "answer" || task.kind === "unblock";
  const readyState = task.state === "todo" || task.state === "doing"
    || (task.kind === "approve" && task.state === "awaiting_approval")
    || (task.kind === "review" && task.state === "in_review");
  let reason: ReadyReason | null = null;
  if (actor && request && readyState && !blocked) reason = "ready";
  else if (assignee && task.due !== undefined) {
    const start = utcDayStart(now);
    if (task.due < start) reason = "overdue";
    else if (task.due < start + DAY_MS) reason = "due_today";
  }
  if (!reason && assignee && blocksAnother(task, all)) reason = "blocking";
  if (!reason) return null;
  if (task.takenBy && task.takenBy !== principalId) return { reason, handledBy: task.takenBy };
  return { reason };
}

function fail(reason: string): StepNo {
  return { ok: false, code: "validation.precondition_failed", reason };
}

function slotFor(task: Machine, action: string): SlotName | "any" {
  if (action === "cancel" || action === "reopen") return "any";
  if (action === "send_back") return "reviewer";
  if (action === "reject") return "approver";
  if (action === "approve" && task.state === "in_review") return "reviewer";
  if (action === "approve") return "approver";
  return "assigned";
}

function partyOf(task: Machine, slot: SlotName): Party | undefined {
  if (slot === "assigned") return task.assigned;
  if (slot === "reviewer") return task.reviewer;
  return task.approver;
}

function isParticipant(task: Machine, actor: Actor): boolean {
  if (actor.id === task.createdBy || actor.id === task.takenBy) return true;
  if (actor.id === task.assigned.id) return true;
  if (task.reviewer && actor.id === task.reviewer.id) return true;
  if (task.approver && actor.id === task.approver.id) return true;
  return false;
}

/** A group or role with nobody on it yet is taken by the first person who acts. After that, only the taker moves it. */
function holds(task: Machine, party: Party, actor: Actor): boolean {
  if (party.kind === "group" || party.kind === "role") {
    if (task.takenBy) return task.takenBy === actor.id;
    return true;
  }
  return party.id === actor.id;
}

function destination(task: Machine, action: string): TaskState | null {
  if (action === "cancel") return isOpen(task.state) ? "canceled" : null;
  if (action === "reopen") return task.state === "done" || task.state === "canceled" ? "todo" : null;
  if (action === "start") return task.state === "todo" ? "doing" : null;
  if (action === "submit") {
    if (task.state !== "todo" && task.state !== "doing") return null;
    if (task.reviewer) return "in_review";
    if (task.approver) return "awaiting_approval";
    return "done";
  }
  if (action === "complete") {
    if (task.state !== "todo" && task.state !== "doing") return null;
    if (task.reviewer || task.approver) return null;
    return "done";
  }
  if (action === "send_back") return task.state === "in_review" ? "doing" : null;
  if (action === "approve") {
    if (task.state === "in_review") return task.approver ? "awaiting_approval" : "done";
    if (task.state === "awaiting_approval") return "done";
    return null;
  }
  if (action === "reject") return task.state === "awaiting_approval" ? "doing" : null;
  if (action === "answer" || action === "resolved") return task.state === "todo" || task.state === "doing" ? "done" : null;
  if (action === "dismiss" || action === "cannot") return task.state === "todo" || task.state === "doing" ? "canceled" : null;
  return null;
}

/**
 * One step of ARCH 4.7. Refusals leave the caller to keep the previous state.
 * Reviewer and approver may not equal the assignee unless the Space allows it.
 * A reviewer agent may send work back `reviewLoopLimit` times (default 2); the next send-back needs a person.
 */
export function step(task: Machine, action: string, opts: { note?: string; actor: Actor; policy: Policy }): StepResult {
  if (!(TRANSITION_ACTIONS as readonly string[]).includes(action)) return fail("That action is not a transition");
  if ((action === "answer" || action === "dismiss") && task.kind !== "answer") return fail("Answer and dismiss belong to an Answer task");
  if ((action === "resolved" || action === "cannot") && task.kind !== "unblock") return fail("Resolve belongs to an Unblock task");
  if (NOTE_REQUIRED.has(action) && !(opts.note && opts.note.trim().length > 0)) return fail("A note is required");
  const policy = opts.policy;
  if (!policy.allowSelfReview) {
    if ((action === "send_back" || (action === "approve" && task.state === "in_review")) && task.reviewer && sameParty(task.reviewer, task.assigned)) {
      return fail("The reviewer and the assignee have to be different people");
    }
    if ((action === "reject" || (action === "approve" && task.state === "awaiting_approval")) && task.approver && sameParty(task.approver, task.assigned)) {
      return fail("The approver and the assignee have to be different people");
    }
  }
  if (policy.requireHumanApprover && action === "approve" && task.state === "awaiting_approval") {
    if (opts.actor.kind !== "person") return fail("A person has to approve this");
    if (task.approver && task.approver.kind !== "person") return fail("The approver slot has to be a person");
  }
  if (action === "send_back" && task.reviewer?.kind === "agent" && opts.actor.kind === "agent" && task.reviewLoops >= policy.reviewLoopLimit) {
    return fail("A person decides after the review loop limit");
  }
  const slot = slotFor(task, action);
  if (slot === "any") {
    if (!isParticipant(task, opts.actor)) return fail("You are not on this task");
  } else {
    const party = partyOf(task, slot);
    if (!party) return fail("That slot is empty");
    if (!holds(task, party, opts.actor)) return fail("You are not the person this step is waiting on");
  }
  const to = destination(task, action);
  if (!to) return fail("That move is not in the task state table");
  const events: StepOk["events"] = [];
  let takenBy: string | undefined;
  const acted = slot === "any" ? undefined : partyOf(task, slot);
  if (acted && (acted.kind === "group" || acted.kind === "role") && !task.takenBy) {
    takenBy = opts.actor.id;
    events.push("task.handled");
  }
  if (action === "send_back") events.push("task.sent_back");
  if (action === "reject") events.push("task.rejected");
  if (action === "approve") events.push("task.approved");
  if (to === "done") events.push("task.completed");
  const reviewLoops = action === "send_back" ? task.reviewLoops + 1 : action === "reopen" ? 0 : task.reviewLoops;
  const ok: StepOk = { ok: true, to, reviewLoops, events };
  if (takenBy !== undefined) ok.takenBy = takenBy;
  return ok;
}

/** The action `tasks.transition` uses when the caller names the destination instead of the verb. */
export function actionForTarget(task: Machine, to: TaskState): string | null {
  const from = task.state;
  if (from === to) return null;
  if (isOpen(from) && to === "canceled") return "cancel";
  if ((from === "done" || from === "canceled") && to === "todo") return "reopen";
  if (from === "todo" && to === "doing") return "start";
  if ((from === "todo" || from === "doing") && to === "in_review") return task.reviewer ? "submit" : null;
  if ((from === "todo" || from === "doing") && to === "awaiting_approval") return !task.reviewer && task.approver ? "submit" : null;
  if ((from === "todo" || from === "doing") && to === "done") return !task.reviewer && !task.approver ? "submit" : null;
  if (from === "in_review" && to === "doing") return "send_back";
  if (from === "in_review" && to === "awaiting_approval") return task.approver ? "approve" : null;
  if (from === "in_review" && to === "done") return task.approver ? null : "approve";
  if (from === "awaiting_approval" && to === "done") return "approve";
  if (from === "awaiting_approval" && to === "doing") return "reject";
  return null;
}
