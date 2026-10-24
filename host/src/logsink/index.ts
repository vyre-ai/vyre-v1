// logs.db (ARCH 4.10): structured rows written in batches by a sink, read by trace id. No content goes in a row: `msg` is a fixed template key, `attrs` holds ids and counts, and a redaction pass drops
// any attr whose key names content (body, text, subject, value, secret, ...) and any string equal to a secret the process knows.
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "../../../packages/contracts/src/ctx.ts";
import type { SpanRow, SpanSink } from "../trace/index.ts";

export const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
/** Keys that carry content. A lint forbids them in attrs; the sink drops them as a second line. */
export const CONTENT_KEYS: readonly string[] = Object.freeze(["body", "text", "subject", "value", "secret", "password", "token", "content", "message"]);
const CONTENT_RE = new RegExp(`^(${CONTENT_KEYS.join("|")})$`, "i");

export const LOGS_SCHEMA = `
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY, at INTEGER NOT NULL, level INTEGER NOT NULL,
  trace_id TEXT, span_id TEXT, space TEXT NOT NULL,
  actor TEXT, on_behalf TEXT, run_id TEXT, thread_id TEXT, device TEXT, place TEXT,
  cap TEXT, entity TEXT, entity_id TEXT,
  result TEXT, dur_ms REAL, cost_micros INTEGER, tokens_in INTEGER, tokens_out INTEGER,
  label INTEGER, app_version TEXT, server_version TEXT, machine TEXT,
  msg TEXT NOT NULL, attrs TEXT
);
CREATE INDEX IF NOT EXISTS logs_trace ON logs(trace_id);
CREATE INDEX IF NOT EXISTS logs_actor ON logs(actor, at);
CREATE INDEX IF NOT EXISTS logs_cap ON logs(cap, at);
CREATE TABLE IF NOT EXISTS spans (trace_id TEXT, span_id TEXT, parent TEXT, name TEXT, at INTEGER, dur_us INTEGER, attrs TEXT);
CREATE INDEX IF NOT EXISTS spans_trace ON spans(trace_id);
CREATE TABLE IF NOT EXISTS health_samples (check_key TEXT, at INTEGER, state TEXT, latency_ms REAL, detail TEXT);
CREATE TABLE IF NOT EXISTS log_tombstones (actor TEXT PRIMARY KEY, at INTEGER);
`;

/** The columns a caller may set on a row besides level, msg and attrs. */
export interface LogContext {
  space: string; trace_id?: string | undefined; span_id?: string | undefined; actor?: string | undefined; on_behalf?: string | undefined; run_id?: string | undefined; thread_id?: string | undefined;
  device?: string | undefined; place?: string | undefined; cap?: string | undefined; entity?: string | undefined; entity_id?: string | undefined; result?: string | undefined; dur_ms?: number | undefined;
  label?: number | undefined; app_version?: string | undefined; server_version?: string | undefined; machine?: string | undefined;
}
export interface LogRow extends LogContext { level: number; msg: string; attrs?: Record<string, unknown> | undefined }
export interface StoredLog extends LogContext { id: number; at: number; level: number; msg: string; attrs: Record<string, unknown> | null }

const COLS = ["trace_id", "span_id", "actor", "on_behalf", "run_id", "thread_id", "device", "place", "cap", "entity", "entity_id", "result", "dur_ms", "label", "app_version", "server_version", "machine"] as const;

export interface LogSinkOptions {
  db?: DatabaseSync;
  path?: string;
  /** Batch window, default 250 ms. 0 writes at once (tests). */
  batchMs?: number;
  now?: () => number;
  /** Strings that must never reach a row (the process's current secrets). */
  secrets?: () => readonly string[];
}

export class LogSink implements SpanSink {
  readonly db: DatabaseSync;
  private rows: { at: number; row: LogRow }[] = [];
  private spans: SpanRow[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private batchMs: number;
  private now: () => number;
  private secrets: () => readonly string[];

  constructor(o: LogSinkOptions = {}) {
    this.db = o.db ?? new DatabaseSync(o.path ?? ":memory:");
    this.db.exec(LOGS_SCHEMA);
    this.batchMs = o.batchMs ?? 250;
    this.now = o.now ?? Date.now;
    this.secrets = o.secrets ?? (() => []);
  }

  /** Drop content-bearing keys and known secrets. Nested objects are cleaned the same way. */
  redact(v: unknown): unknown {
    if (typeof v === "string") return this.secrets().some((s) => s && v === s) ? "[redacted]" : v;
    if (Array.isArray(v)) return v.map((x) => this.redact(x));
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) if (!CONTENT_RE.test(k)) out[k] = this.redact(x);
      return out;
    }
    return v;
  }

  log(row: LogRow): void {
    this.rows.push({ at: this.now(), row });
    this.schedule();
  }
  span(row: SpanRow): void {
    this.spans.push(row);
    this.schedule();
  }
  private schedule(): void {
    if (this.batchMs <= 0) { this.flush(); return; }
    if (!this.timer) { this.timer = setTimeout(() => this.flush(), this.batchMs); this.timer.unref(); }
  }

  /** Write everything queued as one transaction. */
  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.rows.length && !this.spans.length) return;
    const rows = this.rows, spans = this.spans;
    this.rows = []; this.spans = [];
    const insLog = this.db.prepare(`INSERT INTO logs (at, level, space, ${COLS.join(", ")}, msg, attrs) VALUES (?, ?, ?, ${COLS.map(() => "?").join(", ")}, ?, ?)`);
    const insSpan = this.db.prepare("INSERT INTO spans (trace_id, span_id, parent, name, at, dur_us, attrs) VALUES (?, ?, ?, ?, ?, ?, ?)");
    this.db.exec("BEGIN");
    try {
      for (const { at, row } of rows) {
        const attrs = row.attrs ? JSON.stringify(this.redact(row.attrs)) : null;
        insLog.run(at, row.level, row.space, ...COLS.map((c) => row[c] ?? null), row.msg, attrs);
      }
      for (const s of spans) insSpan.run(s.trace_id, s.span_id, s.parent, s.name, s.at, s.dur_us, s.attrs ? JSON.stringify(this.redact(s.attrs)) : null);
      this.db.exec("COMMIT");
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }

  /** A Logger whose rows carry this context (trace, actor, device, cap...). */
  logger(ctx: LogContext): Logger {
    const at = (level: number) => (msg: string, attrs?: Record<string, unknown>): void => this.log({ ...ctx, level, msg, ...(attrs ? { attrs } : {}) });
    return { debug: at(LEVELS.debug), info: at(LEVELS.info), warn: at(LEVELS.warn), error: at(LEVELS.error) };
  }

  /** The Logger the invoke pipeline takes: it logs `traceId` among its attrs, and this lifts it into the row's trace_id column so `trace()` finds the row. */
  invokeLogger(space: string): Logger {
    const at = (level: number) => (msg: string, attrs?: Record<string, unknown>): void => {
      const t = attrs?.["traceId"];
      this.log({ space, level, msg, ...(typeof t === "string" ? { trace_id: t } : {}), ...(typeof attrs?.["cap"] === "string" ? { cap: attrs["cap"] } : {}), ...(attrs ? { attrs } : {}) });
    };
    return { debug: at(LEVELS.debug), info: at(LEVELS.info), warn: at(LEVELS.warn), error: at(LEVELS.error) };
  }

  /** Everything one trace left: log rows and spans, oldest first (`logs.trace`). A tombstoned actor reads as null. */
  trace(traceId: string): { logs: StoredLog[]; spans: { span_id: string; parent: string | null; name: string; at: number; dur_us: number }[] } {
    this.flush();
    const raw = this.db.prepare("SELECT l.*, (SELECT 1 FROM log_tombstones t WHERE t.actor = l.actor) AS erased FROM logs l WHERE trace_id = ? ORDER BY id").all(traceId) as Record<string, unknown>[];
    const logs = raw.map((r) => {
      const { erased, attrs, ...rest } = r;
      return { ...rest, ...(erased ? { actor: null } : {}), attrs: typeof attrs === "string" ? (JSON.parse(attrs) as Record<string, unknown>) : null } as unknown as StoredLog;
    });
    const spans = this.db.prepare("SELECT span_id, parent, name, at, dur_us FROM spans WHERE trace_id = ? ORDER BY at, rowid").all(traceId) as { span_id: string; parent: string | null; name: string; at: number; dur_us: number }[];
    return { logs, spans };
  }

  /** Erase a person: rows keep ids only, and reads blank the actor. */
  erase(actor: string): void { this.flush(); this.db.prepare("INSERT OR REPLACE INTO log_tombstones (actor, at) VALUES (?, ?)").run(actor, this.now()); }

  close(): void { this.flush(); this.db.close(); }
}
