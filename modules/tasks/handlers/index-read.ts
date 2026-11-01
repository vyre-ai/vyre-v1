// The long list (tasks.index): every row a Tasks page draws, in one read, at 5,000 tasks. It reads only the columns a row shows, never the blocks, the notes or the actions, and it answers nothing when the caller
// already holds this revision. tasks.rev is the one number a screen watches, so a change anywhere else in the Space costs one small read and no list.
import { actionableByMe, clean, findTask, involved, isOpen, openIndex, visibleTo, whoIs } from "../projections.ts";
import type { Assignee, Task, TaskKind, TaskState, TasksCtx } from "../projections.ts";

type In = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
type Raw = Record<string, unknown>;
const WEEK = 7 * 86_400_000;
const MAX_ROWS = 20_000;
const MAX_DONE = 1_000;

const COLS = `c.id AS id, c.key AS key, m.kind AS kind, c.title AS title, c.state AS state, m.assigned AS assigned, m.reviewer AS reviewer, m.approver AS approver, m.taken_by AS taken_by, m.due AS due, c.start_at AS start_at,
  m.effort AS effort, c.priority AS priority, c.labels AS labels, c.record_id AS record_id, m.parent_task AS parent_task, m.depends_on AS depends_on, m.thread_id AS thread_id, c.worker_thread AS worker_thread,
  m.source_kind AS source_kind, m.source_id AS source_id, m.snoozed_until AS snoozed_until, m.followers AS followers, c.created_by AS created_by, c.created_at AS created_at, c.updated_at AS updated_at`;

const parse = <T>(v: unknown, or: T): T => { if (typeof v !== "string" || v === "") return or; try { return JSON.parse(v) as T; } catch { return or; } };
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

export function revOf(db: TasksCtx["db"]): string {
  const r = db.all("SELECT COUNT(*) AS n, MAX(updated_at) AS u, SUM(version) AS v FROM tasks_meta WHERE deleted_at IS NULL")[0] as { n?: number; u?: number | null; v?: number | null } | undefined;
  return `${r?.n ?? 0}.${r?.u ?? 0}.${r?.v ?? 0}`;
}

export async function rev(ctx: TasksCtx, _input: In): Promise<unknown> {
  return { rev: revOf(ctx.db) };
}

/** Just enough of a row for the scope checks the full read uses, so a row is mine or not by the same rule everywhere. */
function asTask(r: Raw, assigned: Assignee, reviewer: Assignee | null, approver: Assignee | null, followers: string[]): Task {
  return {
    id: String(r["id"]), kind: r["kind"] as TaskKind, title: String(r["title"]), state: r["state"] as TaskState, assigned, ...(reviewer ? { reviewer } : {}), ...(approver ? { approver } : {}),
    ...(str(r["taken_by"]) ? { takenBy: String(r["taken_by"]) } : {}), blocks: [], actions: [], fileIds: [], dependsOn: [], followers, workingNotes: {}, labels: [], fields: {}, reviewLoops: 0,
    createdBy: String(r["created_by"]), createdAt: Number(r["created_at"]), updatedAt: Number(r["updated_at"]), version: 0,
  };
}

export async function index(ctx: TasksCtx, input: In): Promise<unknown> {
  const now = revOf(ctx.db);
  const wantDone = input.done === true;
  if (typeof input.rev === "string" && input.rev === now) return { rev: now, unchanged: true, rows: [], doneThisWeek: 0, total: 0 };
  const clock = ctx.now();
  const who = whoIs(ctx);
  const me = (id: string): boolean => id === who.id || id === who.actingFor;
  const scope = input.scope as "mine" | "given" | "everyone";
  const where = ["m.deleted_at IS NULL"];
  const args: unknown[] = [];
  if (input.recordId !== undefined) { where.push("c.record_id = ?"); args.push(input.recordId); }
  if (scope === "given") { where.push("c.created_by = ?"); args.push(who.id); }
  const rows = ctx.db.all(`SELECT ${COLS} FROM tasks_core c JOIN tasks_meta m ON m.id = c.id WHERE ${where.join(" AND ")} ORDER BY c.created_at DESC, c.id DESC`, ...args) as Raw[];
  // the rollup of a parent reads every child, seen or not: a count says nothing about a child
  const children = new Map<string, { total: number; done: number }>();
  for (const r of ctx.db.all("SELECT m.parent_task AS parent, c.state AS state, m.kind AS kind FROM tasks_meta m JOIN tasks_core c ON c.id = m.id WHERE m.parent_task IS NOT NULL AND m.deleted_at IS NULL") as Raw[]) {
    if (r["kind"] !== "work") continue;
    const p = String(r["parent"]);
    const c = children.get(p) ?? { total: 0, done: 0 };
    c.total += 1;
    if (r["state"] === "done" || r["state"] === "canceled") c.done += 1;
    children.set(p, c);
  }
  const idx = openIndex(ctx.db);
  const out: unknown[] = [];
  let doneThisWeek = 0;
  let done = 0;
  for (const r of rows) {
    const state = r["state"] as TaskState;
    const open = isOpen(state);
    const assigned = parse<Assignee>(r["assigned"], { kind: "person", id: "" });
    const reviewer = parse<Assignee | null>(r["reviewer"], null), approver = parse<Assignee | null>(r["approver"], null);
    const followers = parse<string[]>(r["followers"], []);
    const direct = me(assigned.id) || (reviewer !== null && me(reviewer.id)) || (approver !== null && me(approver.id)) || me(String(r["taken_by"] ?? ""));
    const t = direct ? null : asTask(r, assigned, reviewer, approver, followers);
    if (scope === "mine" && !direct && !(t !== null && (involved(t, who) || actionableByMe(ctx, t)))) continue;
    if (scope === "given" && assigned.id === who.id) continue;
    if (!direct && !me(String(r["created_by"])) && !followers.some(me) && t !== null && !visibleTo(ctx, t)) continue;
    if (!open) {
      if (Number(r["updated_at"]) >= clock - WEEK && state === "done") doneThisWeek += 1;
      if (!wantDone || done >= MAX_DONE) continue;
      done += 1;
    } else if (wantDone) continue;
    const snoozed = num(r["snoozed_until"]);
    if (open && snoozed !== undefined && snoozed > clock) continue;
    if (out.length >= MAX_ROWS) continue;
    const id = String(r["id"]);
    const dependsOn = parse<string[]>(r["depends_on"], []);
    const sk = str(r["source_kind"]), si = str(r["source_id"]);
    out.push(clean({
      id, key: str(r["key"]), kind: r["kind"], title: r["title"], state, blocked: open && (idx.unblockParents.has(id) || dependsOn.some((d) => idx.open.has(d))),
      assigned, reviewer: reviewer ?? undefined, approver: approver ?? undefined, takenBy: str(r["taken_by"]), due: num(r["due"]), start: num(r["start_at"]), effort: num(r["effort"]), priority: str(r["priority"]),
      labels: parse<string[]>(r["labels"], []), recordId: str(r["record_id"]), parentTaskId: str(r["parent_task"]), dependsOn, threadId: str(r["thread_id"]), workerThread: str(r["worker_thread"]),
      source: sk !== undefined && si !== undefined ? { kind: sk, id: si } : undefined, snoozedUntil: snoozed, children: children.get(id), createdBy: r["created_by"], createdAt: r["created_at"], updatedAt: r["updated_at"],
    }));
  }
  return { rev: now, unchanged: false, rows: out, doneThisWeek, total: out.length };
}

export async function byKey(ctx: TasksCtx, input: In): Promise<unknown> {
  const key = String(input.key ?? "").trim().toUpperCase().replace(/^#/, "");
  const row = ctx.db.all("SELECT c.id AS id FROM tasks_core c JOIN tasks_meta m ON m.id = c.id WHERE c.key = ? AND m.deleted_at IS NULL", key)[0] as { id?: string } | undefined;
  if (!row?.id) return { taskId: null };
  const t = findTask(ctx.db, row.id);
  return { taskId: t && visibleTo(ctx, t) ? t.id : null };
}
