// tasks (lane L6): one handler per capability of manifests/tasks.ts. Handlers are the only place logic lives.
import { actOnTask, sealOf, TaskErr, type ActInput } from './handlers/act.ts';
import {
  cloneTask, DEFAULT_POLICY, defaultActions, deriveBlocked, initialState, isOpen, slotClash, transitionTo,
  type Actor, type Kind, type Party, type Policy, type SourceKind, type Task, type TaskState,
} from './handlers/state.ts';

export interface TaskCtx {
  space: string;
  principal: { kind: string; id: string };
  actingFor?: string;
  device?: string;
  trace: { traceId: string };
  now(): number;
  db?: { all(sql: string, ...args: unknown[]): unknown[]; run(sql: string, ...args: unknown[]): { changes: number } };
  emit(name: string, subject: string, payload: unknown): { id?: string };
  policy?: Partial<Policy>;
  approval?: string;
  canAct?(party: Party): boolean;
  holds?(party: Party): boolean;
}

const spaces = new Map<string, Map<string, Task>>();
const histories = new Map<string, Map<string, Hist[]>>();
const chains = new Map<string, Map<string, Party>>();
let seq = 0;

interface Hist { at: number; type: string; by: string; note?: string; eventId: string }

function mint(prefix: string, now: number): string {
  seq += 1;
  return `${prefix}_${now.toString(36)}${seq.toString(36)}`;
}

function bucket(space: string): Map<string, Task> {
  let m = spaces.get(space);
  if (!m) { m = new Map(); spaces.set(space, m); }
  return m;
}

function histBucket(space: string): Map<string, Hist[]> {
  let m = histories.get(space);
  if (!m) { m = new Map(); histories.set(space, m); }
  return m;
}

export function setDelegateChain(space: string, fromId: string, next: Party | null): void {
  let m = chains.get(space);
  if (!m) { m = new Map(); chains.set(space, m); }
  if (next === null) m.delete(fromId);
  else m.set(fromId, next);
}

export function tasksIn(space: string): Task[] {
  return [...bucket(space).values()].map(cloneTask);
}

export function resetSpace(space: string): void {
  spaces.delete(space);
  histories.delete(space);
  chains.delete(space);
}

function policyOf(ctx: TaskCtx): Policy {
  return { ...DEFAULT_POLICY, ...ctx.policy };
}

function actorOf(ctx: TaskCtx): Actor {
  return { kind: ctx.principal.kind === 'agent' ? 'agent' : 'person', id: ctx.principal.id };
}

function traceOf(ctx: TaskCtx): string {
  return ctx.trace?.traceId || '0'.repeat(32);
}

function fail(ctx: TaskCtx, code: string, message: string): never {
  throw new TaskErr(code, message, traceOf(ctx));
}

function persist(ctx: TaskCtx, task: Task): void {
  if (!ctx.db) return;
  try {
    const doc = JSON.stringify(task);
    ctx.db.run(
      `INSERT INTO tasks_meta (id, kind, assigned, reviewer, approver, taken_by, snoozed_until, why, blocks, source_kind, source_id, parent_task, depends_on, followers, working_notes, review_loops, decision_id, payload_hash, expires_at, due, effort, thread_id, state, title, summary, created_by, created_at, updated_at, file_ids, record_id, actions, bound_device, doc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET state = excluded.state, doc = excluded.doc, updated_at = excluded.updated_at, taken_by = excluded.taken_by, review_loops = excluded.review_loops, working_notes = excluded.working_notes`,
      task.id, task.kind, JSON.stringify(task.assigned), task.reviewer ? JSON.stringify(task.reviewer) : null, task.approver ? JSON.stringify(task.approver) : null,
      task.takenBy ?? null, task.snoozedUntil ?? null, task.why ?? null, JSON.stringify(task.blocks), task.source?.kind ?? null, task.source?.id ?? null,
      task.parentTaskId ?? null, JSON.stringify(task.dependsOn), JSON.stringify(task.followers), JSON.stringify(task.workingNotes), task.reviewLoops,
      task.decisionId ?? null, task.payloadHash ?? null, task.expiresAt ?? null, task.due ?? null, task.effort ?? null, task.threadId ?? null,
      task.state, task.title, task.summary ?? null, task.createdBy, task.createdAt, task.updatedAt, JSON.stringify(task.fileIds), task.recordId ?? null,
      JSON.stringify(task.actions), task.boundDevice ?? null, doc,
    );
  } catch {
    /* memory remains the copy when the table is absent */
  }
}

function save(ctx: TaskCtx, task: Task): Task {
  const stored = cloneTask(task);
  bucket(ctx.space).set(stored.id, stored);
  persist(ctx, stored);
  return stored;
}

function allOf(ctx: TaskCtx): Task[] {
  return [...bucket(ctx.space).values()];
}

function must(ctx: TaskCtx, id: string): Task {
  const t = bucket(ctx.space).get(id);
  if (!t) fail(ctx, 'validation.precondition_failed', 'Task not found.');
  return cloneTask(t);
}

function strip<T extends Record<string, unknown>>(row: T): T {
  for (const k of Object.keys(row)) if (row[k] === undefined) delete row[k];
  return row;
}

function toPublic(task: Task, all: readonly Task[], ctx: TaskCtx): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: task.id,
    kind: task.kind,
    title: task.title,
    summary: task.summary,
    why: task.why,
    state: task.state,
    blocked: deriveBlocked(task, all),
    blocks: task.blocks,
    actions: task.actions,
    assigned: task.assigned,
    reviewer: task.reviewer,
    approver: task.approver,
    takenBy: task.takenBy,
    due: task.due,
    effort: task.effort,
    recordId: task.recordId,
    fileIds: task.fileIds,
    source: task.source,
    parentTaskId: task.parentTaskId,
    dependsOn: task.dependsOn,
    followers: task.followers,
    workingNotes: task.workingNotes,
    threadId: task.threadId,
    reviewLoops: task.reviewLoops,
    snoozedUntil: task.snoozedUntil,
    createdBy: task.createdBy,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
  if (task.narrowedFor && ctx.principal.id === task.narrowedFor) {
    delete row.summary;
    delete row.why;
    row.workingNotes = {};
    row.fileIds = [];
  }
  return strip(row);
}

function present(ctx: TaskCtx, task: Task): Record<string, unknown> {
  return toPublic(task, allOf(ctx), ctx);
}

function emit(ctx: TaskCtx, name: string, taskId: string, payload: Record<string, unknown>, note?: string): void {
  const body = strip({ ...payload });
  let eventId = mint('evt', ctx.now());
  try {
    const env = ctx.emit(name, `task/${taskId}`, body);
    if (env && typeof env.id === 'string' && /^evt_[a-z0-9]+$/.test(env.id)) eventId = env.id;
  } catch {
    /* a test double may omit emit */
  }
  const list = histBucket(ctx.space).get(taskId) ?? [];
  const entry: Hist = { at: ctx.now(), type: name, by: ctx.principal.id, eventId };
  if (note) entry.note = note;
  list.push(entry);
  histBucket(ctx.space).set(taskId, list);
}

function emitTransition(ctx: TaskCtx, before: Task, after: Task, action: string, note?: string): void {
  const base: Record<string, unknown> = { taskId: after.id, kind: after.kind, from: before.state, to: after.state };
  if (note) base.note = note;
  emit(ctx, 'task.transitioned', after.id, base, note);
  emit(ctx, 'task.updated', after.id, { taskId: after.id, fields: ['state'] });
  if (action === 'send_back') emit(ctx, 'task.sent_back', after.id, { taskId: after.id, by: ctx.principal.id, note: note ?? '', reviewLoops: after.reviewLoops }, note);
  if (action === 'reject') emit(ctx, 'task.rejected', after.id, { taskId: after.id, by: ctx.principal.id, note: note ?? '' }, note);
  if (action === 'approve') {
    const approved: Record<string, unknown> = { taskId: after.id, kind: after.kind, by: ctx.principal.id };
    if (ctx.actingFor) approved.forPerson = ctx.actingFor;
    emit(ctx, 'task.approved', after.id, approved);
  }
  if (after.state === 'done') {
    const done: Record<string, unknown> = { taskId: after.id, kind: after.kind };
    if (after.recordId) done.recordId = after.recordId;
    if (after.source) done.source = after.source;
    emit(ctx, 'task.completed', after.id, done);
  }
  if (!before.takenBy && after.takenBy && (before.assigned.kind === 'role' || before.assigned.kind === 'group' || before.approver?.kind === 'role' || before.reviewer?.kind === 'role')) {
    emit(ctx, 'task.handled', after.id, { taskId: after.id, by: after.takenBy });
  }
}

function can(ctx: TaskCtx, party: Party): boolean {
  if (ctx.canAct) return ctx.canAct(party) !== false;
  return true;
}

function walk(ctx: TaskCtx, start: Party): { party: Party; narrowed: boolean } | null {
  let cur: Party | undefined = start;
  const seen = new Set<string>();
  let narrowed = false;
  for (let i = 0; i < 8 && cur; i++) {
    const key = `${cur.kind}:${cur.id}`;
    if (seen.has(key)) return null;
    seen.add(key);
    if (can(ctx, cur)) return { party: cur, narrowed };
    narrowed = true;
    cur = chains.get(ctx.space)?.get(cur.id);
  }
  return null;
}

function isMine(task: Task, me: string, ctx: TaskCtx): boolean {
  if (task.takenBy === me) return true;
  const slots = [task.assigned, task.reviewer, task.approver].filter((p): p is Party => !!p);
  for (const p of slots) {
    if (p.id === me) return true;
    if (ctx.holds && ctx.holds(p)) return true;
  }
  return false;
}

const DAY = 86_400_000;

function readyReason(task: Task, all: Task[], me: string, now: number): 'ready' | 'due_today' | 'overdue' | 'blocking' | null {
  if (!isOpen(task.state)) return null;
  if (task.snoozedUntil !== undefined && task.snoozedUntil > now) return null;
  const blocked = deriveBlocked(task, all);
  const actionable = !blocked && (
    (task.kind === 'approve' && task.state === 'awaiting_approval')
    || (task.kind === 'review' && task.state === 'in_review')
    || ((task.kind === 'answer' || task.kind === 'unblock') && (task.state === 'todo' || task.state === 'doing'))
  );
  if (actionable) return 'ready';
  if (task.due !== undefined && Math.floor(task.due / DAY) < Math.floor(now / DAY)) return 'overdue';
  if (task.due !== undefined && Math.floor(task.due / DAY) === Math.floor(now / DAY)) return 'due_today';
  if (!blocked && blocksOther(task, all, me)) return 'blocking';
  return null;
}

function blocksOther(task: Task, all: Task[], me: string): boolean {
  for (const other of all) {
    if (other.id === task.id || !isOpen(other.state)) continue;
    const who = other.takenBy ?? other.assigned.id;
    if (who === me) continue;
    if (other.dependsOn.includes(task.id)) return true;
    if (task.kind === 'unblock' && task.parentTaskId === other.id) return true;
  }
  return false;
}

function page<T>(rows: T[], cursor?: string, limit?: number): { rows: T[]; next?: string; total: number } {
  const total = rows.length;
  const start = cursor && /^[0-9]+$/.test(cursor) ? Number(cursor) : 0;
  const n = typeof limit === 'number' && limit > 0 ? Math.min(limit, 500) : 50;
  const slice = rows.slice(start, start + n);
  const next = start + n < total ? String(start + n) : undefined;
  return { rows: slice, next, total };
}

function party(v: unknown): Party | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const p = v as Party;
  if (typeof p.id !== 'string' || typeof p.kind !== 'string') return undefined;
  return { kind: p.kind, id: p.id };
}

export const handlers = {
  'tasks.create': async (ctx: TaskCtx, input: Record<string, unknown>) => {
    const title = String(input.title ?? '');
    if (!title) fail(ctx, 'validation.precondition_failed', 'Title is required.');
    const kind = (typeof input.kind === 'string' ? input.kind : 'work') as Kind;
    const assigned = party(input.assigned);
    if (!assigned) fail(ctx, 'validation.precondition_failed', 'Assigned is required.');
    const now = ctx.now();
    const task = cloneTask({
      id: mint('tsk', now),
      kind,
      title,
      state: initialState(kind),
      blocks: Array.isArray(input.blocks) ? input.blocks as Task['blocks'] : [],
      actions: Array.isArray(input.actions) ? input.actions as Task['actions'] : defaultActions(kind),
      assigned,
      fileIds: Array.isArray(input.fileIds) ? input.fileIds as string[] : [],
      dependsOn: Array.isArray(input.dependsOn) ? input.dependsOn as string[] : [],
      followers: [],
      workingNotes: {},
      reviewLoops: 0,
      createdBy: ctx.principal.id,
      createdAt: now,
      updatedAt: now,
      summary: typeof input.summary === 'string' ? input.summary : undefined,
      why: typeof input.why === 'string' ? input.why : undefined,
      reviewer: party(input.reviewer),
      approver: party(input.approver),
      due: typeof input.due === 'number' ? input.due : undefined,
      effort: typeof input.effort === 'number' ? input.effort : undefined,
      recordId: typeof input.recordId === 'string' ? input.recordId : undefined,
      source: input.source && typeof input.source === 'object' ? input.source as Task['source'] : undefined,
      parentTaskId: typeof input.parentTaskId === 'string' ? input.parentTaskId : undefined,
      expiresAt: typeof input.expiresAt === 'number' ? input.expiresAt : undefined,
    });
    if (kind === 'approve' && !task.approver) task.approver = { ...assigned };
    if (kind === 'review' && !task.reviewer) task.reviewer = { ...assigned };
    const clash = slotClash(task, policyOf(ctx));
    if (clash) fail(ctx, 'validation.precondition_failed', clash);
    task.payloadHash = sealOf(task);
    if (ctx.device) task.boundDevice = ctx.device;
    task.workingNotes = { ...task.workingNotes, payload_hash: task.payloadHash };
    if (task.boundDevice) task.workingNotes.bound_device = task.boundDevice;
    save(ctx, task);
    const created: Record<string, unknown> = { taskId: task.id, kind: task.kind, title: task.title, assigned: task.assigned };
    if (task.recordId) created.recordId = task.recordId;
    if (task.source) created.source = task.source;
    emit(ctx, 'task.created', task.id, created);
    if (kind === 'approve' || kind === 'review' || kind === 'answer' || kind === 'unblock') {
      const req: Record<string, unknown> = { taskId: task.id, kind, title: task.title, assigned: task.approver ?? task.reviewer ?? task.assigned };
      if (task.expiresAt !== undefined) req.expiresAt = task.expiresAt;
      emit(ctx, 'task.requested', task.id, req);
    }
    emit(ctx, 'task.assigned', task.id, { taskId: task.id, slot: 'assigned', to: task.assigned, from: null });
    if (task.reviewer) emit(ctx, 'task.assigned', task.id, { taskId: task.id, slot: 'reviewer', to: task.reviewer, from: null });
    if (task.approver) emit(ctx, 'task.assigned', task.id, { taskId: task.id, slot: 'approver', to: task.approver, from: null });
    return { task: present(ctx, task) };
  },

  'tasks.get': async (ctx: TaskCtx, input: { taskId: string }) => ({ task: present(ctx, must(ctx, input.taskId)) }),

  'tasks.list': async (ctx: TaskCtx, input: Record<string, unknown>) => {
    const me = ctx.principal.id;
    let rows = allOf(ctx).filter((t) => {
      if (!input.includeSnoozed && t.snoozedUntil !== undefined && t.snoozedUntil > ctx.now()) return false;
      if (Array.isArray(input.states) && !input.states.includes(t.state)) return false;
      if (Array.isArray(input.kinds) && !input.kinds.includes(t.kind)) return false;
      if (typeof input.recordId === 'string' && t.recordId !== input.recordId) return false;
      if (typeof input.runId === 'string' && !(t.source?.kind === 'run' && t.source.id === input.runId)) return false;
      const who = party(input.assignee);
      if (who && !((t.assigned.kind === who.kind && t.assigned.id === who.id) || (t.reviewer && t.reviewer.id === who.id) || (t.approver && t.approver.id === who.id))) return false;
      if (input.scope === 'mine') return isMine(t, me, ctx);
      if (input.scope === 'assigned_by_me') return t.createdBy === me && t.assigned.id !== me;
      if (input.scope === 'following') return t.followers.includes(me);
      if (input.scope === 'record') return typeof input.recordId === 'string' && t.recordId === input.recordId;
      if (input.scope === 'run') return t.source?.kind === 'run' && t.source.id === input.runId;
      return true;
    });
    rows = rows.sort((a, b) => b.updatedAt - a.updatedAt);
    const all = allOf(ctx);
    const p = page(rows, typeof input.cursor === 'string' ? input.cursor : undefined, typeof input.limit === 'number' ? input.limit : undefined);
    const out: Record<string, unknown> = { tasks: p.rows.map((t) => toPublic(t, all, ctx)), total: p.total };
    if (p.next) out.next = p.next;
    return out;
  },

  'tasks.needs_you': async (ctx: TaskCtx, input: { limit?: number }) => {
    const me = ctx.principal.id;
    const all = allOf(ctx);
    const now = ctx.now();
    const items = all.filter((t) => isMine(t, me, ctx)).map((t) => ({ task: t, reason: readyReason(t, all, me, now) })).filter((x): x is { task: Task; reason: 'ready' | 'due_today' | 'overdue' | 'blocking' } => x.reason !== null);
    const limit = typeof input?.limit === 'number' ? Math.min(Math.max(input.limit, 1), 200) : 50;
    const slice = items.slice(0, limit);
    return {
      items: slice.map(({ task, reason }) => {
        const handledBy = task.takenBy && task.takenBy !== me && (task.assigned.kind === 'group' || task.assigned.kind === 'role') ? task.takenBy : undefined;
        const row: Record<string, unknown> = { task: toPublic(task, all, ctx), reason };
        if (handledBy) row.handledBy = handledBy;
        return row;
      }),
      total: items.length,
    };
  },

  'tasks.count_needs_you': async (ctx: TaskCtx) => {
    const listed = await handlers['tasks.needs_you'](ctx, { limit: 200 });
    return { count: listed.total };
  },

  'tasks.my_work': async (ctx: TaskCtx, input: { section?: string; cursor?: string; limit?: number }) => {
    const me = ctx.principal.id;
    const all = allOf(ctx);
    const open = all.filter((t) => isMine(t, me, ctx) && isOpen(t.state));
    const assignedByMe = all.filter((t) => t.createdBy === me && t.assigned.id !== me && isOpen(t.state));
    const done = all.filter((t) => t.state === 'done' && (isMine(t, me, ctx) || t.createdBy === me));
    const section = input?.section ?? 'all';
    const chosen = section === 'open' ? open : section === 'assigned_by_me' ? assignedByMe : section === 'done' ? done : [...open, ...assignedByMe, ...done];
    const seen = new Set<string>();
    const uniq = chosen.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
    const p = page(uniq, input?.cursor, input?.limit);
    const out: Record<string, unknown> = {
      tasks: p.rows.map((t) => toPublic(t, all, ctx)),
      counts: { open: open.length, assignedByMe: assignedByMe.length, done: done.length },
      total: p.total,
    };
    if (p.next) out.next = p.next;
    return out;
  },

  'tasks.update': async (ctx: TaskCtx, input: Record<string, unknown>) => {
    const task = must(ctx, String(input.taskId));
    const fields: string[] = [];
    if (typeof input.title === 'string') { task.title = input.title; fields.push('title'); }
    if (typeof input.summary === 'string') { task.summary = input.summary; fields.push('summary'); }
    if (input.summary === null) { task.summary = undefined; fields.push('summary'); }
    if (typeof input.why === 'string') { task.why = input.why; fields.push('why'); }
    if (typeof input.due === 'number') { task.due = input.due; fields.push('due'); }
    if (input.due === null) { task.due = undefined; fields.push('due'); }
    if (typeof input.effort === 'number') { task.effort = input.effort; fields.push('effort'); }
    if (input.effort === null) { task.effort = undefined; fields.push('effort'); }
    if (Array.isArray(input.blocks)) { task.blocks = input.blocks as Task['blocks']; fields.push('blocks'); }
    task.updatedAt = ctx.now();
    save(ctx, task);
    emit(ctx, 'task.updated', task.id, { taskId: task.id, fields });
    return { task: present(ctx, task) };
  },

  'tasks.transition': async (ctx: TaskCtx, input: { taskId: string; to: TaskState; note?: string; expectedFrom?: TaskState }) => {
    const task = must(ctx, input.taskId);
    if (input.expectedFrom && input.expectedFrom !== task.state) fail(ctx, 'validation.field_locked', 'The task moved since it was read.');
    const out = transitionTo(task, input.to, { note: input.note, actor: actorOf(ctx), policy: policyOf(ctx), now: ctx.now() });
    if (!out.ok) fail(ctx, 'validation.precondition_failed', `No legal transition from ${task.state} to ${input.to}.`);
    save(ctx, out.task);
    emitTransition(ctx, task, out.task, out.action, input.note);
    return { task: present(ctx, out.task) };
  },

  'tasks.act': async (ctx: TaskCtx, input: { taskId: string; action: string; note?: string; answer?: unknown; edits?: Record<string, unknown>; token?: string }) => {
    const task = must(ctx, input.taskId);
    const token = input.token || ctx.approval || '';
    let acted: { task: Task; effect: string; result: Record<string, unknown> };
    try {
      const body: ActInput = {
        action: input.action, note: input.note, answer: input.answer, token, deviceId: ctx.device ?? '', now: ctx.now(),
        actor: actorOf(ctx), policy: policyOf(ctx), traceId: traceOf(ctx),
      };
      acted = actOnTask(task, body);
    } catch (e) {
      if (e instanceof TaskErr) throw e;
      throw e;
    }
    if (input.answer !== undefined) {
      acted.task.workingNotes = { ...acted.task.workingNotes, answer: typeof input.answer === 'string' ? input.answer : JSON.stringify(input.answer) };
    }
    if (input.edits) {
      const notes = { ...acted.task.workingNotes };
      for (const [k, v] of Object.entries(input.edits)) notes[`edit.${k}`] = typeof v === 'string' ? v : JSON.stringify(v);
      acted.task.workingNotes = notes;
    }
    save(ctx, acted.task);
    emitTransition(ctx, task, acted.task, acted.effect, input.note);
    return { task: present(ctx, acted.task), result: acted.result };
  },

  'tasks.assign': async (ctx: TaskCtx, input: { taskId: string; slot: 'assigned' | 'reviewer' | 'approver'; to: Party | null }) => {
    const task = must(ctx, input.taskId);
    const from = input.slot === 'assigned' ? task.assigned : input.slot === 'reviewer' ? task.reviewer ?? null : task.approver ?? null;
    if (input.to === null) {
      if (input.slot === 'assigned') fail(ctx, 'validation.precondition_failed', 'Assigned cannot be cleared.');
      if (input.slot === 'reviewer') task.reviewer = undefined;
      else task.approver = undefined;
    } else if (input.slot === 'assigned') task.assigned = input.to;
    else if (input.slot === 'reviewer') task.reviewer = input.to;
    else task.approver = input.to;
    const clash = slotClash(task, policyOf(ctx));
    if (clash) fail(ctx, 'validation.precondition_failed', clash);
    task.updatedAt = ctx.now();
    save(ctx, task);
    emit(ctx, 'task.assigned', task.id, { taskId: task.id, slot: input.slot, to: input.to, from });
    return { task: present(ctx, task) };
  },

  'tasks.delegate': async (ctx: TaskCtx, input: { taskId: string; to: Party; note?: string }) => {
    const task = must(ctx, input.taskId);
    const found = walk(ctx, input.to);
    if (!found) fail(ctx, 'validation.precondition_failed', 'No delegate in the chain can act on this item.');
    const passed = found.party;
    if (task.state === 'awaiting_approval' || task.kind === 'approve') task.approver = passed;
    else if (task.state === 'in_review' || task.kind === 'review') task.reviewer = passed;
    task.assigned = passed;
    if (found.narrowed) task.narrowedFor = passed.id;
    if (input.note) task.workingNotes = { ...task.workingNotes, handoff: input.note };
    task.updatedAt = ctx.now();
    save(ctx, task);
    emit(ctx, 'task.delegated', task.id, { taskId: task.id, from: ctx.principal.id, to: input.to, passedTo: passed }, input.note);
    return { task: present(ctx, task), passedTo: passed };
  },

  'tasks.escalate': async (ctx: TaskCtx, input: { taskId: string; reason: 'timeout' | 'manual' | 'away' }) => {
    const task = must(ctx, input.taskId);
    const start = (task.state === 'awaiting_approval' ? task.approver : task.state === 'in_review' ? task.reviewer : task.assigned) ?? task.assigned;
    const next = chains.get(ctx.space)?.get(start.id);
    if (!next) fail(ctx, 'validation.precondition_failed', 'No delegate or role to escalate to.');
    const found = walk(ctx, next);
    if (!found) fail(ctx, 'validation.precondition_failed', 'No delegate in the chain can act on this item.');
    const passed = found.party;
    if (task.state === 'awaiting_approval') task.approver = passed;
    else if (task.state === 'in_review') task.reviewer = passed;
    else task.assigned = passed;
    task.expiresAt = undefined;
    task.updatedAt = ctx.now();
    save(ctx, task);
    emit(ctx, 'task.escalated', task.id, { taskId: task.id, to: passed, reason: input.reason });
    return { task: present(ctx, task) };
  },

  'tasks.snooze': async (ctx: TaskCtx, input: { taskId: string; until: number | null }) => {
    const task = must(ctx, input.taskId);
    task.snoozedUntil = input.until === null ? undefined : input.until;
    task.updatedAt = ctx.now();
    save(ctx, task);
    emit(ctx, 'task.snoozed', task.id, { taskId: task.id, until: input.until });
    return { task: present(ctx, task) };
  },

  'tasks.take': async (ctx: TaskCtx, input: { taskId: string }) => {
    const task = must(ctx, input.taskId);
    const slots = [task.assigned, task.reviewer, task.approver].filter((p): p is Party => !!p);
    if (!slots.some((p) => p.kind === 'group' || p.kind === 'role')) fail(ctx, 'validation.precondition_failed', 'Take locks a group or role task.');
    if (task.takenBy && task.takenBy !== ctx.principal.id) fail(ctx, 'validation.precondition_failed', `Taken by ${task.takenBy}.`);
    task.takenBy = ctx.principal.id;
    task.updatedAt = ctx.now();
    save(ctx, task);
    emit(ctx, 'task.taken', task.id, { taskId: task.id, by: ctx.principal.id });
    return { task: present(ctx, task) };
  },

  'tasks.release': async (ctx: TaskCtx, input: { taskId: string }) => {
    const task = must(ctx, input.taskId);
    if (task.takenBy !== ctx.principal.id) fail(ctx, 'validation.precondition_failed', 'Only the person who took it can release it.');
    task.takenBy = undefined;
    task.updatedAt = ctx.now();
    save(ctx, task);
    emit(ctx, 'task.released', task.id, { taskId: task.id, by: ctx.principal.id });
    return { task: present(ctx, task) };
  },

  'tasks.withdraw': async (ctx: TaskCtx, input: { taskId?: string; sourceKind?: SourceKind; sourceId?: string; note: string }) => {
    let n = 0;
    for (const t of allOf(ctx)) {
      if (!isOpen(t.state)) continue;
      if (input.taskId && t.id !== input.taskId) continue;
      if (input.sourceKind && t.source?.kind !== input.sourceKind) continue;
      if (input.sourceId && t.source?.id !== input.sourceId) continue;
      if (!input.taskId && !input.sourceKind && !input.sourceId) continue;
      const from = t.state;
      t.state = 'canceled';
      t.updatedAt = ctx.now();
      save(ctx, t);
      const payload: Record<string, unknown> = { taskId: t.id, note: input.note };
      if (t.source?.kind) payload.sourceKind = t.source.kind;
      if (t.source?.id) payload.sourceId = t.source.id;
      emit(ctx, 'task.withdrawn', t.id, payload, input.note);
      emit(ctx, 'task.transitioned', t.id, { taskId: t.id, kind: t.kind, from, to: 'canceled', note: input.note }, input.note);
      n += 1;
    }
    return { withdrawn: n };
  },

  'tasks.followers.add': async (ctx: TaskCtx, input: { taskId: string; follower: string }) => {
    const task = must(ctx, input.taskId);
    if (!task.followers.includes(input.follower)) task.followers.push(input.follower);
    task.updatedAt = ctx.now();
    save(ctx, task);
    emit(ctx, 'task.follower_added', task.id, { taskId: task.id, follower: input.follower });
    return { task: present(ctx, task) };
  },

  'tasks.followers.remove': async (ctx: TaskCtx, input: { taskId: string; follower: string }) => {
    const task = must(ctx, input.taskId);
    task.followers = task.followers.filter((f) => f !== input.follower);
    task.updatedAt = ctx.now();
    save(ctx, task);
    emit(ctx, 'task.follower_removed', task.id, { taskId: task.id, follower: input.follower });
    return { task: present(ctx, task) };
  },

  'tasks.working_notes.set': async (ctx: TaskCtx, input: { taskId: string; key: string; value: string }) => {
    const task = must(ctx, input.taskId);
    task.workingNotes = { ...task.workingNotes, [input.key]: input.value };
    task.updatedAt = ctx.now();
    save(ctx, task);
    emit(ctx, 'task.note_set', task.id, { taskId: task.id, key: input.key, by: ctx.principal.id });
    return { task: present(ctx, task) };
  },

  'tasks.working_notes.delete': async (ctx: TaskCtx, input: { taskId: string; key: string }) => {
    const task = must(ctx, input.taskId);
    const notes = { ...task.workingNotes };
    delete notes[input.key];
    task.workingNotes = notes;
    task.updatedAt = ctx.now();
    save(ctx, task);
    emit(ctx, 'task.note_set', task.id, { taskId: task.id, key: input.key, by: ctx.principal.id });
    return { task: present(ctx, task) };
  },

  'tasks.links.add': async (ctx: TaskCtx, input: { taskId: string; recordId?: string; fileId?: string }) => {
    const task = must(ctx, input.taskId);
    if (input.recordId) task.recordId = input.recordId;
    if (input.fileId && !task.fileIds.includes(input.fileId)) task.fileIds.push(input.fileId);
    if (!input.recordId && !input.fileId) fail(ctx, 'validation.precondition_failed', 'A record or a file is required.');
    task.updatedAt = ctx.now();
    save(ctx, task);
    const linkKind = input.fileId ? 'file' : 'record';
    emit(ctx, 'task.link_changed', task.id, { taskId: task.id, op: 'added', linkKind, linkId: input.fileId || input.recordId });
    return { task: present(ctx, task) };
  },

  'tasks.links.remove': async (ctx: TaskCtx, input: { taskId: string; recordId?: string; fileId?: string }) => {
    const task = must(ctx, input.taskId);
    if (input.recordId && task.recordId === input.recordId) task.recordId = undefined;
    if (input.fileId) task.fileIds = task.fileIds.filter((id) => id !== input.fileId);
    task.updatedAt = ctx.now();
    save(ctx, task);
    const linkKind = input.fileId ? 'file' : 'record';
    emit(ctx, 'task.link_changed', task.id, { taskId: task.id, op: 'removed', linkKind, linkId: input.fileId || input.recordId });
    return { task: present(ctx, task) };
  },

  'tasks.dependencies.add': async (ctx: TaskCtx, input: { taskId: string; dependsOnId: string }) => {
    const task = must(ctx, input.taskId);
    if (input.dependsOnId === task.id || reaches(allOf(ctx), input.dependsOnId, task.id)) fail(ctx, 'validation.precondition_failed', 'That dependency would cycle.');
    if (!task.dependsOn.includes(input.dependsOnId)) task.dependsOn.push(input.dependsOnId);
    task.updatedAt = ctx.now();
    save(ctx, task);
    emit(ctx, 'task.link_changed', task.id, { taskId: task.id, op: 'added', linkKind: 'dependency', linkId: input.dependsOnId });
    return { task: present(ctx, task) };
  },

  'tasks.dependencies.remove': async (ctx: TaskCtx, input: { taskId: string; dependsOnId: string }) => {
    const task = must(ctx, input.taskId);
    task.dependsOn = task.dependsOn.filter((id) => id !== input.dependsOnId);
    task.updatedAt = ctx.now();
    save(ctx, task);
    emit(ctx, 'task.link_changed', task.id, { taskId: task.id, op: 'removed', linkKind: 'dependency', linkId: input.dependsOnId });
    return { task: present(ctx, task) };
  },

  'tasks.history': async (ctx: TaskCtx, input: { taskId: string; cursor?: string; limit?: number }) => {
    must(ctx, input.taskId);
    const entries = [...(histBucket(ctx.space).get(input.taskId) ?? [])].reverse();
    const p = page(entries, input.cursor, input.limit);
    const out: Record<string, unknown> = { entries: p.rows, total: p.total };
    if (p.next) out.next = p.next;
    return out;
  },
};

function reaches(all: Task[], from: string, target: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const id = stack.pop();
    if (!id || seen.has(id)) continue;
    if (id === target) return true;
    seen.add(id);
    const t = all.find((x) => x.id === id);
    if (t) stack.push(...t.dependsOn);
  }
  return false;
}
