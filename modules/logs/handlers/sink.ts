// Log sink (ARCH 4.10, 4.11, spec 4.18). Structured rows batch into the logs_* tables.
// A row holds ids, times, counts and results. msg is a fixed template key. attrs is JSON of ids and counts.
// Content-bearing keys, sealed values, Restricted values and known secrets never reach a stored row.
// The writer takes the module's ctx.db, so a table outside logs_* is refused by the host before it runs.

import type { ScopedDb } from "../../../packages/contracts/src/ctx.ts";

export type Db = ScopedDb;

export const DAY_MS = 86_400_000;
export const DEFAULT_FULL_DAYS = 30;
export const DEFAULT_AGGREGATE_DAYS = 180;
/** Upper bound for rows held in memory when logs.db is slow or failing; the oldest are dropped first. */
export const MAX_QUEUE = 10_000;
/** One upload never writes more than this many client entries. */
export const MAX_UPLOAD = 5_000;
const MAX_ATTRS_BYTES = 8_192;
const MAX_DEPTH = 6;
const FOLD_BATCH = 1_000;

export const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type LevelName = keyof typeof LEVELS;

/** Keys the log lint forbids in attrs. The sink drops them as a second line of defence. */
export const CONTENT_KEYS: readonly string[] = Object.freeze([
  "body", "text", "subject", "value", "secret", "password", "token", "content", "message",
]);
const CONTENT_RE = new RegExp(`^(${CONTENT_KEYS.join("|")})$`, "i");
const MSG_KEY = /^[a-z][a-z0-9_.]{0,79}$/;
const NAME_RE = /^[A-Za-z0-9_.:/-]{1,120}$/;
const ID_RE = /^[A-Za-z0-9_.:/-]{1,128}$/;
const TRACE_RE = /^[0-9a-f]{32}$/;
const SPAN_RE = /^[0-9a-f]{16}$/;
const REDACTED = "[redacted]";
const DROP = Symbol("drop");

export function levelNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (v === "debug" || v === "info" || v === "warn" || v === "error") return LEVELS[v];
  return LEVELS.info;
}

export function levelName(n: number): LevelName {
  if (n >= LEVELS.error) return "error";
  if (n >= LEVELS.warn) return "warn";
  if (n >= LEVELS.info) return "info";
  return "debug";
}

function labelNumber(v: unknown): number | null {
  if (v === "public") return 0;
  if (v === "internal") return 1;
  if (v === "confidential") return 2;
  if (v === "restricted") return 3;
  if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 3) return Math.trunc(v);
  return null;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** A sealed field value: a seal wrapper, or ciphertext bytes. Never stored. */
export function isSealed(v: unknown): boolean {
  if (!isObj(v)) return false;
  if ("sealed" in v) return true;
  if (typeof v["ciphertext"] === "string") return true;
  return typeof v["bytes"] === "string" && typeof v["nonce"] === "string";
}

/** A Restricted value: label rank 3 or an object marked restricted. Never stored. */
export function isRestricted(v: unknown): boolean {
  if (!isObj(v)) return false;
  return v["label"] === "restricted" || v["label"] === 3 || v["restricted"] === true;
}

/** True when the text is, or contains, a secret the process knows. Short secrets match whole strings only. */
export function hasSecret(text: string, secrets: readonly string[]): boolean {
  for (const s of secrets) {
    if (!s) continue;
    if (text === s) return true;
    if (s.length >= 6 && text.includes(s)) return true;
  }
  return false;
}

function scrub(v: unknown, secrets: readonly string[], depth: number): unknown {
  if (typeof v === "string") return hasSecret(v, secrets) ? REDACTED : v;
  if (typeof v === "number") return Number.isFinite(v) ? v : DROP;
  if (typeof v === "boolean" || v === null) return v;
  if (depth >= MAX_DEPTH) return DROP;
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    for (const item of v) {
      if (isSealed(item) || isRestricted(item)) continue;
      const y = scrub(item, secrets, depth + 1);
      if (y !== DROP) out.push(y);
    }
    return out;
  }
  if (isObj(v)) {
    if (isSealed(v) || isRestricted(v)) return DROP;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (CONTENT_RE.test(k) || k.toLowerCase() === "restricted") continue;
      if (isSealed(x) || isRestricted(x)) continue;
      const y = scrub(x, secrets, depth + 1);
      if (y !== DROP) out[k] = y;
    }
    return out;
  }
  return DROP;
}

/** The attrs a row may keep, or null. A Restricted row keeps none. */
export function scrubAttrs(attrs: unknown, secrets: readonly string[], restrictedRow = false): Record<string, unknown> | null {
  if (restrictedRow || isSealed(attrs) || isRestricted(attrs)) return null;
  const y = scrub(attrs, secrets, 0);
  if (!isObj(y) || Object.keys(y).length === 0) return null;
  if (JSON.stringify(y).length > MAX_ATTRS_BYTES) return { dropped: "size" };
  return y;
}

/** msg is a template key such as `record.updated`. Anything else becomes `log.redacted`. */
export function cleanMsg(msg: unknown, secrets: readonly string[]): string {
  if (typeof msg !== "string" || !MSG_KEY.test(msg) || hasSecret(msg, secrets)) return "log.redacted";
  return msg;
}

function cleanId(v: unknown, secrets: readonly string[]): string | null {
  if (typeof v !== "string" || !ID_RE.test(v) || hasSecret(v, secrets)) return null;
  return v;
}

function cleanTrace(v: unknown): string | null {
  return typeof v === "string" && TRACE_RE.test(v) ? v : null;
}

function cleanSpanId(v: unknown): string | null {
  return typeof v === "string" && SPAN_RE.test(v) ? v : null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") return Number(v);
  return null;
}

function int(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.trunc(n);
}

/** First defined value among the camelCase and snake_case spellings of a field. */
function pick(o: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined) return o[k];
  return undefined;
}

export const ROW_COLS = [
  "at", "level", "trace_id", "span_id", "space", "actor", "on_behalf", "run_id", "thread_id", "device", "place",
  "cap", "entity", "entity_id", "result", "dur_ms", "cost_micros", "tokens_in", "tokens_out", "label",
  "app_version", "server_version", "machine", "msg", "attrs",
] as const;
export type RowCol = (typeof ROW_COLS)[number];
export type RowData = Record<RowCol, string | number | null>;

const ROW_SQL = `INSERT INTO logs_row (${ROW_COLS.join(", ")}) VALUES (${ROW_COLS.map(() => "?").join(", ")})`;
const SPAN_SQL = "INSERT OR REPLACE INTO logs_span (space, trace_id, span_id, parent, name, at, dur_us, attrs) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
const EVENT_SQL = "INSERT OR REPLACE INTO logs_event (seq, trace_id, type, at, actor, entity) VALUES (?, ?, ?, ?, ?, ?)";

export interface SpanData { space: string; trace_id: string; span_id: string; parent: string | null; name: string; at: number; dur_us: number; attrs: string | null }
export interface EventData { seq: number; trace_id: string; type: string; at: number; actor: string; entity: string | null }

export function normalizeRow(space: string, line: unknown, now: number, secrets: readonly string[]): RowData | null {
  if (!isObj(line)) return null;
  const label = labelNumber(line["label"]);
  const attrs = scrubAttrs(line["attrs"], secrets, label === 3);
  const at = num(pick(line, "at", "when"));
  const id = (...keys: string[]): string | null => cleanId(pick(line, ...keys), secrets);
  return {
    at: at === null ? now : Math.min(at, now),
    level: levelNumber(line["level"]),
    trace_id: cleanTrace(pick(line, "traceId", "trace_id")),
    span_id: cleanSpanId(pick(line, "spanId", "span_id")),
    space,
    actor: id("actor"),
    on_behalf: id("onBehalf", "on_behalf"),
    run_id: id("runId", "run_id"),
    thread_id: id("threadId", "thread_id"),
    device: id("device"),
    place: id("place"),
    cap: id("cap"),
    entity: id("entity"),
    entity_id: id("entityId", "entity_id", "recordId"),
    result: id("result"),
    dur_ms: num(pick(line, "durMs", "dur_ms")),
    cost_micros: int(pick(line, "costMicros", "cost_micros")),
    tokens_in: int(pick(line, "tokensIn", "tokens_in")),
    tokens_out: int(pick(line, "tokensOut", "tokens_out")),
    label,
    app_version: id("appVersion", "app_version"),
    server_version: id("serverVersion", "server_version"),
    machine: id("machine"),
    msg: cleanMsg(line["msg"], secrets),
    attrs: attrs ? JSON.stringify(attrs) : null,
  };
}

export function normalizeSpan(space: string, line: unknown, now: number, secrets: readonly string[]): SpanData | null {
  if (!isObj(line)) return null;
  const trace = cleanTrace(pick(line, "traceId", "trace_id"));
  const spanId = cleanSpanId(pick(line, "spanId", "span_id"));
  const name = pick(line, "name");
  if (!trace || !spanId || typeof name !== "string" || !NAME_RE.test(name) || hasSecret(name, secrets)) return null;
  const attrs = scrubAttrs(line["attrs"], secrets);
  const at = num(pick(line, "at", "when"));
  const dur = int(pick(line, "durUs", "dur_us"));
  return {
    space,
    trace_id: trace,
    span_id: spanId,
    parent: cleanSpanId(line["parent"]),
    name,
    at: at === null ? now : at,
    dur_us: dur === null || dur < 0 ? 0 : dur,
    attrs: attrs ? JSON.stringify(attrs) : null,
  };
}

export function normalizeEvent(line: unknown, now: number, secrets: readonly string[]): EventData | null {
  if (!isObj(line)) return null;
  const trace = cleanTrace(pick(line, "traceId", "trace_id"));
  const seq = int(line["seq"]);
  const type = pick(line, "type");
  const actor = cleanId(line["actor"], secrets);
  if (!trace || seq === null || seq < 1 || typeof type !== "string" || !NAME_RE.test(type) || !actor) return null;
  const at = num(pick(line, "at", "when"));
  return { seq, trace_id: trace, type, at: at === null ? now : at, actor, entity: cleanId(line["entity"], secrets) };
}

export interface WriterOptions {
  db: Db;
  space: string;
  now?: () => number;
  /** Batch window in ms. 0 writes at once (handlers and tests). The host sink uses 250. */
  batchMs?: number;
  /** Strings that must never reach a row (the process's current secrets). */
  secrets?: () => readonly string[];
  /** Rows below this level are dropped; the Space setting from logs.settings_get. */
  minLevel?: LevelName | number;
}

export class LogWriter {
  private db: Db;
  private space: string;
  private nowFn: () => number;
  private batchMs: number;
  private secretsFn: () => readonly string[];
  private min: number;
  private rows: RowData[] = [];
  private spans: SpanData[] = [];
  private events: EventData[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Rows dropped because the queue was full. */
  dropped = 0;
  /** The last flush error from the timer; flush() called directly throws instead. */
  lastError: unknown = null;

  constructor(o: WriterOptions) {
    this.db = o.db;
    this.space = o.space;
    this.nowFn = o.now ?? Date.now;
    this.batchMs = o.batchMs ?? 250;
    this.secretsFn = o.secrets ?? (() => []);
    this.min = typeof o.minLevel === "number" ? o.minLevel : LEVELS[o.minLevel ?? "info"];
  }

  setMinLevel(level: LevelName | number): void { this.min = typeof level === "number" ? level : LEVELS[level]; }
  pending(): number { return this.rows.length + this.spans.length + this.events.length; }

  /** Queue one log line. False when it was not an object, or was below the Space's level. */
  write(line: unknown): boolean {
    const row = normalizeRow(this.space, line, this.nowFn(), this.secretsFn());
    if (!row || (row.level as number) < this.min) return false;
    this.rows.push(row);
    this.trim();
    this.schedule();
    return true;
  }

  span(line: unknown): boolean {
    const span = normalizeSpan(this.space, line, this.nowFn(), this.secretsFn());
    if (!span) return false;
    this.spans.push(span);
    this.trim();
    this.schedule();
    return true;
  }

  event(line: unknown): boolean {
    const ev = normalizeEvent(line, this.nowFn(), this.secretsFn());
    if (!ev) return false;
    this.events.push(ev);
    this.trim();
    this.schedule();
    return true;
  }

  /** One JSON line from the sink worker: `kind` is span, event, or absent for a log row. */
  acceptLine(text: string): boolean {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return false; }
    if (!isObj(parsed)) return false;
    if (parsed["kind"] === "span") return this.span(parsed);
    if (parsed["kind"] === "event") return this.event(parsed);
    return this.write(parsed);
  }

  /** Write everything queued. A failing statement leaves it and the rest queued, and throws. */
  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const rows = this.rows, spans = this.spans, events = this.events;
    this.rows = []; this.spans = []; this.events = [];
    let i = 0, j = 0, k = 0;
    try {
      for (; i < rows.length; i++) this.db.run(ROW_SQL, ...ROW_COLS.map((c) => rows[i]![c]));
      for (; j < spans.length; j++) {
        const s = spans[j]!;
        this.db.run(SPAN_SQL, s.space, s.trace_id, s.span_id, s.parent, s.name, s.at, s.dur_us, s.attrs);
      }
      for (; k < events.length; k++) {
        const e = events[k]!;
        this.db.run(EVENT_SQL, e.seq, e.trace_id, e.type, e.at, e.actor, e.entity);
      }
    } catch (e) {
      this.rows = rows.slice(i).concat(this.rows);
      this.spans = spans.slice(j).concat(this.spans);
      this.events = events.slice(k).concat(this.events);
      this.trim();
      throw e;
    }
  }

  close(): void { this.flush(); }

  private trim(): void {
    const over = this.rows.length - MAX_QUEUE;
    if (over > 0) { this.rows.splice(0, over); this.dropped += over; }
  }

  private schedule(): void {
    if (this.batchMs <= 0) { this.flush(); return; }
    if (this.timer) return;
    const timer = setTimeout(() => {
      this.timer = null;
      try { this.flush(); this.lastError = null; } catch (e) { this.lastError = e; this.schedule(); }
    }, this.batchMs);
    this.timer = timer;
    (timer as unknown as { unref?: () => void }).unref?.();
  }
}

// ---- settings, holds, tombstones

export interface Settings { level: LevelName; fullDays: number; aggregateDays: number }

export function readSettings(db: Db, space: string): Settings {
  const r = db.all("SELECT level, full_days, aggregate_days FROM logs_settings WHERE space = ?", space)[0];
  if (!isObj(r)) return { level: "info", fullDays: DEFAULT_FULL_DAYS, aggregateDays: DEFAULT_AGGREGATE_DAYS };
  const full = int(r["full_days"]), agg = int(r["aggregate_days"]);
  return {
    level: levelName(levelNumber(r["level"])),
    fullDays: full !== null && full >= 1 ? full : DEFAULT_FULL_DAYS,
    aggregateDays: agg !== null && agg >= 1 ? agg : DEFAULT_AGGREGATE_DAYS,
  };
}

export function writeSettings(db: Db, space: string, s: Settings): void {
  db.run("INSERT OR REPLACE INTO logs_settings (space, level, full_days, aggregate_days) VALUES (?, ?, ?, ?)", space, LEVELS[s.level], s.fullDays, s.aggregateDays);
}

export function placeHold(db: Db, space: string, id: string, untilMs: number | null = null): void {
  db.run("INSERT OR REPLACE INTO logs_hold (id, space, until_ms) VALUES (?, ?, ?)", id, space, untilMs);
}

export function releaseHold(db: Db, space: string, id: string): void {
  db.run("DELETE FROM logs_hold WHERE id = ? AND space = ?", id, space);
}

/** A hold with no end date, or an end date still ahead, blocks expiry (ARCH 4.11). */
export function holdActive(db: Db, space: string, now: number): boolean {
  for (const r of db.all("SELECT id, until_ms FROM logs_hold WHERE space = ?", space)) {
    if (!isObj(r)) continue;
    const until = num(r["until_ms"]);
    if (until === null || until > now) return true;
  }
  return false;
}

/** Erase a person: their rows keep the id, and every read blanks it. */
export function eraseActor(db: Db, actor: string, now: number): void {
  db.run("INSERT OR REPLACE INTO logs_tombstone (actor, at) VALUES (?, ?)", actor, now);
}

export function erasedActors(db: Db): Set<string> {
  const out = new Set<string>();
  for (const r of db.all("SELECT actor FROM logs_tombstone")) {
    if (isObj(r) && typeof r["actor"] === "string") out.add(r["actor"]);
  }
  return out;
}

// ---- retention (ARCH 4.11): full rows for fullDays, per-day aggregates for aggregateDays, then gone

export interface RetentionResult { held: boolean; folded: number; deleted: number }

interface Fold { day: number; level: number; cap: string; result: string; n: number; cost: number; dur: number }

function foldInto(map: Map<string, Fold>, r: Record<string, unknown>): void {
  const at = num(r["at"]) ?? 0;
  const day = Math.floor(at / DAY_MS) * DAY_MS;
  const level = int(r["level"]) ?? LEVELS.info;
  const cap = typeof r["cap"] === "string" ? r["cap"] : "";
  const result = typeof r["result"] === "string" ? r["result"] : "";
  const key = `${day}|${level}|${cap}|${result}`;
  const f = map.get(key) ?? { day, level, cap, result, n: 0, cost: 0, dur: 0 };
  f.n += 1;
  f.cost += int(r["cost_micros"]) ?? 0;
  f.dur += num(r["dur_ms"]) ?? 0;
  map.set(key, f);
}

function saveFold(db: Db, space: string, f: Fold): void {
  const key = [space, f.day, f.level, f.cap, f.result];
  const found = db.all("SELECT n_rows, cost_micros, dur_ms FROM logs_aggregate WHERE space = ? AND day = ? AND level = ? AND cap = ? AND result = ?", ...key)[0];
  if (isObj(found)) {
    db.run(
      "UPDATE logs_aggregate SET n_rows = ?, cost_micros = ?, dur_ms = ? WHERE space = ? AND day = ? AND level = ? AND cap = ? AND result = ?",
      (int(found["n_rows"]) ?? 0) + f.n, (int(found["cost_micros"]) ?? 0) + f.cost, (num(found["dur_ms"]) ?? 0) + f.dur, ...key,
    );
    return;
  }
  db.run("INSERT INTO logs_aggregate (space, day, level, cap, result, n_rows, cost_micros, dur_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ...key, f.n, f.cost, f.dur);
}

/** The daily retention job. A hold skips it. Safe to run twice: folded rows are deleted in the same pass. */
export function runRetention(db: Db, space: string, now: number): RetentionResult {
  if (holdActive(db, space, now)) return { held: true, folded: 0, deleted: 0 };
  const s = readSettings(db, space);
  const fullBefore = now - s.fullDays * DAY_MS;
  const aggBefore = now - s.aggregateDays * DAY_MS;
  let folded = 0, deleted = 0;
  for (;;) {
    const batch = db.all("SELECT id, at, level, cap, result, cost_micros, dur_ms FROM logs_row WHERE space = ? AND at < ? ORDER BY id LIMIT ?", space, fullBefore, FOLD_BATCH);
    if (batch.length === 0) break;
    const map = new Map<string, Fold>();
    let maxId = 0;
    for (const r of batch) {
      if (!isObj(r)) continue;
      foldInto(map, r);
      maxId = Math.max(maxId, int(r["id"]) ?? 0);
    }
    for (const f of map.values()) saveFold(db, space, f);
    deleted += db.run("DELETE FROM logs_row WHERE space = ? AND at < ? AND id <= ?", space, fullBefore, maxId).changes;
    folded += batch.length;
    if (batch.length < FOLD_BATCH) break;
  }
  db.run("DELETE FROM logs_span WHERE space = ? AND at < ?", space, fullBefore);
  db.run("DELETE FROM logs_event WHERE at < ?", fullBefore);
  db.run("DELETE FROM logs_export WHERE space = ? AND at < ?", space, fullBefore);
  db.run("DELETE FROM logs_stream WHERE space = ? AND at < ?", space, now - DAY_MS);
  db.run("DELETE FROM logs_aggregate WHERE space = ? AND day < ?", space, aggBefore);
  return { held: false, folded, deleted };
}
