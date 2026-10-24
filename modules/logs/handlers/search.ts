// Search and the trace view. One trace id returns its logs, spans and events.
// A tombstoned actor is blank on the way out; the stored id stays.

import { levelName } from "./sink.ts";
import type { LevelName, LogBook, StoredEvent, StoredRow, StoredSpan } from "./sink.ts";

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

export interface Page {
  cursor?: string;
  limit?: number;
}

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

export interface ApiSpan {
  traceId: string;
  spanId: string;
  name: string;
  at: number;
  durUs: number;
  parent?: string;
  attrs?: Record<string, unknown>;
}

export interface ApiEvent {
  seq: number;
  type: string;
  at: number;
  actor: string;
  entity?: string;
}

export interface QueryOut {
  rows: ApiLog[];
  total: number;
  next?: string;
}

export interface TraceOut {
  logs: ApiLog[];
  spans: ApiSpan[];
  events: ApiEvent[];
}

export interface SpansOut {
  spans: ApiSpan[];
  total: number;
  next?: string;
}

function matches(row: StoredRow, f: LogFilter): boolean {
  if (f.person && row.actor !== f.person && row.onBehalf !== f.person) return false;
  if (f.agent && row.actor !== f.agent && row.onBehalf !== f.agent) return false;
  if (f.place && row.place !== f.place) return false;
  if (f.recordId && row.entityId !== f.recordId) return false;
  if (f.runId && row.runId !== f.runId) return false;
  if (f.traceId && row.traceId !== f.traceId) return false;
  if (f.cap && row.cap !== f.cap) return false;
  if (f.level && levelName(row.level) !== f.level) return false;
  if (f.result && row.result !== f.result) return false;
  if (f.sinceMs !== undefined && row.at < f.sinceMs) return false;
  if (f.untilMs !== undefined && row.at > f.untilMs) return false;
  return true;
}

function put(out: Record<string, unknown>, key: string, value: string | number | Record<string, unknown> | undefined): void {
  if (value !== undefined) out[key] = value;
}

export function toApiLog(book: LogBook, row: StoredRow): ApiLog {
  const erased = book.erased(row.actor);
  const out: Record<string, unknown> = { id: row.id, at: row.at, level: levelName(row.level), msg: row.msg };
  put(out, "traceId", row.traceId);
  put(out, "spanId", row.spanId);
  if (!erased) put(out, "actor", row.actor);
  if (!book.erased(row.onBehalf)) put(out, "onBehalf", row.onBehalf);
  put(out, "runId", row.runId);
  put(out, "place", row.place);
  put(out, "cap", row.cap);
  put(out, "entity", row.entity);
  put(out, "entityId", row.entityId);
  put(out, "result", row.result);
  put(out, "durMs", row.durMs);
  put(out, "costMicros", row.costMicros);
  put(out, "label", row.label);
  if (row.attrs) out["attrs"] = row.attrs;
  return out as unknown as ApiLog;
}

export function toApiSpan(span: StoredSpan): ApiSpan {
  const out: ApiSpan = { traceId: span.traceId, spanId: span.spanId, name: span.name, at: span.at, durUs: span.durUs };
  if (span.parent) out.parent = span.parent;
  if (span.attrs) out.attrs = span.attrs;
  return out;
}

export function toApiEvent(book: LogBook, ev: StoredEvent): ApiEvent {
  const out: ApiEvent = {
    seq: ev.seq,
    type: ev.type,
    at: ev.at,
    actor: book.erased(ev.actor) ? "" : ev.actor,
  };
  if (ev.entity) out.entity = ev.entity;
  return out;
}

function bySpan(a: { at: number; spanId: string }, b: { at: number; spanId: string }): number {
  if (a.at !== b.at) return a.at - b.at;
  if (a.spanId < b.spanId) return -1;
  if (a.spanId > b.spanId) return 1;
  return 0;
}

function limitOf(page: Page | undefined): number {
  const n = page?.limit;
  if (n === undefined || !Number.isFinite(n)) return 50;
  return Math.min(500, Math.max(1, Math.trunc(n)));
}

export function query(book: LogBook, filter: LogFilter, page?: Page): QueryOut {
  book.prepareRead();
  const matched = book.rawRows().filter((row) => matches(row, filter)).sort((a, b) => a.id - b.id);
  const after = page?.cursor && /^[0-9]+$/.test(page.cursor) ? Number(page.cursor) : 0;
  const rest = after > 0 ? matched.filter((row) => row.id > after) : matched;
  const limit = limitOf(page);
  const window = rest.slice(0, limit);
  const out: QueryOut = { rows: window.map((row) => toApiLog(book, row)), total: matched.length };
  const last = window[window.length - 1];
  if (rest.length > limit && last) out.next = String(last.id);
  return out;
}

export function traceView(book: LogBook, traceId: string): TraceOut {
  book.prepareRead();
  const logs = book.rawRows().filter((row) => row.traceId === traceId).sort((a, b) => a.at - b.at || a.id - b.id).map((row) => toApiLog(book, row));
  const spans = book.rawSpans().filter((span) => span.traceId === traceId).sort(bySpan).map(toApiSpan);
  const events = book.rawEvents().filter((ev) => ev.traceId === traceId).sort((a, b) => a.seq - b.seq).map((ev) => toApiEvent(book, ev));
  return { logs, spans, events };
}

export function spansOf(book: LogBook, filter: { traceId?: string; name?: string }, page?: Page): SpansOut {
  book.prepareRead();
  const matched = book.rawSpans().filter((span) => {
    if (filter.traceId && span.traceId !== filter.traceId) return false;
    if (filter.name && span.name !== filter.name) return false;
    return true;
  }).sort(bySpan);
  const cursor = page?.cursor;
  let start = 0;
  if (cursor) {
    const i = matched.findIndex((span) => `${span.traceId}:${span.spanId}` === cursor);
    start = i >= 0 ? i + 1 : 0;
  }
  const limit = limitOf(page);
  const window = matched.slice(start, start + limit);
  const out: SpansOut = { spans: window.map(toApiSpan), total: matched.length };
  const last = window[window.length - 1];
  if (start + limit < matched.length && last) out.next = `${last.traceId}:${last.spanId}`;
  return out;
}
