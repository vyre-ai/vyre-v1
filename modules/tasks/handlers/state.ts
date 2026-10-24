// Task state machine (ARCH 4.7, spec 2.8). Blocked is derived, never stored.
// Slots are assigned, reviewer and approver. Each slot is a person (human), agent, group, role or automation.

export type TaskState = 'todo' | 'doing' | 'in_review' | 'awaiting_approval' | 'done' | 'canceled';
export type Kind = 'work' | 'approve' | 'review' | 'answer' | 'unblock' | 'signature';
export type PartyKind = 'person' | 'agent' | 'group' | 'role' | 'automation';
export type Party = { kind: PartyKind; id: string };
export type SourceKind = 'chat' | 'run' | 'gate' | 'journey' | 'manual';

export interface TaskAction { key: string; label: string; note?: 'required' | 'optional' }
export interface Block { type: string; v?: number; data: unknown }

export interface Task {
  id: string;
  kind: Kind;
  title: string;
  summary?: string;
  why?: string;
  state: TaskState;
  blocks: Block[];
  actions: TaskAction[];
  assigned: Party;
  reviewer?: Party;
  approver?: Party;
  takenBy?: string;
  due?: number;
  effort?: number;
  recordId?: string;
  fileIds: string[];
  source?: { kind: SourceKind; id: string };
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
  expiresAt?: number;
  payloadHash?: string;
  boundDevice?: string;
  decisionId?: string;
  narrowedFor?: string;
}

export interface Policy {
  reviewLoopLimit: number;
  allowSelfReview: boolean;
  requireHumanApprover: boolean;
}

export const DEFAULT_POLICY: Policy = { reviewLoopLimit: 2, allowSelfReview: false, requireHumanApprover: false };

export interface Actor { kind: 'person' | 'agent'; id: string; super?: boolean }

export const OPEN_STATES: readonly TaskState[] = ['todo', 'doing', 'in_review', 'awaiting_approval'];

export function isOpen(state: TaskState): boolean {
  return state === 'todo' || state === 'doing' || state === 'in_review' || state === 'awaiting_approval';
}

export function sameParty(a?: Party, b?: Party): boolean {
  return !!a && !!b && a.kind === b.kind && a.id === b.id;
}

export function initialState(kind: Kind): TaskState {
  if (kind === 'approve') return 'awaiting_approval';
  if (kind === 'review') return 'in_review';
  if (kind === 'signature') return 'doing';
  return 'todo';
}

export function defaultActions(kind: Kind): TaskAction[] {
  if (kind === 'approve') return [
    { key: 'approve', label: 'Approve', note: 'optional' },
    { key: 'reject', label: 'Send back', note: 'required' },
    { key: 'delegate', label: 'Hand over', note: 'optional' },
    { key: 'snooze', label: 'Snooze' },
  ];
  if (kind === 'review') return [
    { key: 'approve', label: 'Looks good', note: 'optional' },
    { key: 'send_back', label: 'Send back', note: 'required' },
    { key: 'delegate', label: 'Hand over', note: 'optional' },
    { key: 'snooze', label: 'Snooze' },
  ];
  if (kind === 'answer') return [
    { key: 'answer', label: 'Answer', note: 'optional' },
    { key: 'dismiss', label: 'Dismiss', note: 'optional' },
    { key: 'delegate', label: 'Hand over', note: 'optional' },
    { key: 'snooze', label: 'Snooze' },
  ];
  if (kind === 'unblock') return [
    { key: 'resolved', label: 'Done, continue', note: 'optional' },
    { key: 'cannot', label: "Can't do this", note: 'required' },
    { key: 'delegate', label: 'Hand over', note: 'optional' },
    { key: 'snooze', label: 'Snooze' },
  ];
  if (kind === 'signature') return [
    { key: 'cancel', label: 'Cancel the request', note: 'optional' },
    { key: 'reopen', label: 'Reopen' },
  ];
  return [
    { key: 'start', label: 'Start' },
    { key: 'take', label: 'Take' },
    { key: 'submit', label: 'Submit' },
    { key: 'complete', label: 'Done' },
    { key: 'cancel', label: 'Cancel', note: 'optional' },
    { key: 'reopen', label: 'Reopen' },
  ];
}

export function blankTask(over: Partial<Task> & Pick<Task, 'state' | 'kind'>): Task {
  const kind = over.kind;
  return {
    id: over.id ?? 'tsk_blank',
    kind,
    title: over.title ?? 'Task',
    state: over.state,
    blocks: over.blocks ?? [],
    actions: over.actions ?? defaultActions(kind),
    assigned: over.assigned ?? { kind: 'person', id: 'usr_a1b2c3' },
    fileIds: over.fileIds ?? [],
    dependsOn: over.dependsOn ?? [],
    followers: over.followers ?? [],
    workingNotes: over.workingNotes ?? {},
    reviewLoops: over.reviewLoops ?? 0,
    createdBy: over.createdBy ?? 'usr_a1b2c3',
    createdAt: over.createdAt ?? 1_760_000_000_000,
    updatedAt: over.updatedAt ?? 1_760_000_000_000,
    summary: over.summary,
    why: over.why,
    reviewer: over.reviewer,
    approver: over.approver,
    takenBy: over.takenBy,
    due: over.due,
    effort: over.effort,
    recordId: over.recordId,
    source: over.source,
    parentTaskId: over.parentTaskId,
    threadId: over.threadId,
    snoozedUntil: over.snoozedUntil,
    expiresAt: over.expiresAt,
    payloadHash: over.payloadHash,
    boundDevice: over.boundDevice,
    decisionId: over.decisionId,
    narrowedFor: over.narrowedFor,
  };
}

export function cloneTask(task: Task): Task {
  return {
    ...task,
    blocks: task.blocks.map((b) => ({ ...b })),
    actions: task.actions.map((a) => ({ ...a })),
    assigned: { ...task.assigned },
    reviewer: task.reviewer ? { ...task.reviewer } : undefined,
    approver: task.approver ? { ...task.approver } : undefined,
    fileIds: [...task.fileIds],
    dependsOn: [...task.dependsOn],
    followers: [...task.followers],
    workingNotes: { ...task.workingNotes },
    source: task.source ? { ...task.source } : undefined,
  };
}

export function hasNote(note?: string): boolean {
  return typeof note === 'string' && note.trim().length > 0;
}

/** Reviewer or approver equals the assignee on a Work task, which the floor forbids unless the Space allows it. */
export function selfReviewClash(task: Task, action: string, policy: Policy): boolean {
  if (policy.allowSelfReview || task.kind !== 'work') return false;
  const reviewerSame = sameParty(task.reviewer, task.assigned);
  const approverSame = sameParty(task.approver, task.assigned);
  if (reviewerSame && task.reviewer && (action === 'submit' || ((action === 'approve' || action === 'send_back') && task.state === 'in_review'))) return true;
  if (approverSame && task.approver && action === 'submit' && !task.reviewer) return true;
  if (approverSame && task.approver && (action === 'approve' || action === 'reject') && task.state === 'awaiting_approval') return true;
  return false;
}

function holds(task: Task, actor: Actor, party?: Party): boolean {
  if (!party) return false;
  if (party.kind === 'group' || party.kind === 'role') {
    if (actor.kind !== 'person') return false;
    if (task.takenBy && task.takenBy !== actor.id) return false;
    return true;
  }
  return party.kind === actor.kind && party.id === actor.id;
}

function actorMay(task: Task, action: string, actor: Actor): boolean {
  if (actor.super) return true;
  if (action === 'cancel' || action === 'reopen') {
    return holds(task, actor, task.assigned) || holds(task, actor, task.reviewer) || holds(task, actor, task.approver) || task.createdBy === actor.id;
  }
  if ((action === 'approve' || action === 'send_back') && task.state === 'in_review') return holds(task, actor, task.reviewer);
  if (action === 'approve' && task.state === 'awaiting_approval') return holds(task, actor, task.approver);
  if (action === 'reject') return holds(task, actor, task.approver);
  return holds(task, actor, task.assigned);
}

export interface TransitionEnv { note?: string; actor: Actor; policy: Policy; now?: number }

/**
 * The only legal edges. Returns null when the action is not legal from this state.
 * A reviewer agent may send work back `reviewLoopLimit` times (default 2); after that a person decides.
 */
export function decide(task: Task, action: string, env: TransitionEnv): { to: TaskState; reviewLoops: number } | null {
  const policy = env.policy;
  if (selfReviewClash(task, action, policy)) return null;
  if (action === 'send_back' && task.reviewer?.kind === 'agent' && env.actor.kind === 'agent' && task.reviewLoops >= policy.reviewLoopLimit) return null;
  if (policy.requireHumanApprover && action === 'approve' && task.state === 'awaiting_approval') {
    if (env.actor.kind !== 'person') return null;
    if (task.approver && task.approver.kind !== 'person') return null;
  }

  let to: TaskState | null = null;
  if (task.kind === 'signature') {
    if (action === 'cancel') to = isOpen(task.state) ? 'canceled' : null;
    else if (action === 'reopen') to = task.state === 'done' || task.state === 'canceled' ? 'todo' : null;
    else if (action === 'start') to = task.state === 'todo' ? 'doing' : null;
    else if (action === 'complete') to = task.state === 'doing' ? 'done' : null;
    else to = null;
  } else {
    switch (action) {
      case 'start':
        to = task.state === 'todo' ? 'doing' : null;
        break;
      case 'submit':
        if (task.state !== 'todo' && task.state !== 'doing') to = null;
        else if (task.reviewer) to = 'in_review';
        else if (task.approver) to = 'awaiting_approval';
        else to = 'done';
        break;
      case 'approve':
        if (task.state === 'in_review') to = task.approver ? 'awaiting_approval' : 'done';
        else if (task.state === 'awaiting_approval') to = 'done';
        else to = null;
        break;
      case 'send_back':
        to = task.state === 'in_review' && hasNote(env.note) ? 'doing' : null;
        break;
      case 'reject':
        to = task.state === 'awaiting_approval' && hasNote(env.note) ? 'doing' : null;
        break;
      case 'cancel':
        to = isOpen(task.state) ? 'canceled' : null;
        break;
      case 'reopen':
        to = task.state === 'done' || task.state === 'canceled' ? 'todo' : null;
        break;
      case 'complete':
        if (task.reviewer || task.approver) to = null;
        else to = task.state === 'todo' || task.state === 'doing' ? 'done' : null;
        break;
      case 'answer':
        to = task.kind === 'answer' && (task.state === 'todo' || task.state === 'doing') ? 'done' : null;
        break;
      case 'dismiss':
        to = task.kind === 'answer' && isOpen(task.state) ? 'canceled' : null;
        break;
      case 'resolved':
        to = task.kind === 'unblock' && (task.state === 'todo' || task.state === 'doing') ? 'done' : null;
        break;
      case 'cannot':
        to = task.kind === 'unblock' && isOpen(task.state) && hasNote(env.note) ? 'canceled' : null;
        break;
      default:
        to = null;
    }
  }
  if (to === null) return null;
  if (!actorMay(task, action, env.actor)) return null;
  return { to, reviewLoops: action === 'send_back' ? task.reviewLoops + 1 : task.reviewLoops };
}

export function applyTransition(task: Task, action: string, env: TransitionEnv): { ok: true; task: Task; action: string } | { ok: false; code: 'validation.precondition_failed' } {
  const d = decide(task, action, env);
  if (!d) return { ok: false, code: 'validation.precondition_failed' };
  const next = cloneTask(task);
  next.state = d.to;
  next.reviewLoops = d.reviewLoops;
  if (env.now !== undefined) next.updatedAt = env.now;
  if (!env.actor.super && action === 'start' && (task.assigned.kind === 'group' || task.assigned.kind === 'role') && !next.takenBy) {
    next.takenBy = env.actor.id;
  }
  return { ok: true, task: next, action };
}

/** Prefer the specific action when more than one edge reaches `to`. */
const TARGET_ORDER = ['start', 'submit', 'approve', 'send_back', 'reject', 'answer', 'resolved', 'complete', 'cannot', 'dismiss', 'cancel', 'reopen'];

export function transitionTo(task: Task, to: TaskState, env: TransitionEnv): { ok: true; task: Task; action: string } | { ok: false; code: 'validation.precondition_failed' } {
  for (const action of TARGET_ORDER) {
    const out = applyTransition(task, action, env);
    if (out.ok && out.task.state === to) return out;
  }
  return { ok: false, code: 'validation.precondition_failed' };
}

/** Open Unblock child, or a dependency that is missing or not done. Done and canceled are never blocked. */
export function deriveBlocked(task: Task, all: readonly Task[]): boolean {
  if (!isOpen(task.state)) return false;
  for (const other of all) {
    if (other.parentTaskId === task.id && other.kind === 'unblock' && isOpen(other.state)) return true;
  }
  for (const id of task.dependsOn) {
    const dep = all.find((t) => t.id === id);
    if (!dep || dep.state !== 'done') return true;
  }
  return false;
}

/**
 * Who must act. A group or role has no person until Take locks `takenBy`.
 * After the review-loop limit, an agent reviewer is no longer the responsible party: a person (approver, else assignee) is.
 */
export function responsiblePerson(task: Task, policy: Policy = DEFAULT_POLICY): Party | null {
  if (task.takenBy) return { kind: 'person', id: task.takenBy };
  if (task.state === 'in_review' && task.reviewer?.kind === 'agent' && task.reviewLoops >= policy.reviewLoopLimit) {
    if (task.approver?.kind === 'person') return task.approver;
    if (task.assigned.kind === 'person') return task.assigned;
    return null;
  }
  const slot = task.state === 'awaiting_approval' ? task.approver : task.state === 'in_review' ? task.reviewer : task.assigned;
  if (!slot) return task.assigned.kind === 'person' || task.assigned.kind === 'agent' ? task.assigned : null;
  if (slot.kind === 'group' || slot.kind === 'role') return null;
  return slot;
}

export function slotClash(task: Task, policy: Policy): string | null {
  if (!policy.allowSelfReview && task.kind === 'work') {
    if (sameParty(task.reviewer, task.assigned)) return 'reviewer matches assignee';
    if (sameParty(task.approver, task.assigned)) return 'approver matches assignee';
  }
  if (policy.requireHumanApprover && task.approver && task.approver.kind !== 'person') return 'approver must be a person';
  return null;
}
