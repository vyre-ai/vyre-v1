// Handlers for manifests/tasks.ts. Status changes go through step(); tasks.act adds the device-bound token.
// The host authorizes the caller before these run. Delegation asks who can act on the source and walks the chain.

import { mintId } from "../../../lib/ids.ts";
import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import { VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { ErrorCode, EventName, NextStep } from "../../../packages/contracts/src/types.ts";
import { applyAct, approvalHash, approvalKey, requestKind, walkDelegates } from "./act.ts";
import {
  DEFAULT_ACTIONS,
  actionForTarget,
  dependencyCycle,
  initialState,
  isAssignee,
  isTaskKind,
  machineOf,
  needsYouReason,
  sameParty,
  step,
  toView,
} from "./state.ts";
import type {
  Actor,
  Party,
  Policy,
  ReadyReason,
  SlotName,
  TaskActionDef,
  TaskBlock,
  TaskKind,
  TaskRecord,
  TaskSource,
  TaskState,
  TaskView,
} from "./state.ts";
import { isOpen } from "./state.ts";

export interface HistoryRow {
  id: string;
  taskId: string;
  at: number;
  type: string;
  by: string;
  note?: string;
  eventId: string;
}

export interface Repo {
  load(id: string): TaskRecord | null;
  save(row: TaskRecord): void;
  all(): TaskRecord[];
  history(taskId: string): HistoryRow[];
  addHistory(row: HistoryRow): void;
  policy(): Policy;
  idemGet(key: string): string | null;
  idemPut(key: string, taskId: string): void;
  delegateNext(party: Party): Party | null;
  /** null when no row. true or false when the source grant is explicit. */
  sourceGrant(source: TaskSource, party: Party): boolean | null;
}

const NEXT_VALIDATION: NextStep[] = [{ kind: "edit_input", label: "Fix the input" }];
const NEXT_PERMISSION: NextStep[] = [
  { kind: "ask_access", label: "Ask for access" },
  { kind: "contact_admin", label: "Contact an admin" },
];

function raise(code: ErrorCode, traceId: string, message: string): never {
  throw new VyreErr({
    code,
    message,
    retryable: false,
    traceId,
    next: code.startsWith("permission.") ? NEXT_PERMISSION : NEXT_VALIDATION,
  });
}

function actorOf(ctx: Ctx): Actor {
  return { kind: ctx.principal.kind, id: ctx.principal.id };
}

function viewOf(repo: Repo, task: TaskRecord): TaskView {
  return toView(task, repo.all());
}

function must(repo: Repo, ctx: Ctx, id: string): TaskRecord {
  const row = repo.load(id);
  if (!row) raise("validation.not_found", ctx.trace.traceId, "That task does not exist");
  return row;
}

function emit(ctx: Ctx, repo: Repo, taskId: string, name: EventName, payload: unknown, by: string, note?: string): void {
  const env = ctx.emit(name, taskId, payload, { vis: "participants" });
  const row: HistoryRow = { id: env.id, taskId, at: ctx.now(), type: name, by, eventId: env.id };
  if (note !== undefined && note.length > 0) row.note = note;
  repo.addHistory(row);
}

function partyOk(v: unknown): v is Party {
  if (!v || typeof v !== "object") return false;
  const row = v as { kind?: unknown; id?: unknown };
  return (row.kind === "person" || row.kind === "agent" || row.kind === "group" || row.kind === "role" || row.kind === "automation")
    && typeof row.id === "string" && row.id.length > 0;
}

function checkSlots(policy: Policy, assigned: Party, reviewer: Party | undefined, approver: Party | undefined, traceId: string): void {
  if (!policy.allowSelfReview) {
    if (reviewer && sameParty(reviewer, assigned)) raise("validation.precondition_failed", traceId, "The reviewer and the assignee have to be different people");
    if (approver && sameParty(approver, assigned)) raise("validation.precondition_failed", traceId, "The approver and the assignee have to be different people");
  }
  if (policy.requireHumanApprover && approver && approver.kind !== "person") {
    raise("validation.precondition_failed", traceId, "The approver slot has to be a person");
  }
}

function canActOnSource(task: TaskRecord, party: Party, repo: Repo): boolean {
  if (party.kind !== "person" && party.kind !== "agent") return false;
  if (!task.source) return true;
  const grant = repo.sourceGrant(task.source, party);
  if (grant === true) return true;
  if (grant === false) return false;
  if (sameParty(task.assigned, party)) return true;
  if (task.reviewer && sameParty(task.reviewer, party)) return true;
  if (task.approver && sameParty(task.approver, party)) return true;
  return false;
}

function currentSlot(task: TaskRecord): SlotName {
  if (task.state === "in_review" && task.reviewer) return "reviewer";
  if (task.state === "awaiting_approval" && task.approver) return "approver";
  return "assigned";
}

function putSlot(task: TaskRecord, slot: SlotName, party: Party): TaskRecord {
  if (slot === "assigned") return { ...task, assigned: party };
  if (slot === "reviewer") return { ...task, reviewer: party };
  return { ...task, approver: party };
}

function dropSlot(task: TaskRecord, slot: "reviewer" | "approver"): TaskRecord {
  if (slot === "reviewer") {
    const { reviewer: _drop, ...rest } = task;
    return rest;
  }
  const { approver: _drop, ...rest } = task;
  return rest;
}

function limitOf(ctx: Ctx, n: number | undefined, max: number, dflt: number): number {
  if (n === undefined) return dflt;
  if (!Number.isInteger(n) || n < 1) raise("validation.bad_input", ctx.trace.traceId, "The page size is not valid");
  return Math.min(n, max);
}

function pageRows<T extends { id: string }>(rows: T[], cursor: string | undefined, limit: number): { slice: T[]; next?: string; total: number } {
  let start = 0;
  if (cursor) {
    const at = rows.findIndex((row) => row.id === cursor);
    if (at < 0) return { slice: [], total: rows.length };
    start = at + 1;
  }
  const slice = rows.slice(start, start + limit);
  const last = slice[slice.length - 1];
  if (start + limit < rows.length && last) return { slice, next: last.id, total: rows.length };
  return { slice, total: rows.length };
}

function byRecent(a: TaskRecord, b: TaskRecord): number {
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

function snoozed(task: TaskRecord, now: number): boolean {
  return task.snoozedUntil !== undefined && task.snoozedUntil > now;
}

function mine(task: TaskRecord, id: string): boolean {
  const machine = machineOf(task);
  if (machine.takenBy === id || machine.assigned.id === id) return true;
  if (machine.reviewer?.id === id || machine.approver?.id === id) return true;
  return isAssignee(machine, id);
}

function applyMoved(ctx: Ctx, repo: Repo, before: TaskRecord, after: TaskRecord, events: StepOkEvents, note: string | undefined): TaskView {
  repo.save(after);
  const by = ctx.principal.id;
  const from = before.state;
  emit(ctx, repo, after.id, "task.transitioned", {
    taskId: after.id,
    kind: after.kind,
    from,
    to: after.state,
    ...(note ? { note } : {}),
  }, by, note);
  for (const name of events) {
    if (name === "task.sent_back") {
      emit(ctx, repo, after.id, "task.sent_back", { taskId: after.id, by, note: note ?? "", reviewLoops: after.reviewLoops }, by, note);
    } else if (name === "task.rejected") {
      emit(ctx, repo, after.id, "task.rejected", { taskId: after.id, by, note: note ?? "" }, by, note);
    } else if (name === "task.approved") {
      emit(ctx, repo, after.id, "task.approved", {
        taskId: after.id,
        kind: after.kind,
        by,
        ...(ctx.actingFor ? { forPerson: ctx.actingFor } : {}),
      }, by, note);
    } else if (name === "task.completed") {
      emit(ctx, repo, after.id, "task.completed", {
        taskId: after.id,
        kind: after.kind,
        ...(after.recordId ? { recordId: after.recordId } : {}),
        ...(after.source ? { source: after.source } : {}),
      }, by);
    } else if (name === "task.handled") {
      emit(ctx, repo, after.id, "task.handled", { taskId: after.id, by }, by);
    }
  }
  return viewOf(repo, after);
}

type StepOkEvents = Array<"task.sent_back" | "task.approved" | "task.rejected" | "task.completed" | "task.handled">;

export interface CreateInput {
  kind?: TaskKind;
  title: string;
  summary?: string;
  why?: string;
  blocks?: TaskBlock[];
  assigned: Party;
  reviewer?: Party;
  approver?: Party;
  due?: number;
  effort?: number;
  recordId?: string;
  fileIds?: string[];
  source?: TaskSource;
  parentTaskId?: string;
  dependsOn?: string[];
  expiresAt?: number;
  actions?: TaskActionDef[];
  idempotencyKey?: string;
}

export function createHandlers(open: (ctx: Ctx) => Repo) {
  return {
    "tasks.create": async (ctx: Ctx, input: CreateInput) => {
      const repo = open(ctx);
      const traceId = ctx.trace.traceId;
      if (!input.idempotencyKey) raise("validation.bad_input", traceId, "An idempotency key is required");
      const prior = repo.idemGet(input.idempotencyKey);
      if (prior) {
        const existing = repo.load(prior);
        if (!existing) raise("validation.not_found", traceId, "That task does not exist");
        return { task: viewOf(repo, existing) };
      }
      if (typeof input.title !== "string" || input.title.trim().length === 0) raise("validation.bad_input", traceId, "The title is empty");
      const kind = input.kind ?? "work";
      if (!isTaskKind(kind)) raise("validation.bad_input", traceId, "That kind is not a task kind");
      if (!partyOk(input.assigned)) raise("validation.bad_input", traceId, "The assignee is missing");
      if (input.reviewer !== undefined && !partyOk(input.reviewer)) raise("validation.bad_input", traceId, "The reviewer is missing");
      if (input.approver !== undefined && !partyOk(input.approver)) raise("validation.bad_input", traceId, "The approver is missing");
      if (kind === "approve" && !input.approver) raise("validation.precondition_failed", traceId, "An Approve task needs an approver");
      if (kind === "review" && !input.reviewer) raise("validation.precondition_failed", traceId, "A Review task needs a reviewer");
      const policy = repo.policy();
      checkSlots(policy, input.assigned, input.reviewer, input.approver, traceId);
      if (input.parentTaskId && !repo.load(input.parentTaskId)) raise("validation.precondition_failed", traceId, "The parent task does not exist");
      const dependsOn = input.dependsOn ?? [];
      for (const id of dependsOn) {
        if (!repo.load(id)) raise("validation.precondition_failed", traceId, "A dependency does not exist");
      }
      const now = ctx.now();
      const blocks = input.blocks ?? [];
      const source = input.source;
      const record: TaskRecord = {
        id: mintId("tsk", now),
        kind,
        title: input.title.trim(),
        state: initialState(kind),
        blocks,
        actions: input.actions ?? [...DEFAULT_ACTIONS[kind]],
        assigned: input.assigned,
        fileIds: input.fileIds ?? [],
        dependsOn: [...dependsOn],
        followers: [],
        workingNotes: {},
        reviewLoops: 0,
        createdBy: ctx.principal.id,
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      if (input.summary !== undefined) record.summary = input.summary;
      if (input.why !== undefined) record.why = input.why;
      if (input.reviewer) record.reviewer = input.reviewer;
      if (input.approver) record.approver = input.approver;
      if (input.due !== undefined) record.due = input.due;
      if (input.effort !== undefined) record.effort = input.effort;
      if (input.recordId !== undefined) record.recordId = input.recordId;
      if (source) record.source = source;
      if (input.parentTaskId) record.parentTaskId = input.parentTaskId;
      if (ctx.thread) record.threadId = ctx.thread;
      if (input.expiresAt !== undefined) record.expiresAt = input.expiresAt;
      if (kind === "approve" || source?.kind === "gate") {
        record.payloadHash = approvalHash(ctx.space, {
          kind,
          title: record.title,
          blocks,
          assigned: input.assigned,
          source: source ?? null,
        });
        record.decisionId = mintId("dec", now);
      }
      repo.save(record);
      repo.idemPut(input.idempotencyKey, record.id);
      emit(ctx, repo, record.id, "task.created", {
        taskId: record.id,
        kind: record.kind,
        title: record.title,
        assigned: record.assigned,
        ...(record.recordId ? { recordId: record.recordId } : {}),
        ...(record.source ? { source: record.source } : {}),
      }, ctx.principal.id);
      if (requestKind(kind)) {
        emit(ctx, repo, record.id, "task.requested", {
          taskId: record.id,
          kind,
          title: record.title,
          assigned: record.assigned,
          ...(record.expiresAt !== undefined ? { expiresAt: record.expiresAt } : {}),
        }, ctx.principal.id);
      }
      const slots: Array<[SlotName, Party | undefined]> = [
        ["assigned", record.assigned],
        ["reviewer", record.reviewer],
        ["approver", record.approver],
      ];
      for (const [slot, party] of slots) {
        if (!party) continue;
        emit(ctx, repo, record.id, "task.assigned", { taskId: record.id, slot, to: party, from: null }, ctx.principal.id);
      }
      return { task: viewOf(repo, record) };
    },

    "tasks.get": async (ctx: Ctx, input: { taskId: string }) => {
      const repo = open(ctx);
      return { task: viewOf(repo, must(repo, ctx, input.taskId)) };
    },

    "tasks.list": async (ctx: Ctx, input: {
      scope: "mine" | "assigned_by_me" | "following" | "record" | "run" | "all";
      states?: TaskState[];
      kinds?: TaskKind[];
      recordId?: string;
      runId?: string;
      assignee?: Party;
      includeSnoozed?: boolean;
      cursor?: string;
      limit?: number;
    }) => {
      const repo = open(ctx);
      const now = ctx.now();
      const id = ctx.principal.id;
      const rows = repo.all().filter((task) => {
        if (!input.includeSnoozed && snoozed(task, now)) return false;
        if (input.states && !input.states.includes(task.state)) return false;
        if (input.kinds && !input.kinds.includes(task.kind)) return false;
        if (input.assignee && !sameParty(task.assigned, input.assignee)) return false;
        if (input.scope === "mine") return mine(task, id);
        if (input.scope === "assigned_by_me") return task.createdBy === id;
        if (input.scope === "following") return task.followers.includes(id);
        if (input.scope === "record") return input.recordId !== undefined && task.recordId === input.recordId;
        if (input.scope === "run") return task.source?.kind === "run" && input.runId !== undefined && task.source.id === input.runId;
        return true;
      }).sort(byRecent);
      const paged = pageRows(rows, input.cursor, limitOf(ctx, input.limit, 500, 50));
      const all = repo.all();
      return {
        tasks: paged.slice.map((task) => toView(task, all)),
        total: paged.total,
        ...(paged.next ? { next: paged.next } : {}),
      };
    },

    "tasks.needs_you": async (ctx: Ctx, input: { limit?: number }) => {
      const repo = open(ctx);
      const now = ctx.now();
      const all = repo.all();
      const items = all.flatMap((task) => {
        const hit = needsYouReason(task, ctx.principal.id, now, all);
        if (!hit) return [];
        const item: { task: TaskView; reason: ReadyReason; handledBy?: string } = { task: toView(task, all), reason: hit.reason };
        if (hit.handledBy) item.handledBy = hit.handledBy;
        return [item];
      }).sort((a, b) => (b.task.updatedAt - a.task.updatedAt) || (a.task.id < b.task.id ? 1 : a.task.id > b.task.id ? -1 : 0));
      const limit = limitOf(ctx, input.limit, 200, 50);
      return { items: items.slice(0, limit), total: items.length };
    },

    "tasks.count_needs_you": async (ctx: Ctx) => {
      const repo = open(ctx);
      const now = ctx.now();
      const all = repo.all();
      const count = all.filter((task) => needsYouReason(task, ctx.principal.id, now, all)).length;
      return { count };
    },

    "tasks.my_work": async (ctx: Ctx, input: { section?: "open" | "assigned_by_me" | "done" | "all"; cursor?: string; limit?: number }) => {
      const repo = open(ctx);
      const now = ctx.now();
      const id = ctx.principal.id;
      const all = repo.all();
      const openRows = all.filter((task) => mine(task, id) && isOpen(task.state) && !snoozed(task, now));
      const byMe = all.filter((task) => task.createdBy === id && isOpen(task.state) && !snoozed(task, now));
      const done = all.filter((task) => mine(task, id) && task.state === "done");
      const section = input.section ?? "open";
      let rows: TaskRecord[];
      if (section === "open") rows = openRows;
      else if (section === "assigned_by_me") rows = byMe;
      else if (section === "done") rows = done;
      else {
        const seen = new Set<string>();
        rows = [];
        for (const task of [...openRows, ...byMe, ...done]) {
          if (seen.has(task.id)) continue;
          seen.add(task.id);
          rows.push(task);
        }
      }
      rows.sort(byRecent);
      const paged = pageRows(rows, input.cursor, limitOf(ctx, input.limit, 500, 50));
      return {
        tasks: paged.slice.map((task) => toView(task, all)),
        counts: { open: openRows.length, assignedByMe: byMe.length, done: done.length },
        total: paged.total,
        ...(paged.next ? { next: paged.next } : {}),
      };
    },

    "tasks.update": async (ctx: Ctx, input: {
      taskId: string;
      title?: string;
      summary?: string;
      why?: string;
      due?: number | null;
      effort?: number | null;
      blocks?: TaskBlock[];
    }) => {
      const repo = open(ctx);
      let task = must(repo, ctx, input.taskId);
      const fields: string[] = [];
      if (input.title !== undefined) {
        if (input.title.trim().length === 0) raise("validation.bad_input", ctx.trace.traceId, "The title is empty");
        task = { ...task, title: input.title.trim() };
        fields.push("title");
      }
      if (input.summary !== undefined) {
        task = { ...task, summary: input.summary };
        fields.push("summary");
      }
      if (input.why !== undefined) {
        task = { ...task, why: input.why };
        fields.push("why");
      }
      if (input.due === null) {
        const { due: _drop, ...rest } = task;
        task = rest;
        fields.push("due");
      } else if (input.due !== undefined) {
        task = { ...task, due: input.due };
        fields.push("due");
      }
      if (input.effort === null) {
        const { effort: _drop, ...rest } = task;
        task = rest;
        fields.push("effort");
      } else if (input.effort !== undefined) {
        task = { ...task, effort: input.effort };
        fields.push("effort");
      }
      if (input.blocks !== undefined) {
        task = { ...task, blocks: input.blocks };
        fields.push("blocks");
      }
      if (fields.length === 0) return { task: viewOf(repo, task) };
      task = { ...task, updatedAt: ctx.now(), version: task.version + 1 };
      repo.save(task);
      emit(ctx, repo, task.id, "task.updated", { taskId: task.id, fields }, ctx.principal.id);
      return { task: viewOf(repo, task) };
    },

    "tasks.transition": async (ctx: Ctx, input: { taskId: string; to: TaskState; note?: string; expectedFrom?: TaskState }) => {
      const repo = open(ctx);
      const before = must(repo, ctx, input.taskId);
      if (input.expectedFrom !== undefined && input.expectedFrom !== before.state) {
        raise("validation.field_locked", ctx.trace.traceId, "The status changed since it was read");
      }
      const action = actionForTarget(machineOf(before), input.to);
      if (!action) raise("validation.precondition_failed", ctx.trace.traceId, "That move is not in the task state table");
      const moved = step(machineOf(before), action, {
        actor: actorOf(ctx),
        policy: repo.policy(),
        ...(input.note !== undefined ? { note: input.note } : {}),
      });
      if (!moved.ok) raise(moved.code, ctx.trace.traceId, moved.reason);
      if (moved.to !== input.to) raise("validation.precondition_failed", ctx.trace.traceId, "That move is not in the task state table");
      const after: TaskRecord = { ...before, state: moved.to, reviewLoops: moved.reviewLoops, updatedAt: ctx.now(), version: before.version + 1 };
      if (moved.takenBy !== undefined) after.takenBy = moved.takenBy;
      const task = applyMoved(ctx, repo, before, after, moved.events, input.note);
      emit(ctx, repo, before.id, "task.updated", { taskId: before.id, fields: ["state"] }, ctx.principal.id);
      return { task };
    },

    "tasks.act": async (ctx: Ctx, input: { taskId: string; action: string; note?: string; answer?: unknown; edits?: Record<string, unknown> }) => {
      const repo = open(ctx);
      const before = must(repo, ctx, input.taskId);
      const token = typeof input.edits?.approvalToken === "string" && input.edits.approvalToken.length > 0 ? input.edits.approvalToken : undefined;
      const applied = applyAct(before, {
        action: input.action,
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.answer !== undefined ? { answer: input.answer } : {}),
        ...(token !== undefined ? { approvalToken: token } : {}),
        ...(ctx.device !== undefined ? { deviceId: ctx.device } : {}),
      }, actorOf(ctx), repo.policy(), approvalKey(ctx.space), ctx.now());
      if (!applied.ok) raise(applied.code, ctx.trace.traceId, applied.reason);
      const task = applyMoved(ctx, repo, before, applied.task, applied.events, input.note);
      return { task, result: applied.result };
    },

    "tasks.assign": async (ctx: Ctx, input: { taskId: string; slot: SlotName; to: Party | null }) => {
      const repo = open(ctx);
      const before = must(repo, ctx, input.taskId);
      if (input.slot === "assigned" && input.to === null) raise("validation.precondition_failed", ctx.trace.traceId, "The assignee cannot be cleared");
      if (input.to !== null && !partyOk(input.to)) raise("validation.bad_input", ctx.trace.traceId, "That assignee is not valid");
      const from = input.slot === "assigned" ? before.assigned : input.slot === "reviewer" ? (before.reviewer ?? null) : (before.approver ?? null);
      let next = before;
      if (input.to === null) next = dropSlot(before, input.slot === "reviewer" ? "reviewer" : "approver");
      else next = putSlot(before, input.slot, input.to);
      checkSlots(repo.policy(), next.assigned, next.reviewer, next.approver, ctx.trace.traceId);
      next = { ...next, updatedAt: ctx.now(), version: before.version + 1 };
      repo.save(next);
      emit(ctx, repo, next.id, "task.assigned", { taskId: next.id, slot: input.slot, to: input.to, from }, ctx.principal.id);
      return { task: viewOf(repo, next) };
    },

    "tasks.delegate": async (ctx: Ctx, input: { taskId: string; to: Party; note?: string }) => {
      const repo = open(ctx);
      const before = must(repo, ctx, input.taskId);
      if (!partyOk(input.to)) raise("validation.bad_input", ctx.trace.traceId, "That delegate is not valid");
      const passed = walkDelegates(input.to, (party) => repo.delegateNext(party), (party) => canActOnSource(before, party, repo));
      if (!passed) raise("validation.precondition_failed", ctx.trace.traceId, "No delegate can act on the source item");
      const slot = currentSlot(before);
      const next = { ...putSlot(before, slot, passed), updatedAt: ctx.now(), version: before.version + 1 };
      checkSlots(repo.policy(), next.assigned, next.reviewer, next.approver, ctx.trace.traceId);
      repo.save(next);
      emit(ctx, repo, next.id, "task.delegated", { taskId: next.id, from: ctx.principal.id, to: input.to, passedTo: passed }, ctx.principal.id, input.note);
      return { task: viewOf(repo, next), passedTo: passed };
    },

    "tasks.escalate": async (ctx: Ctx, input: { taskId: string; reason: "timeout" | "manual" | "away" }) => {
      const repo = open(ctx);
      const before = must(repo, ctx, input.taskId);
      const machine = machineOf(before);
      const slotParty = machine.state === "in_review" && machine.reviewer ? machine.reviewer
        : machine.state === "awaiting_approval" && machine.approver ? machine.approver
        : machine.assigned;
      const start = repo.delegateNext(slotParty);
      if (!start) raise("validation.precondition_failed", ctx.trace.traceId, "There is no delegate to escalate to");
      const passed = walkDelegates(start, (party) => repo.delegateNext(party), (party) => canActOnSource(before, party, repo));
      if (!passed) raise("validation.precondition_failed", ctx.trace.traceId, "No delegate can act on the source item");
      const slot = currentSlot(before);
      let next = { ...putSlot(before, slot, passed), updatedAt: ctx.now(), version: before.version + 1 };
      checkSlots(repo.policy(), next.assigned, next.reviewer, next.approver, ctx.trace.traceId);
      repo.save(next);
      emit(ctx, repo, next.id, "task.escalated", { taskId: next.id, to: passed, reason: input.reason }, ctx.principal.id);
      return { task: viewOf(repo, next) };
    },

    "tasks.snooze": async (ctx: Ctx, input: { taskId: string; until: number | null }) => {
      const repo = open(ctx);
      const before = must(repo, ctx, input.taskId);
      let next: TaskRecord;
      if (input.until === null) {
        const { snoozedUntil: _drop, ...rest } = before;
        next = { ...rest, updatedAt: ctx.now(), version: before.version + 1 };
      } else {
        next = { ...before, snoozedUntil: input.until, updatedAt: ctx.now(), version: before.version + 1 };
      }
      repo.save(next);
      emit(ctx, repo, next.id, "task.snoozed", { taskId: next.id, until: input.until }, ctx.principal.id);
      return { task: viewOf(repo, next) };
    },

    "tasks.take": async (ctx: Ctx, input: { taskId: string }) => {
      const repo = open(ctx);
      const before = must(repo, ctx, input.taskId);
      if (before.assigned.kind !== "group" && before.assigned.kind !== "role") {
        raise("validation.precondition_failed", ctx.trace.traceId, "Take locks a group or role task");
      }
      if (before.takenBy && before.takenBy !== ctx.principal.id) raise("validation.precondition_failed", ctx.trace.traceId, "Someone already took this task");
      if (before.takenBy === ctx.principal.id) return { task: viewOf(repo, before) };
      const next = { ...before, takenBy: ctx.principal.id, updatedAt: ctx.now(), version: before.version + 1 };
      repo.save(next);
      emit(ctx, repo, next.id, "task.taken", { taskId: next.id, by: ctx.principal.id }, ctx.principal.id);
      return { task: viewOf(repo, next) };
    },

    "tasks.release": async (ctx: Ctx, input: { taskId: string }) => {
      const repo = open(ctx);
      const before = must(repo, ctx, input.taskId);
      if (!before.takenBy) raise("validation.precondition_failed", ctx.trace.traceId, "This task is not taken");
      if (before.takenBy !== ctx.principal.id) raise("validation.precondition_failed", ctx.trace.traceId, "Only the person who took it can release it");
      const { takenBy: _drop, ...rest } = before;
      const next = { ...rest, updatedAt: ctx.now(), version: before.version + 1 };
      repo.save(next);
      emit(ctx, repo, next.id, "task.released", { taskId: next.id, by: ctx.principal.id }, ctx.principal.id);
      return { task: viewOf(repo, next) };
    },

    "tasks.withdraw": async (ctx: Ctx, input: { taskId?: string; sourceKind?: "chat" | "run" | "gate" | "journey"; sourceId?: string; note: string }) => {
      const repo = open(ctx);
      if (!input.note || input.note.trim().length === 0) raise("validation.bad_input", ctx.trace.traceId, "A note is required");
      let rows: TaskRecord[];
      if (input.taskId) rows = [must(repo, ctx, input.taskId)];
      else if (input.sourceKind && input.sourceId) {
        rows = repo.all().filter((task) => task.source?.kind === input.sourceKind && task.source.id === input.sourceId && isOpen(task.state));
      } else raise("validation.bad_input", ctx.trace.traceId, "Say which task or which source to withdraw");
      let withdrawn = 0;
      for (const before of rows) {
        if (!isOpen(before.state)) continue;
        const next = { ...before, state: "canceled" as const, updatedAt: ctx.now(), version: before.version + 1 };
        repo.save(next);
        emit(ctx, repo, next.id, "task.withdrawn", {
          taskId: next.id,
          note: input.note,
          ...(before.source ? { sourceKind: before.source.kind, sourceId: before.source.id } : {}),
        }, ctx.principal.id, input.note);
        withdrawn += 1;
      }
      return { withdrawn };
    },

    "tasks.followers.add": async (ctx: Ctx, input: { taskId: string; follower: string }) => {
      const repo = open(ctx);
      const before = must(repo, ctx, input.taskId);
      if (!input.follower) raise("validation.bad_input", ctx.trace.traceId, "The follower is missing");
      if (before.followers.includes(input.follower)) return { task: viewOf(repo, before) };
      const next = { ...before, followers: [...before.followers, input.follower], updatedAt: ctx.now(), version: before.version + 1 };
      repo.save(next);
      emit(ctx, repo, next.id, "task.follower_added", { taskId: next.id, follower: input.follower }, ctx.principal.id);
      return { task: viewOf(repo, next) };
    },

    "tasks.followers.remove": async (ctx: Ctx, input: { taskId: string; follower: string }) => {
      const repo = open(ctx);
      const before = must(repo, ctx, input.taskId);
      if (!before.followers.includes(input.follower)) return { task: viewOf(repo, before) };
      const next = { ...before, followers: before.followers.filter((id) => id !== input.follower), updatedAt: ctx.now(), version: before.version + 1 };
      repo.save(next);
      emit(ctx, repo, next.id, "task.follower_removed", { taskId: next.id, follower: input.follower }, ctx.principal.id);
      return { task: viewOf(repo, next) };
    },

    "tasks.working_notes.set": async (ctx: Ctx, input: { taskId: string; key: string; value: string }) => {
      const repo = open(ctx);
      const before = must(repo, ctx, input.taskId);
      if (!input.key) raise("validation.bad_input", ctx.trace.traceId, "The note key is empty");
      const next = {
        ...before,
        workingNotes: { ...before.workingNotes, [input.key]: input.value },
        updatedAt: ctx.now(),
        version: before.version + 1,
      };
      repo.save(next);
      emit(ctx, repo, next.id, "task.note_set", { taskId: next.id, key: input.key, by: ctx.principal.id }, ctx.principal.id);
      return { task: viewOf(repo, next) };
    },

    "tasks.working_notes.delete": async (ctx: Ctx, input: { taskId: string; key: string }) => {
      const repo = open(ctx);
      const before = must(repo, ctx, input.taskId);
      if (!(input.key in before.workingNotes)) return { task: viewOf(repo, before) };
      const workingNotes = { ...before.workingNotes };
      delete workingNotes[input.key];
      const next = { ...before, workingNotes, updatedAt: ctx.now(), version: before.version + 1 };
      repo.save(next);
      emit(ctx, repo, next.id, "task.note_set", { taskId: next.id, key: input.key, by: ctx.principal.id }, ctx.principal.id);
      return { task: viewOf(repo, next) };
    },

    "tasks.links.add": async (ctx: Ctx, input: { taskId: string; recordId?: string; fileId?: string }) => {
      const repo = open(ctx);
      const before = must(repo, ctx, input.taskId);
      if (!input.recordId && !input.fileId) raise("validation.bad_input", ctx.trace.traceId, "Say which record or file to link");
      let next = before;
      if (input.recordId) {
        next = { ...next, recordId: input.recordId };
        emit(ctx, repo, next.id, "task.link_changed", { taskId: next.id, op: "added", linkKind: "record", linkId: input.recordId }, ctx.principal.id);
      }
      if (input.fileId && !next.fileIds.includes(input.fileId)) {
        next = { ...next, fileIds: [...next.fileIds, input.fileId] };
        emit(ctx, repo, next.id, "task.link_changed", { taskId: next.id, op: "added", linkKind: "file", linkId: input.fileId }, ctx.principal.id);
      }
      next = { ...next, updatedAt: ctx.now(), version: before.version + 1 };
      repo.save(next);
      return { task: viewOf(repo, next) };
    },

    "tasks.links.remove": async (ctx: Ctx, input: { taskId: string; recordId?: string; fileId?: string }) => {
      const repo = open(ctx);
      const before = must(repo, ctx, input.taskId);
      if (!input.recordId && !input.fileId) raise("validation.bad_input", ctx.trace.traceId, "Say which record or file to unlink");
      let next = before;
      if (input.recordId && next.recordId === input.recordId) {
        const { recordId: _drop, ...rest } = next;
        next = rest;
        emit(ctx, repo, next.id, "task.link_changed", { taskId: next.id, op: "removed", linkKind: "record", linkId: input.recordId }, ctx.principal.id);
      }
      if (input.fileId && next.fileIds.includes(input.fileId)) {
        next = { ...next, fileIds: next.fileIds.filter((id) => id !== input.fileId) };
        emit(ctx, repo, next.id, "task.link_changed", { taskId: next.id, op: "removed", linkKind: "file", linkId: input.fileId }, ctx.principal.id);
      }
      next = { ...next, updatedAt: ctx.now(), version: before.version + 1 };
      repo.save(next);
      return { task: viewOf(repo, next) };
    },

    "tasks.dependencies.add": async (ctx: Ctx, input: { taskId: string; dependsOnId: string }) => {
      const repo = open(ctx);
      const before = must(repo, ctx, input.taskId);
      if (!repo.load(input.dependsOnId)) raise("validation.precondition_failed", ctx.trace.traceId, "That dependency does not exist");
      if (before.dependsOn.includes(input.dependsOnId)) return { task: viewOf(repo, before) };
      if (dependencyCycle(repo.all(), before.id, input.dependsOnId)) raise("validation.precondition_failed", ctx.trace.traceId, "That dependency would loop");
      const next = { ...before, dependsOn: [...before.dependsOn, input.dependsOnId], updatedAt: ctx.now(), version: before.version + 1 };
      repo.save(next);
      emit(ctx, repo, next.id, "task.link_changed", { taskId: next.id, op: "added", linkKind: "dependency", linkId: input.dependsOnId }, ctx.principal.id);
      return { task: viewOf(repo, next) };
    },

    "tasks.dependencies.remove": async (ctx: Ctx, input: { taskId: string; dependsOnId: string }) => {
      const repo = open(ctx);
      const before = must(repo, ctx, input.taskId);
      if (!before.dependsOn.includes(input.dependsOnId)) return { task: viewOf(repo, before) };
      const next = { ...before, dependsOn: before.dependsOn.filter((id) => id !== input.dependsOnId), updatedAt: ctx.now(), version: before.version + 1 };
      repo.save(next);
      emit(ctx, repo, next.id, "task.link_changed", { taskId: next.id, op: "removed", linkKind: "dependency", linkId: input.dependsOnId }, ctx.principal.id);
      return { task: viewOf(repo, next) };
    },

    "tasks.history": async (ctx: Ctx, input: { taskId: string; cursor?: string; limit?: number }) => {
      const repo = open(ctx);
      must(repo, ctx, input.taskId);
      const rows = repo.history(input.taskId).slice().sort((a, b) => (b.at - a.at) || (a.id < b.id ? 1 : -1));
      const paged = pageRows(rows, input.cursor, limitOf(ctx, input.limit, 500, 50));
      return {
        entries: paged.slice.map((row) => {
          const entry: { at: number; type: string; by: string; note?: string; eventId: string } = {
            at: row.at, type: row.type, by: row.by, eventId: row.eventId,
          };
          if (row.note !== undefined) entry.note = row.note;
          return entry;
        }),
        total: paged.total,
        ...(paged.next ? { next: paged.next } : {}),
      };
    },
  };
}
