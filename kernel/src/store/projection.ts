// Projections (ARCH 4.3). A projection folds events into tables. Inline projections run in the SAME transaction as the append (a reducer that throws rolls the whole batch back, log included);
// async consumers keep a durable cursor in `consumers` and run after commit, at least once.
//
// How inline reducers join the commit: the log store (log/store.ts) owns BEGIN and COMMIT. The host hands it a thin handle on the same connection whose `exec("COMMIT")` first folds every event
// appended in this transaction through the inline reducers. Nothing in log/ changes; if the log later grows a pre-commit hook, only `hookedDb` here is replaced.
import { DatabaseSync } from "node:sqlite";
import type { StatementSync } from "node:sqlite";
import { LogError } from "../log/errors.ts";
import { LogStore } from "../log/store.ts";
import type { NewEvent, StoredEvent } from "../log/types.ts";

export type EventName = string;

/** Synchronous SQL on the projection's connection. Statements are cached by text. */
export interface Tx {
  run(sql: string, ...args: any[]): { changes: number; lastInsertRowid: number };
  get<T = Record<string, any>>(sql: string, ...args: any[]): T | undefined;
  all<T = Record<string, any>>(sql: string, ...args: any[]): T[];
  exec(sql: string): void;
}

interface Base {
  /** 'records.rows', 'access.acl_index' */
  name: string;
  /** Bump to rebuild from the log on the next open. */
  version: number;
  /** An old event shape lifted to the current one before `on` sees it. */
  upcast?: Record<EventName, (e: StoredEvent) => StoredEvent>;
  /** Every projection is rebuildable: `vyre rebuild --projection name`. */
  rebuild: "replay";
}
export interface InlineProjection extends Base {
  mode: "inline";
  /** CREATE TABLE IF NOT EXISTS ... Runs at every open, inside a transaction. */
  init?(tx: Tx): void;
  /** Empty the projection's tables before a replay. Required for a projection that keeps state. */
  reset?(tx: Tx): void;
  /** Pure SQL, no I/O, never async: a promise from a reducer is refused. */
  on: Record<EventName, (tx: Tx, e: StoredEvent) => void>;
}
export interface AsyncConsumer extends Base {
  mode: "async";
  init?(tx: Tx): void;
  reset?(tx: Tx): void;
  /** Runs after commit with the cursor advanced afterwards: a crash between the two repeats the event, so handlers are idempotent. */
  on: Record<EventName, (tx: Tx, e: StoredEvent) => void | Promise<void>>;
  /** Events per read, default 200. */
  batch?: number;
}
export type ProjectionDef = InlineProjection | AsyncConsumer;

const META = `CREATE TABLE IF NOT EXISTS projection_meta (name TEXT PRIMARY KEY, version INTEGER NOT NULL, applied INTEGER NOT NULL)`;
const PAGE = 1000;

export function makeTx(db: DatabaseSync): Tx {
  const cache = new Map<string, StatementSync>();
  const st = (sql: string): StatementSync => { let s = cache.get(sql); if (!s) { s = db.prepare(sql); cache.set(sql, s); } return s; };
  return {
    run: (sql, ...a) => { const r = st(sql).run(...a); return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }; },
    get: <T,>(sql: string, ...a: any[]) => st(sql).get(...a) as T | undefined,
    all: <T,>(sql: string, ...a: any[]) => st(sql).all(...a) as T[],
    exec: (sql) => { db.exec(sql); },
  };
}

/** The event's payload as JSON (every unencrypted payload is canonical JSON). */
export function payloadOf<T = any>(e: StoredEvent): T {
  return JSON.parse(new TextDecoder().decode(e.payload)) as T;
}

export interface HostOptions {
  db: DatabaseSync;
  space: string;
  projections: ProjectionDef[];
  clock?: () => number;
}

export interface PumpResult { name: string; processed: number; cursor: number; error?: string }

export class ProjectionHost {
  readonly store: LogStore;
  readonly tx: Tx;
  private raw: DatabaseSync;
  private defs: ProjectionDef[];
  private inline: InlineProjection[];
  private consumers: AsyncConsumer[];
  /** Highest seq every inline projection has folded. Moves only after a COMMIT succeeds. */
  private applied = 0;
  private pending = 0;

  constructor(o: HostOptions) {
    const names = new Set<string>();
    for (const d of o.projections) { if (names.has(d.name)) throw new Error(`projection ${d.name} registered twice`); names.add(d.name); }
    this.raw = o.db;
    this.defs = o.projections;
    this.inline = o.projections.filter((p): p is InlineProjection => p.mode === "inline");
    this.consumers = o.projections.filter((p): p is AsyncConsumer => p.mode === "async");
    this.tx = makeTx(o.db);
    this.store = new LogStore({ db: this.hookedDb(), space: o.space, ...(o.clock ? { clock: o.clock } : {}) });
    this.setup();
  }

  static open(o: { path: string; space: string; projections: ProjectionDef[]; clock?: () => number }): ProjectionHost {
    return new ProjectionHost({ db: new DatabaseSync(o.path), space: o.space, projections: o.projections, ...(o.clock ? { clock: o.clock } : {}) });
  }

  /** The same connection, except that COMMIT first folds the batch through the inline reducers. A reducer that throws leaves the transaction open for the log store's own ROLLBACK. */
  private hookedDb(): DatabaseSync {
    const raw = this.raw;
    const exec = (sql: string): void => {
      if (sql === "COMMIT") {
        this.pending = this.foldNew();
        raw.exec("COMMIT");
        this.applied = this.pending;
        return;
      }
      raw.exec(sql);
    };
    return new Proxy(raw, {
      get: (t, p) => {
        if (p === "exec") return exec;
        const v = Reflect.get(t, p, t);
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
  }

  private upcast(p: ProjectionDef, e: StoredEvent): StoredEvent {
    const u = p.upcast?.[e.type];
    return u ? u(e) : e;
  }

  private fold(p: InlineProjection, events: StoredEvent[]): void {
    for (const raw of events) {
      const e = this.upcast(p, raw);
      const h = p.on[e.type];
      if (!h) continue;
      const r = h(this.tx, e) as unknown;
      if (r && typeof (r as { then?: unknown }).then === "function") throw new LogError("internal", `inline reducer ${p.name} for ${e.type} returned a promise; inline reducers are synchronous`);
    }
  }

  /** Fold events appended since `applied` (still uncommitted) through every inline projection; returns the new applied seq. */
  private foldNew(): number {
    let after = this.applied;
    if (!this.inline.length) return this.store.head.seq;
    for (;;) {
      const evs = this.store.read({ after, limit: PAGE });
      if (!evs.length) break;
      for (const p of this.inline) this.fold(p, evs);
      after = evs[evs.length - 1]!.seq;
      if (evs.length < PAGE) break;
    }
    for (const p of this.inline) this.tx.run("UPDATE projection_meta SET applied = ? WHERE name = ?", after, p.name);
    return after;
  }

  private inTxn<T>(f: () => T): T {
    this.raw.exec("BEGIN IMMEDIATE");
    try { const r = f(); this.raw.exec("COMMIT"); return r; } catch (e) { try { this.raw.exec("ROLLBACK"); } catch { /* already rolled back */ } throw e; }
  }

  private setup(): void {
    this.raw.exec(META);
    for (const p of this.defs) {
      this.inTxn(() => {
        p.init?.(this.tx);
        const m = this.tx.get<{ version: number; applied: number }>("SELECT version, applied FROM projection_meta WHERE name = ?", p.name);
        if (!m || m.version !== p.version) this.replayAll(p);
        else if (p.mode === "inline" && m.applied < this.store.head.seq) this.replayFrom(p, m.applied);
      });
    }
    this.applied = this.store.head.seq;
  }

  private replayAll(p: ProjectionDef): void {
    p.reset?.(this.tx);
    this.tx.run("INSERT INTO projection_meta (name, version, applied) VALUES (?, ?, 0) ON CONFLICT(name) DO UPDATE SET version = excluded.version, applied = 0", p.name, p.version);
    if (p.mode === "async") { this.tx.run("INSERT INTO consumers (name, cursor, updated) VALUES (?, 0, ?) ON CONFLICT(name) DO UPDATE SET cursor = 0, updated = excluded.updated", p.name, Date.now()); return; }
    this.replayFrom(p, 0);
  }

  private replayFrom(p: InlineProjection, from: number): void {
    let after = from;
    for (;;) {
      const evs = this.store.read({ after, limit: PAGE });
      if (!evs.length) break;
      this.fold(p, evs);
      after = evs[evs.length - 1]!.seq;
      if (evs.length < PAGE) break;
    }
    this.tx.run("UPDATE projection_meta SET applied = ? WHERE name = ?", Math.max(after, from), p.name);
  }

  /** Drop and rebuild one projection from the log (`vyre rebuild --projection name`). Async consumers restart from event 1. */
  rebuild(name: string): void {
    const p = this.defs.find((d) => d.name === name);
    if (!p) throw new Error(`no projection ${name}`);
    this.inTxn(() => { this.tx.run("DELETE FROM projection_meta WHERE name = ?", name); this.replayAll(p); });
  }

  /** Append one event, projections included, in one transaction. Throws LogError when the log or a reducer refuses it. */
  append(ev: NewEvent): StoredEvent {
    const r = this.store.appendBatch([ev])[0]!;
    if (!r.ok) throw new LogError(r.code as never, r.message);
    return r.event;
  }

  projectionVersion(name: string): { version: number; applied: number } | undefined {
    return this.tx.get("SELECT version, applied FROM projection_meta WHERE name = ?", name);
  }

  consumerCursor(name: string): number {
    return this.tx.get<{ cursor: number }>("SELECT cursor FROM consumers WHERE name = ?", name)?.cursor ?? 0;
  }

  /** Run one async consumer until it is level with the log or a handler fails (the cursor stays before the failed event). */
  async pump(name: string): Promise<PumpResult> {
    const c = this.consumers.find((d) => d.name === name);
    if (!c) throw new Error(`no async consumer ${name}`);
    let cursor = this.consumerCursor(name), processed = 0;
    try {
      for (;;) {
        const evs = this.store.read({ after: cursor, limit: c.batch ?? 200 });
        if (!evs.length) break;
        for (const raw of evs) {
          const e = this.upcast(c, raw);
          const h = c.on[e.type];
          if (h) await h(this.tx, e);
          cursor = raw.seq; processed++;
          this.tx.run("UPDATE consumers SET cursor = ?, updated = ? WHERE name = ?", cursor, Date.now(), name);
        }
      }
    } catch (err) {
      return { name, processed, cursor, error: err instanceof Error ? err.message : String(err) };
    }
    return { name, processed, cursor };
  }

  /** Pump every async consumer once. */
  async drain(): Promise<PumpResult[]> {
    const out: PumpResult[] = [];
    for (const c of this.consumers) out.push(await this.pump(c.name));
    return out;
  }

  close(): void { this.store.close(); }
}
