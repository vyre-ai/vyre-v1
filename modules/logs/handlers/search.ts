// logs search and trace view. Reads logs_* rows. A tombstone blanks that actor on read. Rows keep their ids.
import type { ScopedDb } from "../../../packages/contracts/src/ctx.ts";
import { levelNum, prune, type LevelName } from "./sink.ts";

export interface LogQuery {
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
  cursor?: string;
  limit?: number;
}

export interface LogRowOut {
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

export interface SpanOut {
  traceId: string;
  spanId: string;
  name: string;
  at: number;
  durUs: number;
  parent?: string;
  attrs?: Record<string, unknown>;
}

export interface EventOut {
  seq: number;
  type: string;
  at: number;
  actor: string;
  entity?: string;
}

export interface TraceOut {
  logs: LogRowOut[];
  spans: SpanOut[];
  events: EventOut[];
}

const LEVEL_NAME: Record<number, LevelName> = { 10: "debug", 20: "info", 30: "warn", 40: "error" };

function rec(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object") return v as Record<string, unknown>;
  return {};
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function attrsOf(v: unknown): Record<string, unknown> | undefined {
  if (typeof v !== "string" || v.length === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(v);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
  return undefined;
}

export function tombstones(db: ScopedDb, space: string): Set<string> {
  const out = new Set<string>();
  for (const item of db.all("SELECT actor FROM logs_tombstone WHERE space = ?", space)) {
    const actor = str(rec(item).actor);
    if (actor) out.add(actor);
  }
  return out;
}

export function mapLog(v: unknown, tomb: Set<string>): LogRowOut {
  const r = rec(v);
  const levelN = num(r.level) ?? 20;
  const out: LogRowOut = {
    id: num(r.id) ?? 0,
    at: num(r.at) ?? 0,
    level: LEVEL_NAME[levelN] ?? "info",
    msg: str(r.msg) ?? "log.line",
  };
  const traceId = str(r.trace_id);
  const spanId = str(r.span_id);
  const actor = str(r.actor);
  const onBehalf = str(r.on_behalf);
  const runId = str(r.run_id);
  const place = str(r.place);
  const cap = str(r.cap);
  const entity = str(r.entity);
  const entityId = str(r.entity_id);
  const result = str(r.result);
  const durMs = num(r.dur_ms);
  const costMicros = num(r.cost_micros);
  const label = num(r.label);
  const attrs = attrsOf(r.attrs);
  if (traceId) out.traceId = traceId;
  if (spanId) out.spanId = spanId;
  if (actor && !tomb.has(actor)) out.actor = actor;
  if (onBehalf && !tomb.has(onBehalf)) out.onBehalf = onBehalf;
  if (runId) out.runId = runId;
  if (place) out.place = place;
  if (cap) out.cap = cap;
  if (entity) out.entity = entity;
  if (entityId) out.entityId = entityId;
  if (result) out.result = result;
  if (durMs !== undefined) out.durMs = durMs;
  if (costMicros !== undefined) out.costMicros = costMicros;
  if (label !== undefined) out.label = label;
  if (attrs) out.attrs = attrs;
  return out;
}

function mapSpan(v: unknown): SpanOut {
  const r = rec(v);
  const out: SpanOut = {
    traceId: str(r.trace_id) ?? "",
    spanId: str(r.span_id) ?? "",
    name: str(r.name) ?? "span",
    at: num(r.at) ?? 0,
    durUs: num(r.dur_us) ?? 0,
  };
  const parent = str(r.parent);
  const attrs = attrsOf(r.attrs);
  if (parent) out.parent = parent;
  if (attrs) out.attrs = attrs;
  return out;
}

function mapEvent(v: unknown, tomb: Set<string>): EventOut {
  const r = rec(v);
  const actor = str(r.actor);
  const out: EventOut = {
    seq: num(r.seq) ?? 0,
    type: str(r.type) ?? "event",
    at: num(r.at) ?? 0,
    actor: actor && !tomb.has(actor) ? actor : "",
  };
  const entity = str(r.entity);
  if (entity) out.entity = entity;
  return out;
}

function whereOf(space: string, q: LogQuery, withCursor: boolean): { sql: string; args: unknown[] } {
  const parts = ["space = ?"];
  const args: unknown[] = [space];
  if (q.person) {
    parts.push("(actor = ? OR on_behalf = ?)");
    args.push(q.person, q.person);
  }
  if (q.agent) {
    parts.push("actor = ?");
    args.push(q.agent);
  }
  if (q.place) {
    parts.push("place = ?");
    args.push(q.place);
  }
  if (q.recordId) {
    parts.push("entity_id = ?");
    args.push(q.recordId);
  }
  if (q.runId) {
    parts.push("run_id = ?");
    args.push(q.runId);
  }
  if (q.traceId) {
    parts.push("trace_id = ?");
    args.push(q.traceId);
  }
  if (q.cap) {
    parts.push("cap = ?");
    args.push(q.cap);
  }
  if (q.level) {
    parts.push("level = ?");
    args.push(levelNum(q.level));
  }
  if (q.result) {
    parts.push("result = ?");
    args.push(q.result);
  }
  if (q.sinceMs !== undefined) {
    parts.push("at >= ?");
    args.push(q.sinceMs);
  }
  if (q.untilMs !== undefined) {
    parts.push("at <= ?");
    args.push(q.untilMs);
  }
  if (withCursor && q.cursor && /^\d+$/.test(q.cursor)) {
    parts.push("id > ?");
    args.push(Number(q.cursor));
  }
  return { sql: parts.join(" AND "), args };
}

export function searchLogs(db: ScopedDb, space: string, q: LogQuery, now: number): { rows: LogRowOut[]; total: number; next?: string } {
  prune(db, space, now);
  const limit = Math.min(500, Math.max(1, q.limit ?? 50));
  const filter = whereOf(space, q, false);
  const countRows = db.all(`SELECT COUNT(*) AS n FROM logs_row WHERE ${filter.sql}`, ...filter.args);
  const total = num(rec(countRows[0]).n) ?? 0;
  const page = whereOf(space, q, true);
  const raw = db.all(`SELECT * FROM logs_row WHERE ${page.sql} ORDER BY id ASC LIMIT ?`, ...page.args, limit + 1);
  const tomb = tombstones(db, space);
  const rows = raw.slice(0, limit).map((r) => mapLog(r, tomb));
  const out: { rows: LogRowOut[]; total: number; next?: string } = { rows, total };
  const last = rows[rows.length - 1];
  if (raw.length > limit && last) out.next = String(last.id);
  return out;
}

export function traceOf(db: ScopedDb, space: string, traceId: string, now: number): TraceOut {
  prune(db, space, now);
  const tomb = tombstones(db, space);
  const logs = db.all("SELECT * FROM logs_row WHERE space = ? AND trace_id = ? ORDER BY id ASC", space, traceId).map((r) => mapLog(r, tomb));
  const spans = db.all("SELECT * FROM logs_span WHERE space = ? AND trace_id = ? ORDER BY at ASC, id ASC", space, traceId).map((r) => mapSpan(r));
  const events = db.all("SELECT * FROM logs_event WHERE space = ? AND trace_id = ? ORDER BY seq ASC", space, traceId).map((r) => mapEvent(r, tomb));
  return { logs, spans, events };
}

export function spansOf(db: ScopedDb, space: string, q: { traceId?: string; name?: string; cursor?: string; limit?: number }, now: number): { spans: SpanOut[]; total: number; next?: string } {
  prune(db, space, now);
  const parts = ["space = ?"];
  const args: unknown[] = [space];
  if (q.traceId) {
    parts.push("trace_id = ?");
    args.push(q.traceId);
  }
  if (q.name) {
    parts.push("name = ?");
    args.push(q.name);
  }
  const where = parts.join(" AND ");
  const total = num(rec(db.all(`SELECT COUNT(*) AS n FROM logs_span WHERE ${where}`, ...args)[0]).n) ?? 0;
  const pageArgs = args.slice();
  let pageWhere = where;
  if (q.cursor && /^\d+$/.test(q.cursor)) {
    pageWhere = `${where} AND id > ?`;
    pageArgs.push(Number(q.cursor));
  }
  const limit = Math.min(500, Math.max(1, q.limit ?? 50));
  const raw = db.all(`SELECT * FROM logs_span WHERE ${pageWhere} ORDER BY at ASC, id ASC LIMIT ?`, ...pageArgs, limit + 1);
  const slice = raw.slice(0, limit);
  const spans = slice.map((r) => mapSpan(r));
  const out: { spans: SpanOut[]; total: number; next?: string } = { spans, total };
  const lastId = num(rec(slice[slice.length - 1]).id);
  if (raw.length > limit && lastId !== undefined) out.next = String(lastId);
  return out;
}
