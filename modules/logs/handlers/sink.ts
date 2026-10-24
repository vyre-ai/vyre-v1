// logs sink: structured rows into logs_* (migrations/0001_init.sql). Attrs keep ids and counts. Sealed blobs and Restricted values are dropped before insert.
import type { ScopedDb } from "../../../packages/contracts/src/ctx.ts";

export const DAY_MS = 86_400_000;
export const DEFAULT_FULL_DAYS = 30;
export const DEFAULT_AGG_DAYS = 180;

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type LevelName = keyof typeof LEVELS;

/** Keys the log lint forbids. Matched exactly, any case. */
const CONTENT_KEYS = new Set(["body", "text", "subject", "value", "secret", "password", "token", "content", "message"]);

type Cell = string | number | null;
type Row = Record<string, Cell>;

const REPLACE_KEYS: Record<string, string[]> = {
  logs_tombstone: ["space", "actor"],
  logs_setting: ["space"],
  logs_agg: ["day", "space", "cap", "result"],
  logs_replay: ["id"],
  logs_stream: ["id"],
  logs_export: ["id"],
};

const AUTO_ID = new Set(["logs_row", "logs_span", "logs_event"]);

interface Mem {
  tables: Map<string, Row[]>;
  seq: Map<string, number>;
}

function blank(): Mem {
  return { tables: new Map(), seq: new Map() };
}

function take(args: unknown[]): unknown {
  if (args.length === 0) throw new Error("sql args short");
  return args.shift();
}

function splitAnd(expr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i] ?? "";
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (depth === 0 && expr.startsWith(" AND ", i)) {
      parts.push(cur);
      cur = "";
      i += 4;
      continue;
    }
    cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

function cellEq(left: Cell | undefined, right: unknown): boolean {
  if (left === undefined) return right === null;
  return left === right;
}

function term(expr: string, row: Row, args: unknown[]): boolean {
  const or = expr.match(/^\(([a-z_]+) = \? OR ([a-z_]+) = \?\)$/i);
  if (or) {
    const colA = or[1] ?? "";
    const colB = or[2] ?? "";
    const a = take(args);
    const b = take(args);
    return cellEq(row[colA], a) || cellEq(row[colB], b);
  }
  const m = expr.match(/^([a-z_]+) (>=|<=|>|<|=) \?$/);
  if (!m) throw new Error(`bad sql term: ${expr}`);
  const col = m[1] ?? "";
  const op = m[2] ?? "=";
  const left = row[col];
  const right = take(args);
  if (op === "=") return cellEq(left, right);
  if (typeof left === "number" && typeof right === "number") {
    if (op === ">=") return left >= right;
    if (op === "<=") return left <= right;
    if (op === ">") return left > right;
    if (op === "<") return left < right;
  }
  return false;
}

function matches(expr: string, row: Row, args: unknown[]): boolean {
  // Every term must run so a failed comparison still consumes its placeholders.
  let ok = true;
  for (const part of splitAnd(expr)) if (!term(part, row, args)) ok = false;
  return ok;
}

function sortRows(rows: Row[], order: string): Row[] {
  const keys = order.split(",").map((p) => {
    const bits = p.trim().split(/\s+/);
    return { col: bits[0] ?? "id", desc: (bits[1] ?? "ASC").toUpperCase() === "DESC" };
  });
  return rows.slice().sort((a, b) => {
    for (const k of keys) {
      const av = a[k.col];
      const bv = b[k.col];
      if (av === bv) continue;
      if (av == null) return 1;
      if (bv == null) return -1;
      const c = av < bv ? -1 : 1;
      return k.desc ? -c : c;
    }
    return 0;
  });
}

function project(row: Row, cols: string): Row {
  if (cols.trim() === "*") return { ...row };
  const out: Row = {};
  for (const raw of cols.split(",")) {
    const name = raw.trim();
    const v = row[name];
    out[name] = v === undefined ? null : v;
  }
  return out;
}

function sameKey(table: string, a: Row, b: Row): boolean {
  const keys = REPLACE_KEYS[table];
  if (!keys) return false;
  return keys.every((k) => a[k] === b[k]);
}

function parseSelect(sql: string): { cols: string; table: string; where?: string; order?: string; limit?: string } | null {
  const m = sql.match(/^SELECT (.+) FROM ([a-z_]+)\s*(.*)$/i);
  if (!m) return null;
  let rest = (m[3] ?? "").trim();
  const out: { cols: string; table: string; where?: string; order?: string; limit?: string } = {
    cols: (m[1] ?? "*").trim(),
    table: m[2] ?? "",
  };
  const lim = rest.match(/^(.*) LIMIT (\?|\d+)$/i);
  if (lim) {
    rest = (lim[1] ?? "").trim();
    if (lim[2]) out.limit = lim[2];
  }
  const ord = rest.match(/^(.*) ORDER BY (.+)$/i);
  if (ord) {
    rest = (ord[1] ?? "").trim();
    const order = (ord[2] ?? "").trim();
    if (order) out.order = order;
  }
  if (rest.length === 0) return out;
  if (!/^WHERE /i.test(rest)) return null;
  out.where = rest.slice(6).trim();
  return out;
}

function exec(mem: Mem, raw: string, argsIn: unknown[]): { rows: Row[]; changes: number } {
  const sql = raw.replace(/\s+/g, " ").trim();
  const args = argsIn.slice();
  const ins = sql.match(/^INSERT( OR REPLACE)? INTO ([a-z_]+) \(([^)]+)\) VALUES \((.+)\)$/i);
  if (ins) {
    const replace = Boolean(ins[1]);
    const table = ins[2] ?? "";
    const cols = (ins[3] ?? "").split(",").map((s) => s.trim());
    const marks = (ins[4] ?? "").split(",").map((s) => s.trim());
    if (marks.some((m) => m !== "?")) throw new Error(`sql literals are not accepted: ${sql}`);
    if (cols.length !== args.length) throw new Error(`sql arg count: ${sql}`);
    const row: Row = {};
    cols.forEach((c, i) => {
      const v = args[i];
      row[c] = v === undefined || v === null ? null : typeof v === "number" || typeof v === "string" ? v : String(v);
    });
    if (AUTO_ID.has(table) && row.id == null) {
      const n = (mem.seq.get(table) ?? 0) + 1;
      mem.seq.set(table, n);
      row.id = n;
    }
    const list = mem.tables.get(table) ?? [];
    mem.tables.set(table, list);
    if (replace) {
      const at = list.findIndex((old) => sameKey(table, old, row));
      if (at >= 0) {
        const prev = list[at];
        if (prev && row.id == null && prev.id != null) row.id = prev.id;
        list[at] = row;
        return { rows: [], changes: 1 };
      }
    }
    list.push(row);
    return { rows: [], changes: 1 };
  }
  const del = sql.match(/^DELETE FROM ([a-z_]+)(?: WHERE (.+))?$/i);
  if (del) {
    const table = del[1] ?? "";
    const list = mem.tables.get(table) ?? [];
    const where = del[2];
    const keep: Row[] = [];
    let changes = 0;
    for (const row of list) {
      const local = args.slice();
      const hit = where ? matches(where, row, local) : true;
      if (hit) changes++;
      else keep.push(row);
    }
    if (where) matches(where, {}, args);
    mem.tables.set(table, keep);
    return { rows: [], changes };
  }
  const sel = parseSelect(sql);
  if (sel) {
    const cols = sel.cols;
    const table = sel.table;
    const where = sel.where;
    const order = sel.order;
    const limitRaw = sel.limit;
    const list = mem.tables.get(table) ?? [];
    let rows = list.filter((row) => {
      if (!where) return true;
      const local = args.slice();
      return matches(where, row, local);
    });
    if (where) matches(where, {}, args);
    if (order) rows = sortRows(rows, order);
    if (/^COUNT\(\*\)/i.test(cols.trim())) {
      return { rows: [{ n: rows.length }], changes: 0 };
    }
    if (limitRaw) {
      const n = limitRaw === "?" ? Number(take(args)) : Number(limitRaw);
      rows = rows.slice(0, n);
    }
    if (args.length) throw new Error(`sql args left: ${sql}`);
    return { rows: rows.map((r) => project(r, cols)), changes: 0 };
  }
  throw new Error(`sql not supported: ${sql}`);
}

/** In-memory db with the same statement shape ctx.db runs against SQLite. */
export function memoryDb(): ScopedDb {
  const mem = blank();
  return {
    all(sql: string, ...args: unknown[]): unknown[] {
      return exec(mem, sql, args).rows;
    },
    run(sql: string, ...args: unknown[]): { changes: number } {
      return { changes: exec(mem, sql, args).changes };
    },
  };
}

function isSecret(s: string, secrets: readonly string[]): boolean {
  for (const x of secrets) if (x.length > 0 && s === x) return true;
  return false;
}

function isSealed(o: Record<string, unknown>): boolean {
  return typeof o.keyId === "string" && typeof o.nonce === "string" && typeof o.bytes === "string";
}

function isRestricted(o: Record<string, unknown>): boolean {
  if (o.label === "restricted" || o.label === 3) return true;
  if (o.restricted === true) return true;
  return false;
}

/** Drop content keys, sealed blobs, Restricted values, and strings equal to a known secret. */
export function redact(v: unknown, secrets: readonly string[]): unknown {
  if (typeof v === "string") return isSecret(v, secrets) ? "[redacted]" : v;
  if (typeof v === "number" || typeof v === "boolean" || v === null) return v;
  if (Array.isArray(v)) return v.map((x) => redact(x, secrets));
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (isSealed(o)) return { redacted: "sealed" };
    if (isRestricted(o)) return { label: "restricted" };
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) {
      if (CONTENT_KEYS.has(k.toLowerCase())) continue;
      out[k] = redact(o[k], secrets);
    }
    return out;
  }
  return null;
}

export function msgKey(msg: string, secrets: readonly string[]): string {
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(msg)) return "log.msg";
  if (isSecret(msg, secrets)) return "log.msg";
  return msg;
}

export function levelNum(v: unknown): number {
  if (v === "debug" || v === "info" || v === "warn" || v === "error") return LEVELS[v];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return LEVELS.info;
}

const LOG_COLS = [
  "at", "level", "trace_id", "span_id", "space", "actor", "on_behalf", "run_id", "thread_id", "device", "place", "cap", "entity", "entity_id",
  "result", "dur_ms", "cost_micros", "tokens_in", "tokens_out", "label", "app_version", "server_version", "machine", "msg", "attrs",
] as const;

function insertSql(table: string, cols: readonly string[], replace = false): string {
  const head = replace ? "INSERT OR REPLACE" : "INSERT";
  return `${head} INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
}

function cell(v: string | number | null | undefined): string | number | null {
  return v === undefined ? null : v;
}

export interface LogWrite {
  at: number;
  level?: unknown;
  traceId?: string;
  spanId?: string;
  actor?: string;
  onBehalf?: string;
  runId?: string;
  threadId?: string;
  device?: string;
  place?: string;
  cap?: string;
  entity?: string;
  entityId?: string;
  result?: string;
  durMs?: number;
  costMicros?: number;
  tokensIn?: number;
  tokensOut?: number;
  label?: number;
  appVersion?: string;
  serverVersion?: string;
  machine?: string;
  msg: string;
  attrs?: Record<string, unknown>;
}

export function writeLog(db: ScopedDb, space: string, row: LogWrite, secrets: readonly string[]): void {
  const attrs = row.attrs ? JSON.stringify(redact(row.attrs, secrets)) : null;
  const vals: (string | number | null)[] = [
    row.at, levelNum(row.level), cell(row.traceId), cell(row.spanId), space, cell(row.actor), cell(row.onBehalf), cell(row.runId), cell(row.threadId),
    cell(row.device), cell(row.place), cell(row.cap), cell(row.entity), cell(row.entityId), cell(row.result),
    row.durMs === undefined ? null : row.durMs, row.costMicros === undefined ? null : Math.round(row.costMicros),
    row.tokensIn === undefined ? null : row.tokensIn, row.tokensOut === undefined ? null : row.tokensOut,
    row.label === undefined ? null : row.label, cell(row.appVersion), cell(row.serverVersion), cell(row.machine),
    msgKey(row.msg, secrets), attrs,
  ];
  db.run(insertSql("logs_row", LOG_COLS), ...vals);
}

export interface SpanWrite {
  traceId: string;
  spanId: string;
  parent?: string | null;
  name: string;
  at: number;
  durUs: number;
  attrs?: Record<string, unknown>;
}

export function writeSpan(db: ScopedDb, space: string, row: SpanWrite, secrets: readonly string[]): void {
  const attrs = row.attrs ? JSON.stringify(redact(row.attrs, secrets)) : null;
  db.run(
    "INSERT INTO logs_span (space, trace_id, span_id, parent, name, at, dur_us, attrs) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    space, row.traceId, row.spanId, row.parent ?? null, msgKey(row.name, secrets), row.at, Math.round(row.durUs), attrs,
  );
}

export interface EventWrite {
  traceId: string;
  seq: number;
  type: string;
  at: number;
  actor: string;
  entity?: string;
}

export function writeEvent(db: ScopedDb, space: string, row: EventWrite, secrets: readonly string[]): void {
  db.run(
    "INSERT INTO logs_event (space, trace_id, seq, type, at, actor, entity) VALUES (?, ?, ?, ?, ?, ?, ?)",
    space, row.traceId, row.seq, msgKey(row.type, secrets), row.at, row.actor, row.entity ?? null,
  );
}

export function eraseActor(db: ScopedDb, space: string, actor: string, at: number): void {
  db.run("INSERT OR REPLACE INTO logs_tombstone (space, actor, at) VALUES (?, ?, ?)", space, actor, at);
}

export interface Settings {
  level: LevelName;
  fullDays: number;
  aggregateDays: number;
}

function levelName(v: unknown): LevelName {
  if (v === "debug" || v === "info" || v === "warn" || v === "error") return v;
  return "info";
}

export function readSettings(db: ScopedDb, space: string): Settings {
  const rows = db.all("SELECT level, full_days, aggregate_days FROM logs_setting WHERE space = ?", space);
  const row = rows[0];
  if (!row || typeof row !== "object") return { level: "info", fullDays: DEFAULT_FULL_DAYS, aggregateDays: DEFAULT_AGG_DAYS };
  const r = row as Record<string, unknown>;
  const full = typeof r.full_days === "number" ? r.full_days : DEFAULT_FULL_DAYS;
  const agg = typeof r.aggregate_days === "number" ? r.aggregate_days : DEFAULT_AGG_DAYS;
  return { level: levelName(r.level), fullDays: full, aggregateDays: agg };
}

export function writeSettings(db: ScopedDb, space: string, s: Settings): void {
  db.run(
    "INSERT OR REPLACE INTO logs_setting (space, level, full_days, aggregate_days) VALUES (?, ?, ?, ?)",
    space, s.level, s.fullDays, s.aggregateDays,
  );
}

function numOf(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function strOf(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Roll rows older than fullDays into daily aggregates, then drop aggregates older than aggregateDays. */
export function prune(db: ScopedDb, space: string, now: number): void {
  const s = readSettings(db, space);
  const fullCut = now - s.fullDays * DAY_MS;
  const aggCut = now - s.aggregateDays * DAY_MS;
  const old = db.all("SELECT at, cap, result, dur_ms, cost_micros FROM logs_row WHERE space = ? AND at < ?", space, fullCut);
  const groups = new Map<string, { day: number; cap: string; result: string; n: number; dur: number; cost: number }>();
  for (const item of old) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const at = numOf(r.at);
    const day = Math.floor(at / DAY_MS) * DAY_MS;
    const cap = strOf(r.cap);
    const result = strOf(r.result);
    const key = `${day}|${cap}|${result}`;
    const g = groups.get(key) ?? { day, cap, result, n: 0, dur: 0, cost: 0 };
    g.n += 1;
    g.dur += numOf(r.dur_ms);
    g.cost += numOf(r.cost_micros);
    groups.set(key, g);
  }
  const have = db.all("SELECT day, cap, result, n, dur_ms, cost_micros FROM logs_agg WHERE space = ?", space);
  for (const item of have) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const day = numOf(r.day);
    const cap = strOf(r.cap);
    const result = strOf(r.result);
    const key = `${day}|${cap}|${result}`;
    const g = groups.get(key);
    if (!g) continue;
    g.n += numOf(r.n);
    g.dur += numOf(r.dur_ms);
    g.cost += numOf(r.cost_micros);
  }
  for (const g of groups.values()) {
    db.run(
      "INSERT OR REPLACE INTO logs_agg (day, space, cap, result, n, dur_ms, cost_micros) VALUES (?, ?, ?, ?, ?, ?, ?)",
      g.day, space, g.cap, g.result, g.n, g.dur, Math.round(g.cost),
    );
  }
  db.run("DELETE FROM logs_row WHERE space = ? AND at < ?", space, fullCut);
  db.run("DELETE FROM logs_span WHERE space = ? AND at < ?", space, fullCut);
  db.run("DELETE FROM logs_event WHERE space = ? AND at < ?", space, fullCut);
  db.run("DELETE FROM logs_agg WHERE space = ? AND day < ?", space, aggCut);
}

export interface JsonLine {
  when?: number;
  at?: number;
  level?: LevelName;
  traceId?: string;
  actor?: string;
  onBehalf?: string;
  capability?: string;
  cap?: string;
  record?: string;
  entity?: string;
  result?: string;
  duration?: number;
  durMs?: number;
  cost?: number;
  costMicros?: number;
  msg?: string;
  attrs?: Record<string, unknown>;
  place?: string;
  runId?: string;
  spanId?: string;
  label?: number;
  device?: string;
  appVersion?: string;
  serverVersion?: string;
  machine?: string;
  threadId?: string;
}

type Job =
  | { kind: "log"; row: LogWrite }
  | { kind: "span"; row: SpanWrite }
  | { kind: "event"; row: EventWrite };

export interface JsonSink {
  line(text: string): void;
  span(row: SpanWrite): void;
  event(row: EventWrite): void;
  flush(): void;
}

function fromLine(text: string, now: number): LogWrite {
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("log line must be a JSON object");
  const line = parsed as JsonLine;
  const entityId = line.record;
  const entity = line.entity ?? (entityId ? "record" : undefined);
  const dur = line.duration ?? line.durMs;
  const cost = line.costMicros ?? line.cost;
  const row: LogWrite = {
    at: line.when ?? line.at ?? now,
    msg: line.msg ?? "log.line",
  };
  if (line.level) row.level = line.level;
  if (line.traceId) row.traceId = line.traceId;
  if (line.spanId) row.spanId = line.spanId;
  if (line.actor) row.actor = line.actor;
  if (line.onBehalf) row.onBehalf = line.onBehalf;
  const cap = line.capability ?? line.cap;
  if (cap) row.cap = cap;
  if (entity) row.entity = entity;
  if (entityId) row.entityId = entityId;
  if (line.result) row.result = line.result;
  if (dur !== undefined) row.durMs = dur;
  if (cost !== undefined) row.costMicros = cost;
  if (line.place) row.place = line.place;
  if (line.runId) row.runId = line.runId;
  if (line.label !== undefined) row.label = line.label;
  if (line.device) row.device = line.device;
  if (line.appVersion) row.appVersion = line.appVersion;
  if (line.serverVersion) row.serverVersion = line.serverVersion;
  if (line.machine) row.machine = line.machine;
  if (line.threadId) row.threadId = line.threadId;
  if (line.attrs) row.attrs = line.attrs;
  return row;
}

/** Queue structured JSON lines and batch-insert them. batchMs 0 writes at once (tests). Default window is 250 ms. */
export function createJsonSink(db: ScopedDb, space: string, o: { batchMs?: number; now?: () => number; secrets?: () => readonly string[] } = {}): JsonSink {
  const batchMs = o.batchMs ?? 250;
  const now = o.now ?? Date.now;
  const secrets = o.secrets ?? (() => []);
  let jobs: Job[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const batch = jobs;
    jobs = [];
    const known = secrets();
    for (const job of batch) {
      if (job.kind === "log") writeLog(db, space, job.row, known);
      else if (job.kind === "span") writeSpan(db, space, job.row, known);
      else writeEvent(db, space, job.row, known);
    }
  };
  const schedule = (): void => {
    if (batchMs <= 0) {
      flush();
      return;
    }
    if (!timer) {
      const handle = setTimeout(() => flush(), batchMs);
      handle.unref();
      timer = handle;
    }
  };
  return {
    line(text: string): void {
      jobs.push({ kind: "log", row: fromLine(text, now()) });
      schedule();
    },
    span(row: SpanWrite): void {
      jobs.push({ kind: "span", row });
      schedule();
    },
    event(row: EventWrite): void {
      jobs.push({ kind: "event", row });
      schedule();
    },
    flush,
  };
}
