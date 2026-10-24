// Search and the trace view (spec 4.18, ARCH 4.9 and 4.10). Filters are pushed into SQL, pages are keyed on the row id,
// and one trace id returns the log rows, spans and events of the whole chain. A tombstoned person is blank on the way out,
// and a search for that person finds nothing: erasing keeps the ids, not the way back to them.

import { ERROR_CODES, VyreErr } from "../../../packages/contracts/src/errors.ts";
import type { ErrorCode, NextStep, VyreError } from "../../../packages/contracts/src/types.ts";
import { LEVELS, erasedActors, levelName } from "./sink.ts";
import type { Db, LevelName } from "./sink.ts";

export interface LogFilter {
  person?: string;
  agent?: string;
  place?: string;
  recordId?: string;
  runId?: string;
  traceId?: string;
  cap?: string;
  level?: LevelName;
  result?: string;
  sinceMs?: number;
  untilMs?: number;
}

export interface Page { cursor?: string; limit?: number }

export interface ApiLog {
  id: number;
  at: number;
  level: LevelName;
  msg: string;
  traceId?: string;
  spanId?: string;
  actor?: string;
  onBehalf?: string;
  runId?: string;
  place?: string;
  cap?: string;
  entity?: string;
  entityId?: string;
  result?: string;
  durMs?: number;
  costMicros?: number;
  label?: number;
  attrs?: Record<string, unknown>;
}

export interface ApiSpan { traceId: string; spanId: string; name: string; at: number; durUs: number; parent?: string; attrs?: Record<string, unknown> }
export interface ApiEvent { seq: number; type: string; at: number; actor: string; entity?: string }
export interface QueryOut { rows: ApiLog[]; total: number; next?: string }
export interface SpansOut { spans: ApiSpan[]; total: number; next?: string }
export interface TraceOut { logs: ApiLog[]; spans: ApiSpan[]; events: ApiEvent[] }

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;
/** Rows a trace view returns at most; a runaway trace is cut here, not paged. */
export const TRACE_CAP = 5_000;

const NEXT_LABEL: Record<NextStep["kind"], string> = {
  retry: "Try again", switch_model: "Use another model", use_backup_key: "Use the backup key", ask_access: "Ask for access",
  open_settings: "Open settings", reconnect: "Reconnect", edit_input: "Change what you sent", wait: "Wait a moment",
  contact_admin: "Contact an admin", report: "Report a problem",
};

/** Throw a typed error from the global catalogue with the trace id and the catalogue's next steps. */
export function failWith(traceId: string, code: ErrorCode, message?: string, details?: Record<string, unknown>): never {
  const def = ERROR_CODES.find((e) => e.code === code) ?? ERROR_CODES.find((e) => e.code === "internal.unexpected");
  if (!def) throw new Error("error catalogue is empty");
  const error: VyreError = {
    code: def.code,
    message: message ?? def.what,
    retryable: def.retryable,
    traceId,
    next: def.next.map((kind) => ({ kind, label: NEXT_LABEL[kind] })),
  };
  if (details) error.details = details;
  throw new VyreErr(error);
}

type Row = Record<string, unknown>;

function asRow(v: unknown): Row | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : null;
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function numOf(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function jsonObj(v: unknown): Record<string, unknown> | undefined {
  if (typeof v !== "string" || !v) return undefined;
  try {
    const p = JSON.parse(v) as unknown;
    return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : undefined;
  } catch { return undefined; }
}

export function limitOf(page: Page | undefined): number {
  const n = page?.limit;
  if (n === undefined || !Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(n)));
}

/** A cursor is the number a previous page returned. Anything else starts from the top, so a stale or foreign marker never errors. */
function cursorNumber(page: Page | undefined): number | null {
  const c = page?.cursor;
  return c !== undefined && /^[0-9]{1,15}$/.test(c) ? Number(c) : null;
}

export interface Where { sql: string; args: unknown[] }

/** The WHERE clause of a log search. `level` is a floor: warn finds warn and error. */
export function buildWhere(space: string, f: LogFilter): Where {
  const conds = ["space = ?"];
  const args: unknown[] = [space];
  const eq = (col: string, v: string | undefined): void => { if (v) { conds.push(`${col} = ?`); args.push(v); } };
  const who = (v: string | undefined): void => { if (v) { conds.push("(actor = ? OR on_behalf = ?)"); args.push(v, v); } };
  who(f.person);
  who(f.agent);
  eq("place", f.place);
  eq("entity_id", f.recordId);
  eq("run_id", f.runId);
  eq("trace_id", f.traceId);
  eq("cap", f.cap);
  eq("result", f.result);
  if (f.level) { conds.push("level >= ?"); args.push(LEVELS[f.level]); }
  if (f.sinceMs !== undefined) { conds.push("at >= ?"); args.push(f.sinceMs); }
  if (f.untilMs !== undefined) { conds.push("at <= ?"); args.push(f.untilMs); }
  return { sql: conds.join(" AND "), args };
}

export function toApiLog(r: Row, erased: ReadonlySet<string>): ApiLog | null {
  const id = numOf(r["id"]), at = numOf(r["at"]), msg = str(r["msg"]);
  if (id === undefined || at === undefined || msg === undefined) return null;
  const out: ApiLog = { id, at, level: levelName(numOf(r["level"]) ?? LEVELS.info), msg };
  const set = <K extends "traceId" | "spanId" | "actor" | "onBehalf" | "runId" | "place" | "cap" | "entity" | "entityId" | "result">(k: K, v: string | undefined): void => {
    if (v !== undefined) out[k] = v;
  };
  set("traceId", str(r["trace_id"]));
  set("spanId", str(r["span_id"]));
  const actor = str(r["actor"]), behalf = str(r["on_behalf"]);
  set("actor", actor !== undefined && erased.has(actor) ? undefined : actor);
  set("onBehalf", behalf !== undefined && erased.has(behalf) ? undefined : behalf);
  set("runId", str(r["run_id"]));
  set("place", str(r["place"]));
  set("cap", str(r["cap"]));
  set("entity", str(r["entity"]));
  set("entityId", str(r["entity_id"]));
  set("result", str(r["result"]));
  const dur = numOf(r["dur_ms"]), cost = numOf(r["cost_micros"]), label = numOf(r["label"]);
  if (dur !== undefined) out.durMs = dur;
  if (cost !== undefined) out.costMicros = cost;
  if (label !== undefined) out.label = label;
  const attrs = jsonObj(r["attrs"]);
  if (attrs) out.attrs = attrs;
  return out;
}

export function toApiSpan(r: Row): ApiSpan | null {
  const traceId = str(r["trace_id"]), spanId = str(r["span_id"]), name = str(r["name"]), at = numOf(r["at"]);
  if (!traceId || !spanId || !name || at === undefined) return null;
  const out: ApiSpan = { traceId, spanId, name, at, durUs: numOf(r["dur_us"]) ?? 0 };
  const parent = str(r["parent"]);
  if (parent) out.parent = parent;
  const attrs = jsonObj(r["attrs"]);
  if (attrs) out.attrs = attrs;
  return out;
}

export function toApiEvent(r: Row, erased: ReadonlySet<string>): ApiEvent | null {
  const seq = numOf(r["seq"]), type = str(r["type"]), at = numOf(r["at"]);
  if (seq === undefined || !type || at === undefined) return null;
  const actor = str(r["actor"]) ?? "";
  const out: ApiEvent = { seq, type, at, actor: erased.has(actor) ? "" : actor };
  const entity = str(r["entity"]);
  if (entity) out.entity = entity;
  return out;
}

function compact<T>(list: readonly (T | null)[]): T[] {
  const out: T[] = [];
  for (const x of list) if (x !== null) out.push(x);
  return out;
}

function countOf(db: Db, sql: string, args: unknown[]): number {
  const r = asRow(db.all(sql, ...args)[0]);
  return r ? (numOf(r["n"]) ?? 0) : 0;
}

/** Newest first. `next` is the id of the last row returned; pass it as `cursor` for the following page. */
export function queryLogs(db: Db, space: string, filter: LogFilter, page: Page | undefined): QueryOut {
  const erased = erasedActors(db);
  if ((filter.person && erased.has(filter.person)) || (filter.agent && erased.has(filter.agent))) return { rows: [], total: 0 };
  const w = buildWhere(space, filter);
  const after = cursorNumber(page);
  const limit = limitOf(page);
  const total = countOf(db, `SELECT COUNT(*) AS n FROM logs_row WHERE ${w.sql}`, w.args);
  const paged = after === null ? w : { sql: `${w.sql} AND id < ?`, args: [...w.args, after] };
  const found = db.all(`SELECT * FROM logs_row WHERE ${paged.sql} ORDER BY id DESC LIMIT ?`, ...paged.args, limit + 1);
  const rows = compact(found.slice(0, limit).map((r) => { const row = asRow(r); return row ? toApiLog(row, erased) : null; }));
  const out: QueryOut = { rows, total };
  const last = rows[rows.length - 1];
  if (found.length > limit && last) out.next = String(last.id);
  return out;
}

/** Everything one trace left: log rows and spans in time order, events in sequence order. */
export function traceView(db: Db, space: string, traceId: string): TraceOut {
  const erased = erasedActors(db);
  const logs = db.all("SELECT * FROM logs_row WHERE space = ? AND trace_id = ? ORDER BY at, id LIMIT ?", space, traceId, TRACE_CAP);
  const spans = db.all("SELECT * FROM logs_span WHERE space = ? AND trace_id = ? ORDER BY at, span_id LIMIT ?", space, traceId, TRACE_CAP);
  const events = db.all("SELECT * FROM logs_event WHERE trace_id = ? ORDER BY seq LIMIT ?", traceId, TRACE_CAP);
  return {
    logs: compact(logs.map((r) => { const row = asRow(r); return row ? toApiLog(row, erased) : null; })),
    spans: compact(spans.map((r) => { const row = asRow(r); return row ? toApiSpan(row) : null; })),
    events: compact(events.map((r) => { const row = asRow(r); return row ? toApiEvent(row, erased) : null; })),
  };
}

/** Spans of one trace, or of one name (a budget id for the speed page). The cursor is a row offset. */
export function spansOf(db: Db, space: string, filter: { traceId?: string; name?: string }, page: Page | undefined): SpansOut {
  const conds = ["space = ?"];
  const args: unknown[] = [space];
  if (filter.traceId) { conds.push("trace_id = ?"); args.push(filter.traceId); }
  if (filter.name) { conds.push("name = ?"); args.push(filter.name); }
  const where = conds.join(" AND ");
  const offset = cursorNumber(page) ?? 0;
  const limit = limitOf(page);
  const total = countOf(db, `SELECT COUNT(*) AS n FROM logs_span WHERE ${where}`, args);
  const found = db.all(`SELECT * FROM logs_span WHERE ${where} ORDER BY at, span_id LIMIT ? OFFSET ?`, ...args, limit, offset);
  const spans = compact(found.map((r) => { const row = asRow(r); return row ? toApiSpan(row) : null; }));
  const out: SpansOut = { spans, total };
  if (offset + limit < total) out.next = String(offset + limit);
  return out;
}

/** Rows for an export: the same search, oldest first, up to `max`. Returned as the JSON lines the file will hold. */
export function exportLines(db: Db, space: string, filter: LogFilter, max: number): string[] {
  const erased = erasedActors(db);
  if ((filter.person && erased.has(filter.person)) || (filter.agent && erased.has(filter.agent))) return [];
  const w = buildWhere(space, filter);
  const found = db.all(`SELECT * FROM logs_row WHERE ${w.sql} ORDER BY id LIMIT ?`, ...w.args, max);
  const lines: string[] = [];
  for (const r of found) {
    const row = asRow(r);
    const api = row ? toApiLog(row, erased) : null;
    if (api) lines.push(JSON.stringify(api));
  }
  return lines;
}
