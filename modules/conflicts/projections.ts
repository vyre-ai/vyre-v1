// @reads /modules/conflicts/migrations/0001_conflicts.sql
// Rows and shared helpers of the conflicts module (ARCH 5.5; spec 4.11): the context the handlers use, the schema bootstrap, the contract row, the ports to the rest of the Space
// (what a field holds now, how a value is written back as the person, who proposes) and the rule for what counts as a real difference.
// Every statement names a conflicts_* table, which is all ctx.db lets a module touch.
import { readFileSync } from "node:fs";
import { fail } from "../../host/src/routes/errors.ts";
import { mintUuid } from "../../lib/ids.ts";
import { loadCatalog } from "../../sync/src/server/pull/index.ts";
import type { Catalog } from "../../sync/src/server/pull/index.ts";
import type { ErrorCode, EventName } from "../../packages/contracts/src/types.ts";

export interface Db {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

export type Choice = "ours" | "theirs" | "merged" | "custom";
export type State = "open" | "proposed" | "needs_you" | "resolved" | "undone";
export type Level = "view" | "use" | "edit" | "manage";

/** The part of the host Ctx these handlers read. A test passes a small object; the host passes the full Ctx. */
export interface CfCtx {
  space: string;
  principal: { kind: "person" | "agent" | "actor" | "service"; id: string };
  actingFor?: string | undefined;
  trace: { traceId: string };
  now(): number;
  db: Db;
  emit(name: EventName, subject: string, payload: unknown): unknown;
  call(cap: string, input: unknown): Promise<unknown>;
  authorize(action: { perm: string | null; level: Level }, resource: { type: string; id: string | null }): { effect: "allow" | "deny" | "hold" };
  log: { warn(msg: string, attrs?: Record<string, unknown>): void };
}

export function raise(ctx: Pick<CfCtx, "trace">, code: ErrorCode, message: string, details?: Record<string, unknown>): never {
  throw fail(code, ctx.trace.traceId, { message, ...(details ? { details } : {}) });
}

/** The person a call is for: the one an agent acts for, else the caller. */
export const actorOf = (ctx: Pick<CfCtx, "principal" | "actingFor">): string => ctx.actingFor ?? ctx.principal.id;

// ---- schema

const SCHEMA = readFileSync(new URL("./migrations/0001_conflicts.sql", import.meta.url), "utf8")
  .split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")
  .split(";").map((s) => s.trim()).filter((s) => s.length > 0);

const ready = new WeakSet<object>();

/** Make sure the conflicts tables exist. One cheap probe per handle; the CREATE ... IF NOT EXISTS statements run only when it fails. */
export function ensure(db: Db): void {
  if (ready.has(db)) return;
  try {
    db.all("SELECT conflict_id FROM conflicts_detail WHERE conflict_id = ?", "probe");
    db.all("SELECT entity FROM conflicts_history WHERE entity = ?", "probe");
  } catch {
    for (const stmt of SCHEMA) db.run(stmt);
  }
  ready.add(db);
}

export type Row = Record<string, unknown>;
export const rowsOf = (db: Db, sql: string, ...args: unknown[]): Row[] => db.all(sql, ...args) as Row[];
export const str = (v: unknown): string => String(v ?? "");
export const num = (v: unknown): number => Number(v ?? 0);
export const orNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** Contract ids are `<prefix>_<lowercase alphanumerics>`. */
export const mintId = (prefix: string, now: number = Date.now()): string => `${prefix}_${mintUuid(now).replaceAll("-", "")}`;

// ---- values

export const toJson = (v: unknown): string => JSON.stringify(v === undefined ? null : v);
export function fromJson(s: unknown): unknown {
  if (typeof s !== "string" || s.length === 0) return null;
  try { return JSON.parse(s) as unknown; } catch { return s; }
}

/** The form two values are compared in: text is trimmed and its whitespace collapsed, objects have sorted keys. */
export function canonical(v: unknown): string {
  const walk = (x: unknown): unknown => {
    if (typeof x === "string") return x.normalize("NFC").trim().replace(/\s+/g, " ");
    if (Array.isArray(x)) return x.map(walk);
    if (x !== null && typeof x === "object") {
      const o = x as Record<string, unknown>;
      return Object.fromEntries(Object.keys(o).sort().map((k) => [k, walk(o[k])]));
    }
    return x === undefined ? null : x;
  };
  return JSON.stringify(walk(v));
}

/** Meaningful-edit rule (spec 4.11): two edits that say the same thing once spacing is ignored are not a conflict. */
export const sameMeaning = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);

// ---- the contract row

export interface Conflict {
  conflictId: string; entity: string; recordId: string; field: string;
  ours: unknown; theirs: unknown; base: unknown; state: State; plainChoice: boolean; protectedField: boolean;
  proposal: { choice: Choice; value: unknown; summary: string } | null;
  openedAt: number; taskId: string | null; runId: string | null; person: string; opId: string; kind: "field" | "binary";
  oursActor: string; theirsActor: string; traceId: string;
}

const SELECT =
  "SELECT c.id, c.entity, c.recordId, c.field, c.ours, c.theirs, c.base, c.state, c.plainChoice, c.openedAt, c.person, " +
  "d.op_id, d.kind, d.protected, d.ours_actor, d.theirs_actor, d.trace_id, d.proposal, d.task_id, d.run_id " +
  "FROM conflicts_conflict c JOIN conflicts_detail d ON d.conflict_id = c.id";

function conflictOf(r: Row): Conflict {
  const p = fromJson(r["proposal"]) as { choice?: Choice; value?: unknown; summary?: string } | null;
  return {
    conflictId: str(r["id"]), entity: str(r["entity"]), recordId: str(r["recordId"]), field: str(r["field"]),
    ours: fromJson(r["ours"]), theirs: fromJson(r["theirs"]), base: fromJson(r["base"]), state: str(r["state"]) as State,
    plainChoice: num(r["plainChoice"]) === 1, protectedField: num(r["protected"]) === 1,
    proposal: p && p.choice ? { choice: p.choice, value: p.value ?? null, summary: p.summary ?? "" } : null,
    openedAt: num(r["openedAt"]), taskId: orNull(r["task_id"]), runId: orNull(r["run_id"]), person: str(r["person"]), opId: str(r["op_id"]),
    kind: str(r["kind"]) === "binary" ? "binary" : "field", oursActor: str(r["ours_actor"]), theirsActor: str(r["theirs_actor"]), traceId: str(r["trace_id"]),
  };
}

export function loadConflict(db: Db, conflictId: string): Conflict | null {
  const r = rowsOf(db, `${SELECT} WHERE c.id = ?`, conflictId)[0];
  return r ? conflictOf(r) : null;
}

export function findByOp(db: Db, opId: string, field: string): Conflict | null {
  const r = rowsOf(db, `${SELECT} WHERE d.op_id = ? AND d.field = ?`, opId, field)[0];
  return r ? conflictOf(r) : null;
}

export function listConflicts(db: Db, person: string, o: { states?: readonly State[]; entity?: string; since?: number }): Conflict[] {
  const where = ["c.person = ?"];
  const args: unknown[] = [person];
  if (o.states && o.states.length) { where.push(`c.state IN (${o.states.map(() => "?").join(", ")})`); args.push(...o.states); }
  if (o.entity) { where.push("c.entity = ?"); args.push(o.entity); }
  if (o.since !== undefined) { where.push("c.openedAt >= ?"); args.push(o.since); }
  return rowsOf(db, `${SELECT} WHERE ${where.join(" AND ")} ORDER BY c.openedAt DESC, c.id DESC`, ...args).map(conflictOf);
}

export interface Resolution {
  resolutionId: string; conflictId: string; choice: Choice; summary: string; by: string; at: number; prev: unknown; value: unknown; state: "active" | "undone"; n: number;
}

function resolutionOf(r: Row): Resolution {
  return {
    resolutionId: str(r["resolution_id"]), conflictId: str(r["conflict_id"]), choice: str(r["choice"]) as Choice, summary: str(r["summary"]), by: str(r["by_actor"]),
    at: num(r["at"]), prev: fromJson(r["prev_value"]), value: fromJson(r["new_value"]), state: str(r["state"]) === "undone" ? "undone" : "active", n: num(r["n"]),
  };
}

/** The newest resolution of a conflict, which is the one Undo and Redo act on. */
export function latestResolution(db: Db, conflictId: string): Resolution | null {
  const r = rowsOf(db, "SELECT * FROM conflicts_resolution WHERE conflict_id = ? ORDER BY n DESC LIMIT 1", conflictId)[0];
  return r ? resolutionOf(r) : null;
}

export function resolutionById(db: Db, resolutionId: string): Resolution | null {
  const r = rowsOf(db, "SELECT * FROM conflicts_resolution WHERE resolution_id = ?", resolutionId)[0];
  return r ? resolutionOf(r) : null;
}

/** A conflict as the contract returns it (conflictRow in manifests/conflicts.ts). */
export function toContractRow(db: Db, c: Conflict): Record<string, unknown> {
  const res = latestResolution(db, c.conflictId);
  const row: Record<string, unknown> = {
    conflictId: c.conflictId, entity: c.entity, recordId: c.recordId, field: c.field, ours: c.ours, theirs: c.theirs, base: c.base, state: c.state,
    plainChoice: c.plainChoice, protectedField: c.protectedField, openedAt: c.openedAt,
  };
  if (c.proposal) row["proposal"] = c.proposal;
  if (res) {
    row["resolution"] = {
      resolutionId: res.resolutionId, choice: res.choice, summary: res.summary, by: res.by, at: res.at,
      canUndo: res.state === "active" && c.kind === "field", canRedo: res.state === "undone",
    };
  }
  if (c.taskId) row["taskId"] = c.taskId;
  if (c.runId) row["runId"] = c.runId;
  return row;
}

// ---- ports to the rest of the Space

export interface Target { entity: string; recordId: string; field: string }
export interface Proposal { choice: Choice; value?: unknown; summary: string }

export interface Ports {
  /** True for status, money, owner, locked-after-approval and sealed fields: the assistant proposes, the person confirms. */
  isProtected(entity: string, field: string): boolean;
  /** What the field holds on the server now. */
  current(ctx: CfCtx, t: Target): Promise<unknown>;
  /** Write a value as the person (a normal op: authorize, Gate, validation and audit apply). */
  apply(ctx: CfCtx, t: Target & { value: unknown; person: string }): Promise<void>;
  /** The access resource the edit is checked against. */
  resource(entity: string, recordId: string): { type: string; id: string };
  /** The person's assistant, called with both values. Never called for a Restricted field. */
  assistant(ctx: CfCtx, c: { conflictId: string; entity: string; recordId: string; field: string; ours: unknown; theirs: unknown; base: unknown; person: string }): Promise<Proposal>;
}

let catalogMemo: Catalog | null = null;
const catalog = (): Catalog => (catalogMemo ??= loadCatalog());

const text = (v: unknown): string | null => (typeof v === "string" ? v : null);
const flatText = (s: string): string => s.normalize("NFC").trim().replace(/\s+/g, " ");

/** The proposer used when the host binds no assistant: keeps a text that contains the other, takes the newer edit otherwise, and says so in one line. */
export function heuristicProposal(ours: unknown, theirs: unknown): Proposal {
  if (sameMeaning(ours, theirs)) return { choice: "ours", summary: "Both edits say the same thing, so nothing changes." };
  const a = text(ours);
  const b = text(theirs);
  if (a !== null && b !== null) {
    const na = flatText(a);
    const nb = flatText(b);
    if (na.includes(nb)) return { choice: "ours", summary: "Kept the longer text, which already includes your edit." };
    if (nb.includes(na)) return { choice: "theirs", summary: "Used your edit, which adds to the other text." };
  }
  return { choice: "theirs", summary: "Used your newer edit; the other value stays in history." };
}

const DEFAULT_PORTS: Ports = {
  isProtected: (entity, field) => catalog().get(entity).protectedFields.includes(field),
  async current(ctx, t) {
    const out = (await ctx.call("records.get", { type: t.entity, recordId: t.recordId })) as { record?: { fields?: Record<string, unknown> } } | null;
    return out?.record?.fields?.[t.field] ?? null;
  },
  async apply(ctx, t) {
    if (catalog().get(t.entity).kind !== "record_type") {
      raise(ctx, "validation.unsupported", "This kind of item is changed from its own screen; open it and choose the value there.", { entity: t.entity });
    }
    await ctx.call("records.update", { type: t.entity, recordId: t.recordId, patch: { [t.field]: t.value } });
  },
  resource: (entity, recordId) => (catalog().get(entity).kind === "record_type" ? { type: "record", id: recordId } : { type: catalog().get(entity).resource, id: recordId }),
  assistant: (_ctx, c) => Promise.resolve(heuristicProposal(c.ours, c.theirs)),
};

let ports: Ports = DEFAULT_PORTS;

/** The host binds the assistant turn engine and entity writers here at boot; a partial set keeps what was bound before for the rest. null puts the defaults back. */
export function setPorts(p: Partial<Ports> | null): void {
  ports = p ? { ...ports, ...p } : DEFAULT_PORTS;
}
export const portsNow = (): Ports => ports;

/** A page of an already ordered list. The cursor is the offset of the first item. */
export function pageOf<T>(items: readonly T[], cursor: string | undefined, limit: number | undefined): { page: T[]; next?: string; total: number } {
  const start = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
  const size = limit ?? 100;
  const end = start + size;
  return { page: items.slice(start, end), ...(end < items.length ? { next: String(end) } : {}), total: items.length };
}
