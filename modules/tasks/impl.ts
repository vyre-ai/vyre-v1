// tasks (lane L6): one handler per capability of manifests/tasks.ts.
// The host loads this file when the module is live. Each db call is one statement on a tasks_ table.
// tasks_item.doc is the source of truth. tasks_meta mirrors the generated entity columns.

import type { Ctx } from "../../packages/contracts/src/ctx.ts";
import { createHandlers } from "./handlers/index.ts";
import type { HistoryRow, Repo } from "./handlers/index.ts";
import { projections } from "./projections.ts";
import { DEFAULT_POLICY } from "./handlers/state.ts";
import type { Party, Policy, TaskRecord, TaskSource } from "./handlers/state.ts";

export { projections };
export const codecs = {};

export const SQL = {
  load: "SELECT doc FROM tasks_item WHERE id = ?",
  all: "SELECT doc FROM tasks_item",
  saveItem: `INSERT INTO tasks_item (
    id, state, kind, assigned_id, created_by, due, snoozed_until, parent_task, source_kind, source_id, updated_at, doc
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    state = excluded.state,
    kind = excluded.kind,
    assigned_id = excluded.assigned_id,
    created_by = excluded.created_by,
    due = excluded.due,
    snoozed_until = excluded.snoozed_until,
    parent_task = excluded.parent_task,
    source_kind = excluded.source_kind,
    source_id = excluded.source_id,
    updated_at = excluded.updated_at,
    doc = excluded.doc`,
  saveMeta: `INSERT INTO tasks_meta (
    id, kind, assigned, reviewer, approver, taken_by, taken_at, snoozed_until, why, blocks,
    source_kind, source_id, parent_task, depends_on, followers, working_notes, review_loops,
    decision_id, payload_hash, expires_at, due, effort, thread_id, version, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    kind = excluded.kind,
    assigned = excluded.assigned,
    reviewer = excluded.reviewer,
    approver = excluded.approver,
    taken_by = excluded.taken_by,
    taken_at = excluded.taken_at,
    snoozed_until = excluded.snoozed_until,
    why = excluded.why,
    blocks = excluded.blocks,
    source_kind = excluded.source_kind,
    source_id = excluded.source_id,
    parent_task = excluded.parent_task,
    depends_on = excluded.depends_on,
    followers = excluded.followers,
    working_notes = excluded.working_notes,
    review_loops = excluded.review_loops,
    decision_id = excluded.decision_id,
    payload_hash = excluded.payload_hash,
    expires_at = excluded.expires_at,
    due = excluded.due,
    effort = excluded.effort,
    thread_id = excluded.thread_id,
    version = excluded.version,
    updated_at = excluded.updated_at`,
  history: "SELECT id, task_id, at, type, by_id, note, event_id FROM tasks_activity WHERE task_id = ?",
  addHistory: "INSERT INTO tasks_activity (id, task_id, at, type, by_id, note, event_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
  policy: "SELECT key, value FROM tasks_policy",
  idemGet: "SELECT task_id FROM tasks_idem WHERE idem_key = ?",
  idemPut: "INSERT INTO tasks_idem (idem_key, task_id) VALUES (?, ?) ON CONFLICT(idem_key) DO UPDATE SET task_id = excluded.task_id",
  delegate: "SELECT to_kind, to_id FROM tasks_delegate_chain WHERE from_kind = ? AND from_id = ?",
  grant: "SELECT allow FROM tasks_source_grant WHERE source_kind = ? AND source_id = ? AND party_kind = ? AND party_id = ?",
} as const;

function nil(v: string | number | null | undefined): string | number | null {
  return v === undefined ? null : v;
}

function asParty(kind: unknown, id: unknown): Party | null {
  if (typeof id !== "string" || id.length === 0) return null;
  if (kind === "person" || kind === "agent" || kind === "group" || kind === "role" || kind === "automation") return { kind, id };
  return null;
}

function parseDoc(raw: unknown): TaskRecord | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as TaskRecord;
  } catch {
    return null;
  }
}

function policyOf(ctx: Ctx): Policy {
  const rows = ctx.db.all(SQL.policy) as { key?: unknown; value?: unknown }[];
  const map = new Map<string, string>();
  for (const row of rows) {
    if (typeof row.key === "string" && typeof row.value === "string") map.set(row.key, row.value);
  }
  const limit = Number(map.get("review_loop_limit"));
  return {
    reviewLoopLimit: Number.isInteger(limit) && limit >= 1 ? limit : DEFAULT_POLICY.reviewLoopLimit,
    allowSelfReview: map.get("allow_self_review") === "true",
    requireHumanApprover: map.get("require_human_approver") === "true",
  };
}

function sqlRepo(ctx: Ctx): Repo {
  return {
    load(id: string): TaskRecord | null {
      const rows = ctx.db.all(SQL.load, id) as { doc?: unknown }[];
      return parseDoc(rows[0]?.doc);
    },
    save(row: TaskRecord): void {
      const doc = JSON.stringify(row);
      ctx.db.run(
        SQL.saveItem,
        row.id,
        row.state,
        row.kind,
        row.assigned.id,
        row.createdBy,
        nil(row.due),
        nil(row.snoozedUntil),
        nil(row.parentTaskId),
        nil(row.source?.kind),
        nil(row.source?.id),
        row.updatedAt,
        doc,
      );
      ctx.db.run(
        SQL.saveMeta,
        row.id,
        row.kind,
        JSON.stringify(row.assigned),
        row.reviewer ? JSON.stringify(row.reviewer) : null,
        row.approver ? JSON.stringify(row.approver) : null,
        nil(row.takenBy),
        null,
        nil(row.snoozedUntil),
        nil(row.why),
        JSON.stringify(row.blocks),
        nil(row.source?.kind),
        nil(row.source?.id),
        nil(row.parentTaskId),
        JSON.stringify(row.dependsOn),
        JSON.stringify(row.followers),
        JSON.stringify(row.workingNotes),
        row.reviewLoops,
        nil(row.decisionId),
        nil(row.payloadHash),
        nil(row.expiresAt),
        nil(row.due),
        nil(row.effort),
        nil(row.threadId),
        row.version,
        row.updatedAt,
      );
    },
    all(): TaskRecord[] {
      const rows = ctx.db.all(SQL.all) as { doc?: unknown }[];
      const out: TaskRecord[] = [];
      for (const row of rows) {
        const task = parseDoc(row.doc);
        if (task) out.push(task);
      }
      return out;
    },
    history(taskId: string): HistoryRow[] {
      const rows = ctx.db.all(SQL.history, taskId) as Record<string, unknown>[];
      const out: HistoryRow[] = [];
      for (const row of rows) {
        if (typeof row.id !== "string" || typeof row.task_id !== "string" || typeof row.at !== "number") continue;
        if (typeof row.type !== "string" || typeof row.by_id !== "string" || typeof row.event_id !== "string") continue;
        const entry: HistoryRow = {
          id: row.id,
          taskId: row.task_id,
          at: row.at,
          type: row.type,
          by: row.by_id,
          eventId: row.event_id,
        };
        if (typeof row.note === "string" && row.note.length > 0) entry.note = row.note;
        out.push(entry);
      }
      return out;
    },
    addHistory(row: HistoryRow): void {
      ctx.db.run(SQL.addHistory, row.id, row.taskId, row.at, row.type, row.by, nil(row.note), row.eventId);
    },
    policy(): Policy {
      return policyOf(ctx);
    },
    idemGet(key: string): string | null {
      const rows = ctx.db.all(SQL.idemGet, key) as { task_id?: unknown }[];
      const id = rows[0]?.task_id;
      return typeof id === "string" ? id : null;
    },
    idemPut(key: string, taskId: string): void {
      ctx.db.run(SQL.idemPut, key, taskId);
    },
    delegateNext(party: Party): Party | null {
      const rows = ctx.db.all(SQL.delegate, party.kind, party.id) as { to_kind?: unknown; to_id?: unknown }[];
      const row = rows[0];
      if (!row) return null;
      return asParty(row.to_kind, row.to_id);
    },
    sourceGrant(source: TaskSource, party: Party): boolean | null {
      const rows = ctx.db.all(SQL.grant, source.kind, source.id, party.kind, party.id) as { allow?: unknown }[];
      const row = rows[0];
      if (!row) return null;
      return Number(row.allow) !== 0;
    },
  };
}

export const handlers = createHandlers(sqlRepo);
