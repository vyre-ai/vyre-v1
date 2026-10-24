// Log sink (ARCH 4.10, 4.11, spec 4.18). Structured rows batch into logs.db.
// msg is a template key. attrs keep ids and counts. Sealed values, Restricted
// values, content keys and known secrets never reach a stored row.

export const DAY_MS = 86_400_000;
export const DEFAULT_FULL_DAYS = 30;
export const DEFAULT_AGGREGATE_DAYS = 180;
export const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type LevelName = keyof typeof LEVELS;

/** Keys the log lint forbids. Matched without regard to case. */
export const CONTENT_KEYS: readonly string[] = Object.freeze([
  "body", "text", "subject", "value", "secret", "password", "token", "content", "message",
]);
const CONTENT_RE = new RegExp(`^(${CONTENT_KEYS.join("|")})$`, "i");
const MSG_KEY = /^[a-z][a-z0-9_.]*$/;
const DROP = Symbol("drop");

export interface SqlDb {
  all(sql: string, ...args: unknown[]): unknown[];
  run(sql: string, ...args: unknown[]): { changes: number };
}

export interface LogInput {
  at?: number;
  level?: number | LevelName;
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
  label?: number | "public" | "internal" | "confidential" | "restricted";
  appVersion?: string;
  serverVersion?: string;
  machine?: string;
  msg?: string;
  attrs?: Record<string, unknown>;
}

export interface StoredRow {
  id: number;
  at: number;
  level: number;
  space: string;
  msg: string;
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
  attrs?: Record<string, unknown>;
}

export interface SpanInput {
  traceId: string;
  spanId: string;
  parent?: string;
  name: string;
  at?: number;
  durUs?: number;
  attrs?: Record<string, unknown>;
}

export interface StoredSpan {
  space: string;
  traceId: string;
  spanId: string;
  name: string;
  at: number;
  durUs: number;
  parent?: string;
  attrs?: Record<string, unknown>;
}

export interface EventInput {
  traceId: string;
  seq?: number;
  type: string;
  at?: number;
  actor: string;
  entity?: string;
}

export interface StoredEvent {
  space: string;
  traceId: string;
  seq: number;
  type: string;
  at: number;
  actor: string;
  entity?: string;
}

export interface AggregateRow {
  id: number;
  space: string;
  day: number;
  level: number;
  rows: number;
  costMicros: number;
  durMs: number;
  cap?: string;
  result?: string;
}

export interface Settings {
  level: LevelName;
  fullDays: number;
  aggregateDays: number;
}

export interface ReplayRow {
  id: string;
  atSeq: number;
  state: "running" | "done" | "failed";
  recordedOutward: number;
  steps: { name: string; ok: boolean; detail?: string }[];
  at: number;
  runId?: string;
  conflictId?: string;
}

export interface BookOptions {
  space: string;
  now?: () => number;
  secrets?: () => readonly string[];
  /** Batch window. 0 writes at once (tests). Default 250 ms. */
  batchMs?: number;
  db?: SqlDb;
  fullDays?: number;
  aggregateDays?: number;
}

export function levelNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v === "debug" || v === "info" || v === "warn" || v === "error") return LEVELS[v];
  return LEVELS.info;
}

export function levelName(n: number): LevelName {
  if (n >= LEVELS.error) return "error";
  if (n >= LEVELS.warn) return "warn";
  if (n >= LEVELS.info) return "info";
  return "debug";
}

function labelNumber(v: unknown): number | undefined {
  if (v === "public" || v === 0) return 0;
  if (v === "internal" || v === 1) return 1;
  if (v === "confidential" || v === 2) return 2;
  if (v === "restricted" || v === 3) return 3;
  if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 3) return Math.trunc(v);
  return undefined;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** A sealed field value: a seal wrapper, or ciphertext bytes. Never stored. */
export function isSealed(v: unknown): boolean {
  if (!isObj(v)) return false;
  if ("sealed" in v) return true;
  if (typeof v["ciphertext"] === "string") return true;
  if (typeof v["bytes"] === "string" && typeof v["nonce"] === "string") return true;
  return false;
}

/** A Restricted value: label rank 3, or an object marked restricted. */
export function isRestricted(v: unknown): boolean {
  if (!isObj(v)) return false;
  const label = v["label"];
  if (label === "restricted" || label === 3) return true;
  if (v["restricted"] === true) return true;
  return false;
}

function secretHit(v: string, secrets: readonly string[]): boolean {
  for (const s of secrets) if (s && v === s) return true;
  return false;
}

function scrub(v: unknown, secrets: readonly string[]): unknown {
  if (typeof v === "string") return secretHit(v, secrets) ? "[redacted]" : v;
  if (typeof v === "number" || typeof v === "boolean" || v === null) return v;
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    for (const item of v) {
      if (isSealed(item) || isRestricted(item)) continue;
      const y = scrub(item, secrets);
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
      const y = scrub(x, secrets);
      if (y === DROP || y === undefined) continue;
      out[k] = y;
    }
    return out;
  }
  return undefined;
}

export function scrubAttrs(attrs: unknown, secrets: readonly string[], restrictedRow: boolean): Record<string, unknown> | undefined {
  if (restrictedRow || isSealed(attrs) || isRestricted(attrs)) return undefined;
  const y = scrub(attrs, secrets);
  if (!isObj(y)) return undefined;
  return Object.keys(y).length ? y : undefined;
}

function cleanMsg(msg: unknown, secrets: readonly string[]): string {
  if (typeof msg !== "string" || !MSG_KEY.test(msg)) return "log.redacted";
  for (const s of secrets) if (s && msg.includes(s)) return "log.redacted";
  return msg;
}

function cleanStr(v: unknown, secrets: readonly string[]): string | undefined {
  if (typeof v !== "string" || v.length === 0) return undefined;
  if (secretHit(v, secrets)) return undefined;
  return v;
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "bigint") return Number(v);
  return undefined;
}

function int(v: unknown): number | undefined {
  const n = num(v);
  return n === undefined ? undefined : Math.trunc(n);
}

function field(o: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const k of keys) if (o[k] !== undefined) return o[k];
  return undefined;
}

function asObj(v: unknown): Record<string, unknown> | null {
  return isObj(v) ? v : null;
}

const ROW_INSERT = `INSERT OR REPLACE INTO logs_row (
  id, at, level, trace_id, span_id, space, actor, on_behalf, run_id, thread_id, device, place,
  cap, entity, entity_id, result, dur_ms, cost_micros, tokens_in, tokens_out, label,
  app_version, server_version, machine, msg, attrs
) VALUES (${new Array(26).fill("?").join(", ")})`;

export class LogBook {
  readonly space: string;
  private nowFn: () => number;
  private secretsFn: () => readonly string[];
  private batchMs: number;
  private db: SqlDb | undefined;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextId = 1;
  private nextSeq = 1;
  private nextAgg = 1;
  private rows: StoredRow[] = [];
  private spanRows: StoredSpan[] = [];
  private eventRows: StoredEvent[] = [];
  private aggs: AggregateRow[] = [];
  private tombs = new Map<string, number>();
  private holds: { id: string; until?: number }[] = [];
  private replays = new Map<string, ReplayRow>();
  private streams = new Map<string, string>();
  private exports = new Map<string, string>();
  private queuedRows: StoredRow[] = [];
  private queuedSpans: StoredSpan[] = [];
  private queuedEvents: StoredEvent[] = [];
  private settingsRow: Settings;

  constructor(o: BookOptions) {
    this.space = o.space;
    this.nowFn = o.now ?? Date.now;
    this.secretsFn = o.secrets ?? (() => []);
    this.batchMs = o.batchMs ?? 250;
    this.settingsRow = {
      level: "info",
      fullDays: o.fullDays ?? DEFAULT_FULL_DAYS,
      aggregateDays: o.aggregateDays ?? DEFAULT_AGGREGATE_DAYS,
    };
    if (o.db) {
      this.db = o.db;
      this.reload();
    }
  }

  setNow(now: () => number): void { this.nowFn = now; }
  now(): number { return this.nowFn(); }
  secrets(): readonly string[] { return this.secretsFn(); }

  /** Attach logs.db when the host has applied the migration. A missing table leaves memory in charge. */
  bind(db: SqlDb): void {
    if (this.db) return;
    try {
      db.all("SELECT id FROM logs_row WHERE space = ? LIMIT 1", this.space);
    } catch {
      return;
    }
    this.db = db;
    this.reload();
  }

  pending(): number { return this.queuedRows.length + this.queuedSpans.length + this.queuedEvents.length; }

  write(input: LogInput | Record<string, unknown>): void {
    const row = this.normalize(input);
    if (!row) return;
    this.queuedRows.push(row);
    this.schedule();
  }

  span(input: SpanInput): void {
    const secrets = this.secrets();
    const traceId = cleanStr(input.traceId, secrets);
    const spanId = cleanStr(input.spanId, secrets);
    const name = cleanMsg(input.name, secrets);
    if (!traceId || !spanId) return;
    const row: StoredSpan = {
      space: this.space,
      traceId,
      spanId,
      name,
      at: input.at ?? this.now(),
      durUs: input.durUs ?? 0,
    };
    const parent = cleanStr(input.parent, secrets);
    if (parent) row.parent = parent;
    const attrs = scrubAttrs(input.attrs, secrets, false);
    if (attrs) row.attrs = attrs;
    this.queuedSpans.push(row);
    this.schedule();
  }

  event(input: EventInput): void {
    const secrets = this.secrets();
    const traceId = cleanStr(input.traceId, secrets);
    const type = cleanMsg(input.type, secrets);
    const actor = cleanStr(input.actor, secrets);
    if (!traceId || !actor) return;
    const row: StoredEvent = {
      space: this.space,
      traceId,
      seq: input.seq ?? this.nextSeq++,
      type,
      at: input.at ?? this.now(),
      actor,
    };
    const entity = cleanStr(input.entity, secrets);
    if (entity) row.entity = entity;
    this.queuedEvents.push(row);
    this.schedule();
  }

  /** One JSON line from the sink worker. Returns false when the line is not an object. */
  acceptLine(line: string): boolean {
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { return false; }
    const o = asObj(parsed);
    if (!o) return false;
    const kind = o["kind"];
    if (kind === "span") {
      const traceId = field(o, ["traceId", "trace_id"]);
      const spanId = field(o, ["spanId", "span_id"]);
      const name = field(o, ["name"]);
      if (typeof traceId !== "string" || typeof spanId !== "string" || typeof name !== "string") return false;
      const span: SpanInput = { traceId, spanId, name };
      const parent = field(o, ["parent"]);
      const at = num(field(o, ["at", "when"]));
      const durUs = num(field(o, ["durUs", "dur_us"]));
      if (typeof parent === "string") span.parent = parent;
      if (at !== undefined) span.at = at;
      if (durUs !== undefined) span.durUs = durUs;
      const attrs = asObj(o["attrs"]);
      if (attrs) span.attrs = attrs;
      this.span(span);
      return true;
    }
    if (kind === "event") {
      const traceId = field(o, ["traceId", "trace_id"]);
      const type = field(o, ["type"]);
      const actor = field(o, ["actor"]);
      if (typeof traceId !== "string" || typeof type !== "string" || typeof actor !== "string") return false;
      const ev: EventInput = { traceId, type, actor };
      const seq = int(field(o, ["seq"]));
      const at = num(field(o, ["at", "when"]));
      const entity = field(o, ["entity"]);
      if (seq !== undefined) ev.seq = seq;
      if (at !== undefined) ev.at = at;
      if (typeof entity === "string") ev.entity = entity;
      this.event(ev);
      return true;
    }
    this.write(o);
    return true;
  }

  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.queuedRows.length && !this.queuedSpans.length && !this.queuedEvents.length) return;
    const rows = this.queuedRows;
    const spans = this.queuedSpans;
    const events = this.queuedEvents;
    this.queuedRows = [];
    this.queuedSpans = [];
    this.queuedEvents = [];
    for (const row of rows) this.rows.push(row);
    for (const span of spans) this.upsertSpan(span);
    for (const ev of events) this.upsertEvent(ev);
    this.mirror(rows, spans, events);
  }

  prepareRead(): void { this.flush(); this.retain(); }

  retain(): void {
    this.flush();
    if (this.held()) return;
    const now = this.now();
    const fullBefore = now - this.settingsRow.fullDays * DAY_MS;
    const aggBefore = now - this.settingsRow.aggregateDays * DAY_MS;
    const keep: StoredRow[] = [];
    for (const row of this.rows) {
      if (row.at < fullBefore) this.fold(row);
      else keep.push(row);
    }
    this.rows = keep;
    this.spanRows = this.spanRows.filter((s) => s.at >= fullBefore);
    this.eventRows = this.eventRows.filter((e) => e.at >= fullBefore);
    this.aggs = this.aggs.filter((a) => a.day >= aggBefore);
    const db = this.db;
    if (!db) return;
    this.attempt(() => {
      db.run("DELETE FROM logs_row WHERE space = ? AND at < ?", this.space, fullBefore);
      db.run("DELETE FROM logs_span WHERE space = ? AND at < ?", this.space, fullBefore);
      db.run("DELETE FROM logs_event WHERE space = ? AND at < ?", this.space, fullBefore);
      db.run("DELETE FROM logs_aggregate WHERE space = ? AND day < ?", this.space, aggBefore);
      for (const a of this.aggs) if (a.space === this.space) this.insertAgg(db, a);
    });
  }

  placeHold(id: string, untilMs?: number): void {
    const row: { id: string; until?: number } = { id };
    if (untilMs !== undefined) row.until = untilMs;
    this.holds = this.holds.filter((h) => h.id !== id);
    this.holds.push(row);
    this.attempt(() => this.db?.run("INSERT OR REPLACE INTO logs_hold (id, space, until_ms) VALUES (?, ?, ?)", id, this.space, untilMs ?? null));
  }

  releaseHold(id: string): void {
    this.holds = this.holds.filter((h) => h.id !== id);
    this.attempt(() => this.db?.run("DELETE FROM logs_hold WHERE id = ? AND space = ?", id, this.space));
  }

  /** Erase a person: the row keeps the id; reads blank the actor. */
  erase(actor: string): void {
    this.flush();
    this.tombs.set(actor, this.now());
    this.attempt(() => this.db?.run("INSERT OR REPLACE INTO logs_tombstone (actor, at) VALUES (?, ?)", actor, this.now()));
  }

  erased(actor: string | undefined): boolean { return !!actor && this.tombs.has(actor); }

  rawRows(): readonly StoredRow[] { return this.rows; }
  rawSpans(): readonly StoredSpan[] { return this.spanRows; }
  rawEvents(): readonly StoredEvent[] { return this.eventRows; }
  aggregates(): readonly AggregateRow[] { return this.aggs; }

  settings(): Settings { return { ...this.settingsRow }; }

  updateSettings(patch: { level?: LevelName; fullDays?: number; aggregateDays?: number }): void {
    if (patch.level) this.settingsRow.level = patch.level;
    if (patch.fullDays !== undefined && patch.fullDays >= 1) this.settingsRow.fullDays = Math.trunc(patch.fullDays);
    if (patch.aggregateDays !== undefined && patch.aggregateDays >= 1) this.settingsRow.aggregateDays = Math.trunc(patch.aggregateDays);
    const db = this.db;
    if (!db) return;
    this.attempt(() => db.run(
      "INSERT OR REPLACE INTO logs_settings (space, level, full_days, aggregate_days) VALUES (?, ?, ?, ?)",
      this.space, LEVELS[this.settingsRow.level], this.settingsRow.fullDays, this.settingsRow.aggregateDays,
    ));
  }

  saveReplay(row: ReplayRow): void {
    this.replays.set(row.id, row);
    this.attempt(() => this.db?.run(
      "INSERT OR REPLACE INTO logs_replay (id, space, at_seq, run_id, conflict_id, state, recorded_outward, steps, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      row.id, this.space, row.atSeq, row.runId ?? null, row.conflictId ?? null, row.state, row.recordedOutward, JSON.stringify(row.steps), row.at,
    ));
  }

  replay(id: string): ReplayRow | undefined { return this.replays.get(id); }

  addStream(id: string, filterJson: string): void {
    this.streams.set(id, filterJson);
    this.attempt(() => this.db?.run("INSERT OR REPLACE INTO logs_stream (id, space, filter, at) VALUES (?, ?, ?, ?)", id, this.space, filterJson, this.now()));
  }

  saveExport(id: string, rowsJson: string): void {
    this.exports.set(id, rowsJson);
    this.attempt(() => this.db?.run("INSERT OR REPLACE INTO logs_export (id, space, at, rows_json) VALUES (?, ?, ?, ?)", id, this.space, this.now(), rowsJson));
  }

  close(): void { this.flush(); }

  private held(): boolean {
    const now = this.now();
    return this.holds.some((h) => h.until === undefined || h.until > now);
  }

  private schedule(): void {
    if (this.batchMs <= 0) { this.flush(); return; }
    if (!this.timer) {
      const timer = setTimeout(() => this.flush(), this.batchMs);
      this.timer = timer;
      (timer as unknown as { unref?: () => void }).unref?.();
    }
  }

  private normalize(input: LogInput | Record<string, unknown>): StoredRow | null {
    const o = input as Record<string, unknown>;
    const secrets = this.secrets();
    const label = labelNumber(field(o, ["label"]));
    const restricted = label === 3;
    const attrsIn = field(o, ["attrs"]);
    const attrs = scrubAttrs(attrsIn, secrets, restricted);
    const msg = cleanMsg(field(o, ["msg"]), secrets);
    const id = int(field(o, ["id"])) ?? this.nextId++;
    if (id >= this.nextId) this.nextId = id + 1;
    const row: StoredRow = {
      id,
      at: num(field(o, ["at", "when"])) ?? this.now(),
      level: levelNumber(field(o, ["level"])),
      space: this.space,
      msg,
    };
    const set = (key: keyof StoredRow, value: string | undefined): void => {
      if (value !== undefined) (row as unknown as Record<string, unknown>)[key] = value;
    };
    set("traceId", cleanStr(field(o, ["traceId", "trace_id"]), secrets));
    set("spanId", cleanStr(field(o, ["spanId", "span_id"]), secrets));
    set("actor", cleanStr(field(o, ["actor"]), secrets));
    set("onBehalf", cleanStr(field(o, ["onBehalf", "on_behalf"]), secrets));
    set("runId", cleanStr(field(o, ["runId", "run_id"]), secrets));
    set("threadId", cleanStr(field(o, ["threadId", "thread_id"]), secrets));
    set("device", cleanStr(field(o, ["device"]), secrets));
    set("place", cleanStr(field(o, ["place"]), secrets));
    set("cap", cleanStr(field(o, ["cap"]), secrets));
    set("entity", cleanStr(field(o, ["entity"]), secrets));
    set("entityId", cleanStr(field(o, ["entityId", "entity_id", "recordId"]), secrets));
    set("result", cleanStr(field(o, ["result"]), secrets));
    set("appVersion", cleanStr(field(o, ["appVersion", "app_version"]), secrets));
    set("serverVersion", cleanStr(field(o, ["serverVersion", "server_version"]), secrets));
    set("machine", cleanStr(field(o, ["machine"]), secrets));
    const dur = num(field(o, ["durMs", "dur_ms"]));
    const cost = int(field(o, ["costMicros", "cost_micros"]));
    const tin = int(field(o, ["tokensIn", "tokens_in"]));
    const tout = int(field(o, ["tokensOut", "tokens_out"]));
    if (dur !== undefined) row.durMs = dur;
    if (cost !== undefined) row.costMicros = cost;
    if (tin !== undefined) row.tokensIn = tin;
    if (tout !== undefined) row.tokensOut = tout;
    if (label !== undefined) row.label = label;
    if (attrs) row.attrs = attrs;
    return row;
  }

  private upsertSpan(span: StoredSpan): void {
    const i = this.spanRows.findIndex((s) => s.traceId === span.traceId && s.spanId === span.spanId);
    if (i >= 0) this.spanRows[i] = span;
    else this.spanRows.push(span);
  }

  private upsertEvent(ev: StoredEvent): void {
    if (ev.seq >= this.nextSeq) this.nextSeq = ev.seq + 1;
    const i = this.eventRows.findIndex((e) => e.traceId === ev.traceId && e.seq === ev.seq);
    if (i >= 0) this.eventRows[i] = ev;
    else this.eventRows.push(ev);
  }

  private fold(row: StoredRow): void {
    const day = Math.floor(row.at / DAY_MS) * DAY_MS;
    const found = this.aggs.find((a) => a.space === row.space && a.day === day && a.cap === row.cap && a.result === row.result && a.level === row.level);
    if (found) {
      found.rows += 1;
      found.costMicros += row.costMicros ?? 0;
      found.durMs += row.durMs ?? 0;
      return;
    }
    const agg: AggregateRow = {
      id: this.nextAgg++,
      space: row.space,
      day,
      level: row.level,
      rows: 1,
      costMicros: row.costMicros ?? 0,
      durMs: row.durMs ?? 0,
    };
    if (row.cap) agg.cap = row.cap;
    if (row.result) agg.result = row.result;
    this.aggs.push(agg);
  }

  private mirror(rows: readonly StoredRow[], spans: readonly StoredSpan[], events: readonly StoredEvent[]): void {
    const db = this.db;
    if (!db) return;
    this.attempt(() => {
      for (const row of rows) db.run(ROW_INSERT, ...rowArgs(row));
      for (const span of spans) db.run(
        "INSERT OR REPLACE INTO logs_span (space, trace_id, span_id, parent, name, at, dur_us, attrs) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        span.space, span.traceId, span.spanId, span.parent ?? null, span.name, span.at, span.durUs, span.attrs ? JSON.stringify(span.attrs) : null,
      );
      for (const ev of events) db.run(
        "INSERT OR REPLACE INTO logs_event (space, trace_id, seq, type, at, actor, entity) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ev.space, ev.traceId, ev.seq, ev.type, ev.at, ev.actor, ev.entity ?? null,
      );
    });
  }

  private insertAgg(db: SqlDb, a: AggregateRow): void {
    db.run(
      "INSERT OR REPLACE INTO logs_aggregate (id, space, day, cap, result, level, rows, cost_micros, dur_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      a.id, a.space, a.day, a.cap ?? null, a.result ?? null, a.level, a.rows, a.costMicros, a.durMs,
    );
  }

  private reload(): void {
    const db = this.db;
    if (!db) return;
    this.attempt(() => {
      const rows = db.all("SELECT * FROM logs_row WHERE space = ? ORDER BY id", this.space);
      const loaded: StoredRow[] = [];
      for (const item of rows) {
        const row = rowFromSql(item, this.space);
        if (row) loaded.push(row);
      }
      if (loaded.length) {
        this.rows = loaded;
        this.nextId = loaded.reduce((m, r) => Math.max(m, r.id), 0) + 1;
      }
    });
    this.attempt(() => {
      for (const item of db.all("SELECT * FROM logs_span WHERE space = ?", this.space)) {
        const o = asObj(item);
        const traceId = o ? strOf(o["trace_id"]) : undefined;
        const spanId = o ? strOf(o["span_id"]) : undefined;
        const name = o ? strOf(o["name"]) : undefined;
        const at = o ? num(o["at"]) : undefined;
        if (!o || !traceId || !spanId || !name || at === undefined) continue;
        const span: StoredSpan = { space: this.space, traceId, spanId, name, at, durUs: num(o["dur_us"]) ?? 0 };
        const parent = strOf(o["parent"]);
        if (parent) span.parent = parent;
        const attrs = parseAttrs(o["attrs"]);
        if (attrs) span.attrs = attrs;
        this.upsertSpan(span);
      }
    });
    this.attempt(() => {
      for (const item of db.all("SELECT * FROM logs_event WHERE space = ?", this.space)) {
        const o = asObj(item);
        const traceId = o ? strOf(o["trace_id"]) : undefined;
        const type = o ? strOf(o["type"]) : undefined;
        const actor = o ? strOf(o["actor"]) : undefined;
        const seq = o ? int(o["seq"]) : undefined;
        const at = o ? num(o["at"]) : undefined;
        if (!traceId || !type || !actor || seq === undefined || at === undefined) continue;
        const ev: StoredEvent = { space: this.space, traceId, seq, type, at, actor };
        const entity = o ? strOf(o["entity"]) : undefined;
        if (entity) ev.entity = entity;
        this.upsertEvent(ev);
      }
    });
    this.attempt(() => {
      for (const item of db.all("SELECT actor, at FROM logs_tombstone")) {
        const o = asObj(item);
        const actor = o ? strOf(o["actor"]) : undefined;
        if (actor) this.tombs.set(actor, num(o?.["at"]) ?? 0);
      }
    });
    this.attempt(() => {
      const found = db.all("SELECT level, full_days, aggregate_days FROM logs_settings WHERE space = ?", this.space);
      const o = asObj(found[0]);
      if (!o) return;
      const level = int(o["level"]);
      const full = int(o["full_days"]);
      const agg = int(o["aggregate_days"]);
      if (level !== undefined) this.settingsRow.level = levelName(level);
      if (full !== undefined && full >= 1) this.settingsRow.fullDays = full;
      if (agg !== undefined && agg >= 1) this.settingsRow.aggregateDays = agg;
    });
  }

  private attempt(fn: () => void): void {
    try { fn(); } catch { /* logs.db is optional until the migration is applied */ }
  }
}

function strOf(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function parseAttrs(v: unknown): Record<string, unknown> | undefined {
  if (typeof v !== "string" || !v) return undefined;
  try {
    const parsed = JSON.parse(v) as unknown;
    return isObj(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function rowArgs(row: StoredRow): unknown[] {
  return [
    row.id, row.at, row.level, row.traceId ?? null, row.spanId ?? null, row.space, row.actor ?? null, row.onBehalf ?? null,
    row.runId ?? null, row.threadId ?? null, row.device ?? null, row.place ?? null, row.cap ?? null, row.entity ?? null,
    row.entityId ?? null, row.result ?? null, row.durMs ?? null, row.costMicros ?? null, row.tokensIn ?? null, row.tokensOut ?? null,
    row.label ?? null, row.appVersion ?? null, row.serverVersion ?? null, row.machine ?? null, row.msg,
    row.attrs ? JSON.stringify(row.attrs) : null,
  ];
}

function rowFromSql(item: unknown, space: string): StoredRow | null {
  const o = asObj(item);
  if (!o) return null;
  const id = int(o["id"]);
  const at = num(o["at"]);
  const level = int(o["level"]);
  const msg = strOf(o["msg"]);
  if (id === undefined || at === undefined || level === undefined || !msg) return null;
  const row: StoredRow = { id, at, level, space: strOf(o["space"]) ?? space, msg };
  const assign = (key: keyof StoredRow, value: string | number | undefined): void => {
    if (value !== undefined) (row as unknown as Record<string, unknown>)[key] = value;
  };
  assign("traceId", strOf(o["trace_id"]));
  assign("spanId", strOf(o["span_id"]));
  assign("actor", strOf(o["actor"]));
  assign("onBehalf", strOf(o["on_behalf"]));
  assign("runId", strOf(o["run_id"]));
  assign("threadId", strOf(o["thread_id"]));
  assign("device", strOf(o["device"]));
  assign("place", strOf(o["place"]));
  assign("cap", strOf(o["cap"]));
  assign("entity", strOf(o["entity"]));
  assign("entityId", strOf(o["entity_id"]));
  assign("result", strOf(o["result"]));
  assign("appVersion", strOf(o["app_version"]));
  assign("serverVersion", strOf(o["server_version"]));
  assign("machine", strOf(o["machine"]));
  assign("durMs", num(o["dur_ms"]));
  assign("costMicros", int(o["cost_micros"]));
  assign("tokensIn", int(o["tokens_in"]));
  assign("tokensOut", int(o["tokens_out"]));
  assign("label", int(o["label"]));
  const attrs = parseAttrs(o["attrs"]);
  if (attrs) row.attrs = attrs;
  return row;
}

export function createBook(o: BookOptions): LogBook {
  return new LogBook(o);
}
