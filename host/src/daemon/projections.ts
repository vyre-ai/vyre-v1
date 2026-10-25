// Module projections on the daemon (ruling 31/32, P-H_07). A module exports `projections` (kernel AsyncConsumer definitions, mode "async"); the daemon runs them over the Space log.
// The events module's `events.webhooks_out` is the first: it turns each event a webhook subscribes to into a pending delivery row and asks the dispatcher to send it.
//   Tx       the module's tables live in modules.db, so a projection's Tx is a window on that database (the module only touches its own `<module>_` tables).
//   cursor   one row per projection in `host_projection_cursor`; a projection first seen starts at the end of the log (history is not replayed into it: a new webhook never fires on old events).
//   delivery at least once: the cursor moves after the handler returns, so a crash repeats at most the event in flight; the handlers are idempotent (the contract of AsyncConsumer).
//   failure  a projection that throws is retried on the next pass; after MAX_TRIES it is skipped and logged so one bad event cannot hold the rest.
// Passes never overlap; a call made during a pass runs another when it ends.
import type { StoredEvent } from "../../../kernel/src/log/index.ts";
import type { AsyncConsumer, ProjectionDef, Tx } from "../../../kernel/src/store/projection.ts";
import type { HostDb } from "./sqlite.ts";
import type { LogReader } from "./consumers.ts";

export const MAX_PROJECTION_TRIES = 5;
const PAGE = 200;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isAsync = (p: unknown): p is AsyncConsumer =>
  isRecord(p) && p["mode"] === "async" && typeof p["name"] === "string" && typeof p["version"] === "number" && isRecord(p["on"]);

/** The async projections a module exports (`export const projections = [...]`). Anything else in the array (inline projections, odd shapes) is left to the kernel. */
export function collectProjections(ns: Record<string, unknown>): AsyncConsumer[] {
  const list = ns["projections"];
  if (!Array.isArray(list)) return [];
  return (list as unknown[]).filter(isAsync);
}

/** A projection's Tx over modules.db. Synchronous SQL, like the kernel's. */
export function hostTx(db: HostDb): Tx {
  return {
    run: (sql, ...a) => ({ changes: db.run(sql, ...a).changes, lastInsertRowid: 0 }),
    get: <T,>(sql: string, ...a: any[]) => db.all(sql, ...a)[0] as T | undefined,
    all: <T,>(sql: string, ...a: any[]) => db.all(sql, ...a) as T[],
    exec: (sql) => { db.exec(sql); },
  };
}

export interface ProjectionRunnerDeps {
  now(): number;
  /** modules.db */
  db: HostDb;
  log: LogReader;
  projections: readonly ProjectionDef[];
  /**
   * Crash recovery, by projection name. A projection's handler may record work and then ask something else to do it (the events module inserts a pending delivery row, then asks the
   * dispatcher to send it). The cursor moves after the handler returns, so a crash in between repeats the event, but the handler sees its row already there and does nothing: the work is
   * never started. `run` finds that work (rows pending past `windowMs`) and starts it again; it must be idempotent. It runs once at start and then on every pump, at most once per `windowMs`.
   */
  recover?: readonly { name: string; windowMs: number; run(now: number): Promise<number> }[];
  warn(msg: string, attrs?: Record<string, unknown>): void;
}

export interface ProjectionRunner {
  readonly projections: readonly AsyncConsumer[];
  /** Create each projection's tables and give each one without a cursor one at the end of the log (a changed `version` resets its state and restarts at the end of the log). Call once after boot. */
  start(): Promise<void>;
  /** Deliver everything committed since each projection's cursor. */
  pump(): Promise<void>;
  /** Start again the work a crash left behind (see `recover` in the deps). Returns how many items were started. */
  recoverNow(): Promise<number>;
  /** The seq each projection has reached. */
  cursors(): Record<string, number>;
}

export function createProjectionRunner(d: ProjectionRunnerDeps): ProjectionRunner {
  d.db.exec("CREATE TABLE IF NOT EXISTS host_projection_cursor (name TEXT PRIMARY KEY, version INTEGER NOT NULL, seq INTEGER NOT NULL, at INTEGER NOT NULL)");
  const list = d.projections.filter(isAsync);
  const tx = hostTx(d.db);
  const tries = new Map<string, number>();

  const row = (name: string): { version: number; seq: number } | undefined => d.db.all("SELECT version, seq FROM host_projection_cursor WHERE name = ?", name)[0] as { version: number; seq: number } | undefined;
  const setCursor = (p: AsyncConsumer, seq: number): void => {
    d.db.run("INSERT INTO host_projection_cursor (name, version, seq, at) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET version = excluded.version, seq = excluded.seq, at = excluded.at", p.name, p.version, seq, d.now());
  };

  async function handle(p: AsyncConsumer, e: StoredEvent): Promise<boolean> {
    const h = p.on[e.type];
    if (!h) return true;
    const key = `${p.name}:${e.seq}`;
    try {
      await h(tx, e);
      tries.delete(key);
      return true;
    } catch (err) {
      const n = (tries.get(key) ?? 0) + 1;
      tries.set(key, n);
      d.warn("a projection failed on an event", { projection: p.name, event: e.type, seq: e.seq, try: n, error: err instanceof Error ? err.message : String(err) });
      if (n < MAX_PROJECTION_TRIES) return false;
      tries.delete(key);
      d.warn("a projection gave up on an event and skipped it", { projection: p.name, event: e.type, seq: e.seq });
      return true;
    }
  }

  async function passFor(p: AsyncConsumer): Promise<void> {
    const c = row(p.name);
    if (!c) return;   // start() has not run for it yet
    let at = c.seq;
    const size = p.batch ?? PAGE;
    for (;;) {
      const page = await d.log.read({ after: at, limit: size });
      if (!page.length) return;
      for (const e of page) {
        if (!(await handle(p, e))) { setCursor(p, at); return; }   // this event is tried again on the next pass, before any later one
        at = e.seq;
        setCursor(p, at);
      }
      if (page.length < size) return;
    }
  }

  const lastRecover = new Map<string, number>();
  async function recoverNow(force: boolean): Promise<number> {
    let started = 0;
    for (const r of d.recover ?? []) {
      const t = d.now();
      const last = lastRecover.get(r.name);
      if (!force && last !== undefined && t - last < r.windowMs) continue;
      lastRecover.set(r.name, t);
      try {
        const n = await r.run(t);
        started += n;
        if (n) d.warn("a projection started work a crash had left behind", { projection: r.name, items: n });
      } catch (err) {
        d.warn("crash recovery of a projection failed", { projection: r.name, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return started;
  }

  let running: Promise<void> | null = null, again = false;
  const run = (): Promise<void> => (async () => {
    try {
      await null;   // let `running` be assigned before the first check
      do {
        again = false;
        for (const p of list) await passFor(p);
        await recoverNow(false);
      } while (again);
    } finally { running = null; }
  })();

  return {
    projections: list,
    async start() {
      const head = (await d.log.currentHead()).seq;
      for (const p of list) {
        p.init?.(tx);
        const c = row(p.name);
        if (!c) setCursor(p, head);
        else if (c.version !== p.version) { p.reset?.(tx); setCursor(p, head); }   // DECISION: a new version does not replay history; webhooks_out would resend every old event to today's webhooks
      }
      await recoverNow(true);
    },
    pump() {
      if (running) { again = true; return running; }
      running = run();
      return running;
    },
    recoverNow: () => recoverNow(true),
    cursors() {
      const out: Record<string, number> = {};
      for (const p of list) out[p.name] = row(p.name)?.seq ?? 0;
      return out;
    },
  };
}
