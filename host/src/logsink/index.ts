// logs.db (ARCH 4.10): structured rows written in batches by a sink, read by trace id. No content goes in a row: `msg` is a fixed template key, `attrs` holds ids and counts, and a redaction pass drops
// any attr whose key names content (body, text, subject, value, secret, ...) and any string equal to a secret the process knows.
import { DatabaseSync } from "node:sqlite";
import type { TelemetryBatch, TelemetryPosition } from "../../../lib/telemetry.ts";
import type { Logger } from "../../../packages/contracts/src/ctx.ts";
import type { SpanRow, SpanSink } from "../trace/index.ts";

export const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
/** logs.db keeps a week of rows and at most this many bytes; the oldest go first, while the daemon runs. */
export const LOG_KEEP_MS = 7 * 86_400_000;
export const LOG_MAX_BYTES = 64 * 1024 * 1024;
/** A routine success (a poll that ran, a read that answered) is counted, and each key leaves one row per window. */
export const ROLLUP_MS = 3_600_000;
/** A run or a read that took this long is not routine: it is stored as it happened. */
export const SLOW_MS = 1_000;
/** How often a flush looks at the caps, how many rows one prune transaction removes, and how many of those one look may run. */
const PRUNE_EVERY_MS = 60_000;
const PRUNE_BATCH = 2_000;
const PRUNE_ROUNDS = 20;
/** Keys that carry content. A lint forbids them in attrs; the sink drops them as a second line. */
export const CONTENT_KEYS: readonly string[] = Object.freeze(["body", "text", "subject", "value", "secret", "password", "token", "content", "message"]);
const CONTENT_RE = new RegExp(`^(${CONTENT_KEYS.join("|")})$`, "i");

export const LOGS_SCHEMA = `
CREATE TABLE IF NOT EXISTS log_source (id TEXT PRIMARY KEY, row_seq INTEGER NOT NULL DEFAULT 0, span_seq INTEGER NOT NULL DEFAULT 0);
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
  /** An open handle; with `path` too, it is that file and gets the file's pragmas. A handle the caller passed is not closed when opening fails. */
  db?: DatabaseSync;
  path?: string;
  /** Batch window, default 250 ms. 0 writes at once (tests). */
  batchMs?: number;
  now?: () => number;
  /** Strings that must never reach a row (the process's current secrets). */
  secrets?: () => readonly string[];
  /** Age and size caps, LOG_KEEP_MS and LOG_MAX_BYTES by default. */
  keepMs?: number;
  maxBytes?: number;
  /** The rollup window for count(), ROLLUP_MS by default. */
  rollupMs?: number;
}

interface Tally { row: LogRow; since: number; count: number; ms: number; max: number }

export class LogSink implements SpanSink {
  readonly db: DatabaseSync;
  private rows: { at: number; row: LogRow }[] = [];
  private spans: SpanRow[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private observer: ((batch: TelemetryBatch) => void) | undefined;
  private observed: TelemetryPosition = { rowId: 0, spanId: 0 };
  readonly sourceId: string;
  private batchMs: number;
  private now: () => number;
  private secrets: () => readonly string[];
  private keepMs: number;
  private maxBytes: number;
  private rollupMs: number;
  private tallies = new Map<string, Tally>();
  private prunedAt = 0;
  /** Over the size cap: pruning goes on until the rows take three quarters of it. */
  private over = false;

  constructor(o: LogSinkOptions = {}) {
    const own = !o.db;
    this.db = o.db ?? new DatabaseSync(o.path ?? ":memory:");
    this.batchMs = o.batchMs ?? 250;
    this.now = o.now ?? Date.now;
    this.secrets = o.secrets ?? (() => []);
    this.keepMs = o.keepMs ?? LOG_KEEP_MS;
    this.maxBytes = o.maxBytes ?? LOG_MAX_BYTES;
    this.rollupMs = o.rollupMs ?? ROLLUP_MS;
    try { this.sourceId = this.open(o.path !== undefined && o.path !== ":memory:"); }
    catch (e) { if (own) try { this.db.close(); } catch { /* already closed */ } throw e; }
  }

  /**
   * Open a logs.db file. When it cannot be opened, `aside` runs (to move the file and its journals away) before the failed handle is closed, because closing removes the -wal and -shm beside
   * the path: that would lose them, or, with a fresh file already there, hit its journals. Then the error is thrown.
   */
  static openFile(o: LogSinkOptions & { path: string }, aside: () => void): LogSink {
    const db = new DatabaseSync(o.path);
    try { return new LogSink({ ...o, db }); }
    catch (e) {
      try { aside(); } catch { /* the caller sees the files where they are */ }
      try { db.close(); } catch { /* already closed */ }
      throw e;
    }
  }

  /**
   * A file is made with incremental vacuum, so pruning gives the space back, and kept in WAL with synchronous NORMAL: a crash or a forced restart loses at most the last batch, never the file.
   * A file made before that is pruned to the caps and vacuumed once, which is when SQLite takes the new vacuum mode. Then the caps are applied in full.
   */
  private open(file: boolean): string {
    if (file) {
      this.db.exec("PRAGMA auto_vacuum = INCREMENTAL");
      this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA journal_size_limit = 4194304; PRAGMA busy_timeout = 2000");
    }
    this.db.exec(LOGS_SCHEMA);
    const columns = this.db.prepare('PRAGMA table_info(log_source)').all();
    if (!columns.some(column => column['name'] === 'row_seq')) this.db.exec('ALTER TABLE log_source ADD COLUMN row_seq INTEGER NOT NULL DEFAULT 0');
    if (!columns.some(column => column['name'] === 'span_seq')) this.db.exec('ALTER TABLE log_source ADD COLUMN span_seq INTEGER NOT NULL DEFAULT 0');
    const sourceId = String(this.db.prepare('SELECT id FROM log_source LIMIT 1').get()?.id ?? globalThis.crypto.randomUUID());
    this.db.prepare('INSERT OR IGNORE INTO log_source (id) VALUES (?)').run(sourceId);
    this.db.prepare('UPDATE log_source SET row_seq = MAX(row_seq, (SELECT COALESCE(MAX(id), 0) FROM logs)), span_seq = MAX(span_seq, (SELECT COALESCE(MAX(rowid), 0) FROM spans)) WHERE id = ?').run(sourceId);
    if (file && Number(this.db.prepare("PRAGMA auto_vacuum").get()?.["auto_vacuum"]) !== 2) {
      while (this.pruneRound()) { /* a file from before the caps: down to them first, so the one full vacuum is small */ }
      this.db.exec("PRAGMA auto_vacuum = INCREMENTAL");
      this.db.exec("VACUUM");
    }
    this.prune(Infinity);
    return sourceId;
  }

  /** Bytes the rows take, and bytes the file holds free. */
  private pages(): { used: number; free: number } {
    const size = Number(this.db.prepare("PRAGMA page_size").get()?.["page_size"]);
    const count = Number(this.db.prepare("PRAGMA page_count").get()?.["page_count"]);
    const free = Number(this.db.prepare("PRAGMA freelist_count").get()?.["freelist_count"]);
    return { used: (count - free) * size, free: free * size };
  }

  /**
   * One small transaction: rows older than the age cap go, oldest first; when none are that old and the rows take more than the size cap, the oldest batch goes anyway, until they take three
   * quarters of it (so a full file is not pruned on every flush). Ids only grow, so the first row young enough to keep bounds the scan. Tombstones and the source row are never pruned, and the
   * row and span sequences live in log_source, so a pruned id is never handed out again and the telemetry observer's position stays good.
   */
  private pruneRound(): number {
    const cutoff = this.now() - this.keepMs;
    let removed = 0;
    this.db.exec("BEGIN");
    try {
      const del = (table: "logs" | "spans", key: "id" | "rowid", below: number | null, limit = PRUNE_BATCH): number => {
        if (below === null) return 0;
        return Number(this.db.prepare(`DELETE FROM ${table} WHERE ${key} IN (SELECT ${key} FROM ${table} WHERE ${key} < ? ORDER BY ${key} LIMIT ?)`).run(below, limit).changes);
      };
      const edge = (table: "logs" | "spans", key: "id" | "rowid"): number | null => {
        const kept = this.db.prepare(`SELECT ${key} AS k FROM ${table} WHERE at >= ? ORDER BY ${key} LIMIT 1`).get(cutoff)?.["k"];
        if (kept !== undefined) return Number(kept);
        const last = this.db.prepare(`SELECT MAX(${key}) AS k FROM ${table}`).get()?.["k"];
        return last === null || last === undefined ? null : Number(last) + 1;
      };
      removed += del("logs", "id", edge("logs", "id")) + del("spans", "rowid", edge("spans", "rowid"));
      removed += Number(this.db.prepare("DELETE FROM health_samples WHERE rowid IN (SELECT rowid FROM health_samples WHERE at < ? LIMIT ?)").run(cutoff, PRUNE_BATCH).changes);
      if (!removed && this.pages().used > this.maxBytes) this.over = true;
      if (!removed && this.over) {
        // whichever of logs and spans holds the older first row gives up a batch, so what is left covers the same stretch of time in both
        const head = (table: "logs" | "spans", key: "id" | "rowid"): number => Number(this.db.prepare(`SELECT at FROM ${table} ORDER BY ${key} LIMIT 1`).get()?.["at"] ?? Infinity);
        // a batch sized to the excess (ids run nearly unbroken, so their span counts the rows), so a small cap is not overshot
        const batch = (table: "logs" | "spans", key: "id" | "rowid"): number => {
          const r = this.db.prepare(`SELECT MIN(${key}) AS lo, MAX(${key}) AS hi FROM ${table}`).get();
          const rows = Number(r?.["hi"] ?? 0) - Number(r?.["lo"] ?? 0) + 1, used = this.pages().used;
          return Math.max(1, Math.min(PRUNE_BATCH, Math.ceil(rows * (used - this.maxBytes * 0.75) / used / 4)));
        };
        removed += head("logs", "id") <= head("spans", "rowid") ? del("logs", "id", Number.MAX_SAFE_INTEGER, batch("logs", "id")) : del("spans", "rowid", Number.MAX_SAFE_INTEGER, batch("spans", "rowid"));
        if (!removed || this.pages().used <= this.maxBytes * 0.75) this.over = false;
      }
      this.db.exec("COMMIT");
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
    return removed;
  }

  /** Apply the caps: up to `rounds` small transactions, then give the free pages back to the disk once they add up. Runs at open, and from a flush once a minute. */
  prune(rounds = PRUNE_ROUNDS): number {
    this.prunedAt = this.now();
    let removed = 0;
    for (let round = 0; round < rounds; round++) {
      const n = this.pruneRound();
      removed += n;
      if (!n) break;
    }
    if (this.pages().free >= Math.min(this.maxBytes / 16, 4 * 1024 * 1024)) this.db.exec("PRAGMA incremental_vacuum");
    return removed;
  }

  /** Attach the internal metadata writer after module initialization. */
  setObserver(observer: ((batch: TelemetryBatch) => void) | undefined, position: TelemetryPosition = { rowId: 0, spanId: 0 }): void { this.db.prepare('UPDATE log_source SET row_seq = MAX(row_seq, ?), span_seq = MAX(span_seq, ?) WHERE id = ?').run(position.rowId, position.spanId, this.sourceId); this.observer = observer; this.observed = position; if (observer) this.schedule(); }

  private observe(): boolean {
    if (!this.observer) return false;
    const rawRows = this.db.prepare(`SELECT id,at,level,space,${COLS.join(',')},CASE WHEN length(msg) <= 80 THEN msg ELSE 'log.redacted' END AS msg,CASE WHEN length(CAST(attrs AS BLOB)) <= 8192 THEN attrs ELSE NULL END AS attrs FROM logs WHERE id > ? ORDER BY id LIMIT 1000`).all(this.observed.rowId) as Record<string, unknown>[];
    const rawSpans = this.db.prepare('SELECT rowid AS source_id,trace_id,span_id,parent,substr(name,1,121) AS name,at,dur_us,CASE WHEN length(CAST(attrs AS BLOB)) <= 8192 THEN attrs ELSE NULL END AS attrs FROM spans WHERE rowid > ? ORDER BY rowid LIMIT 1000').all(this.observed.spanId) as Record<string, unknown>[];
    if (!rawRows.length && !rawSpans.length) return false;
    const position = { rowId: Number(rawRows.at(-1)?.['id'] ?? this.observed.rowId), spanId: Number(rawSpans.at(-1)?.['source_id'] ?? this.observed.spanId) };
    const attrs = (value: unknown): Record<string, unknown> | null => typeof value === 'string' ? JSON.parse(value) as Record<string, unknown> : null;
    const rows = rawRows.map(row => ({ ...row, attrs: attrs(row['attrs']) ?? undefined })) as unknown as TelemetryBatch['rows'];
    const spans = rawSpans.map(row => ({ ...row, attrs: attrs(row['attrs']) })) as unknown as TelemetryBatch['spans'];
    this.observer({ source: this.sourceId, position, rows, spans });
    this.observed = position;
    return rawRows.length === 1000 || rawSpans.length === 1000;
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
    if (this.closed) return;
    this.rows.push({ at: this.now(), row });
    this.schedule();
  }
  span(row: SpanRow): void {
    if (this.closed) return;
    this.spans.push(row);
    this.schedule();
  }

  /**
   * A routine success (a poll that ran, a read that answered fast): not a row of its own. It is counted under `key`, and the window ends in one row, `row` with attrs.count (how many), attrs.ms
   * (their total time) and dur_ms (the slowest). With `keepFirst` the first one of each window is not counted and true comes back, so the caller stores that one in full and a trace of it can
   * still be found. Failures, slow runs and changes of state are not routine: log() them.
   */
  count(key: string, row: LogRow, ms: number, o: { keepFirst?: boolean } = {}): boolean {
    if (this.closed) return false;
    const at = this.now();
    if (this.rollDue(at)) this.schedule();
    const t = this.tallies.get(key);
    if (!t) {
      this.tallies.set(key, { row, since: at, count: o.keepFirst ? 0 : 1, ms: o.keepFirst ? 0 : ms, max: o.keepFirst ? 0 : ms });
      return o.keepFirst === true;
    }
    t.count++; t.ms += ms; t.max = Math.max(t.max, ms);
    return false;
  }

  /** Windows that have run their time (all of them at close) become their one row each; true when that queued a row. */
  private rollDue(at: number, all = false): boolean {
    let wrote = false;
    for (const [key, t] of this.tallies) {
      if (!all && at - t.since < this.rollupMs) continue;
      this.tallies.delete(key);
      if (!t.count) continue;
      this.rows.push({ at, row: { ...t.row, dur_ms: t.max, attrs: { ...t.row.attrs, count: t.count, ms: Math.round(t.ms) } } });
      wrote = true;
    }
    return wrote;
  }
  private schedule(): void {
    if (this.batchMs <= 0) { this.flush(); return; }
    if (!this.timer) { this.timer = setTimeout(() => { try { this.flush(); } catch { this.schedule(); } }, this.batchMs); this.timer.unref(); }
  }

  /** At most 1,000 rows/spans per transaction; native persistence remains the recovery source after observer failure. */
  flush(): void {
    if (this.closed) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.rollDue(this.now());
    if (!this.rows.length && !this.spans.length) { if (this.observe()) this.schedule(); return; }
    const rows = this.rows.splice(0, 1000), spans = this.spans.splice(0, 1000);
    const insLog = this.db.prepare(`INSERT INTO logs (id, at, level, space, ${COLS.join(", ")}, msg, attrs) VALUES (?, ?, ?, ?, ${COLS.map(() => "?").join(", ")}, ?, ?)`);
    const insSpan = this.db.prepare("INSERT INTO spans (rowid, trace_id, span_id, parent, name, at, dur_us, attrs) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    this.db.exec("BEGIN");
    try {
      const sequence = this.db.prepare('SELECT row_seq, span_seq FROM log_source WHERE id = ?').get(this.sourceId)!;
      let rowSeq = Number(sequence['row_seq']), spanSeq = Number(sequence['span_seq']);
      for (const { at, row } of rows) {
        const attrs = row.attrs ? JSON.stringify(this.redact(row.attrs)) : null;
        insLog.run(++rowSeq, at, row.level, row.space, ...COLS.map((c) => row[c] ?? null), row.msg, attrs);
      }
      for (const s of spans) insSpan.run(++spanSeq, s.trace_id, s.span_id, s.parent, s.name, s.at, s.dur_us, s.attrs ? JSON.stringify(this.redact(s.attrs)) : null);
      this.db.prepare('UPDATE log_source SET row_seq = ?, span_seq = ? WHERE id = ?').run(rowSeq, spanSeq, this.sourceId);
      this.db.exec("COMMIT");
    } catch (e) { this.db.exec("ROLLBACK"); this.rows.unshift(...rows); this.spans.unshift(...spans); throw e; }
    if (this.now() - this.prunedAt >= PRUNE_EVERY_MS) {
      try { this.prune(); } catch (e) { this.rows.push({ at: this.now(), row: { space: "-", level: LEVELS.error, msg: "logs.prune_failed", place: "logsink", attrs: { error: e instanceof Error ? e.message : String(e) } } }); }
    }
    const more = this.observe();
    if (this.rows.length || this.spans.length || more) this.schedule();
  }

  /** Native persistence is finite; a failed observer stays recoverable in logs.db. */
  drain(): void { while (this.rows.length || this.spans.length) this.flush(); while (this.observer && this.observe()) { /* bounded batches until the finite source is drained */ } }


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

  /** Drain all accepted records before closure; shutdown callbacks may append later. */
  close(): void {
    if (this.closed) return;
    this.observer = undefined;
    this.rollDue(this.now(), true);
    this.drain();
    this.closed = true;
    this.db.close();
  }
}

/** One finished scheduler job, as the scheduler's onRun reports it. */
export interface JobRun { job: string; ok: boolean; ms: number; error?: string | undefined }

/**
 * What a scheduler run leaves in logs.db. A job's first run, a recovery, a new failure and a slow run are rows of their own; a routine success and a failure that repeats the last one are
 * counted, one rolled-up `job.ran` row per job per window. Polls that run every second used to write a row each.
 */
export function jobRanLog(sink: LogSink, space: () => string): (r: JobRun) => void {
  const last = new Map<string, { ok: boolean; error: string | undefined }>();
  return (r) => {
    const was = last.get(r.job);
    last.set(r.job, { ok: r.ok, error: r.error });
    const row = { space: space(), msg: "job.ran", place: "scheduler", entity: "job", entity_id: r.job };
    if (r.ok) {
      if (was?.ok === true && r.ms < SLOW_MS) { sink.count(`job:${r.job}:ok`, { ...row, level: LEVELS.debug, result: "ok" }, r.ms); return; }
      sink.log({ ...row, level: was === undefined && r.ms < SLOW_MS ? LEVELS.debug : LEVELS.info, dur_ms: r.ms, result: "ok", ...(r.ms >= SLOW_MS ? { attrs: { slow: true } } : {}) });
      return;
    }
    if (was && !was.ok && was.error === r.error) { sink.count(`job:${r.job}:error`, { ...row, level: LEVELS.error, result: "error", ...(r.error ? { attrs: { error: r.error } } : {}) }, r.ms); return; }
    sink.log({ ...row, level: LEVELS.error, dur_ms: r.ms, result: "error", ...(r.error ? { attrs: { error: r.error } } : {}) });
  };
}

/** One finished invoke, as the pipeline reports it (host/src/invoke.ts SpanRecord). */
export interface InvokeSpan {
  traceId: string; spanId: string; parent?: string | undefined; name: string; cap: string; startedAt: number; ms: number; status: "ok" | "held" | "denied" | "error"; code?: string | undefined;
  principal?: string | undefined;
}

/**
 * Invoke spans into logs.db. A fast success of a routine capability (a read, the host's own periodic work) is counted: the first per capability and principal in each window is kept, so the
 * trace of a call someone just made still opens, and the rest leave one `invoke.reads` row per window. Writes, failures, refusals, holds and slow calls are always kept.
 */
export function invokeSpanLog(sink: LogSink, space: () => string, routine: (cap: string) => boolean): (s: InvokeSpan) => void {
  return (s) => {
    const row: SpanRow = { trace_id: s.traceId, span_id: s.spanId, parent: s.parent ?? null, name: s.name, at: s.startedAt, dur_us: s.ms * 1000, attrs: { cap: s.cap, status: s.status } };
    if (s.status !== "ok" || s.ms >= SLOW_MS || !routine(s.cap)) { sink.span(row); return; }
    const first = sink.count(`invoke:${s.cap}:${s.principal ?? ""}`, { space: space(), level: LEVELS.debug, msg: "invoke.reads", place: "invoke", cap: s.cap, actor: s.principal, result: "ok" }, s.ms, { keepFirst: true });
    if (first) sink.span(row);
  };
}
