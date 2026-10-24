// Headless client: @vyre/sync protocol version over node:sqlite, timed by a fake UI clock.
// One socket for the process. Opening screens does not open another connection.

import { DatabaseSync } from "node:sqlite";
import { PROTOCOL_VERSION } from "../../sync/src/protocol.ts";
import type { UiClock } from "./clock.ts";
import type { Span } from "./types.ts";

export interface OpenSpan {
  id: string;
  name: string;
  budgetId: string;
  startMs: number;
  traceId: string;
  parentId?: string;
}

export interface HeadlessClient {
  readonly protocol: number;
  begin(name: string, traceId: string, budgetId: string, parentId?: string): OpenSpan;
  end(open: OpenSpan): Span;
  /** One local sqlite write plus an edit.local span measured on the clock. */
  edit(id: string, payload: string, traceId?: string): Span;
  read(id: string): string | null;
  openScreens(n: number): void;
  screens(): number;
  /** Always 1. The connection manager is a singleton. */
  sockets(): number;
  spans(): Span[];
  close(): void;
}

interface SpanRow {
  id: string;
  name: string;
  budget_id: string;
  start_ms: number;
  dur_ms: number;
  trace_id: string;
  parent: string | null;
}

export function createHeadlessClient(opts: { clock: UiClock }): HeadlessClient {
  const clock = opts.clock;
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE rows (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_ms REAL NOT NULL);
    CREATE TABLE spans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      budget_id TEXT NOT NULL,
      start_ms REAL NOT NULL,
      dur_ms REAL NOT NULL,
      trace_id TEXT NOT NULL,
      parent TEXT
    );
  `);
  const putMeta = db.prepare("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v");
  putMeta.run("protocol", String(PROTOCOL_VERSION));
  putMeta.run("sockets", "1");
  putMeta.run("screens", "0");
  let seq = 0;
  let closed = false;
  const guard = (): void => {
    if (closed) throw new Error("headless client is closed");
  };

  const client: HeadlessClient = {
    protocol: PROTOCOL_VERSION,
    begin(name, traceId, budgetId, parentId) {
      guard();
      seq += 1;
      const open: OpenSpan = { id: `s${seq}`, name, budgetId, startMs: clock.now(), traceId };
      if (parentId) open.parentId = parentId;
      return open;
    },
    end(open) {
      guard();
      const durMs = clock.now() - open.startMs;
      db.prepare("INSERT INTO spans (id, name, budget_id, start_ms, dur_ms, trace_id, parent) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        open.id, open.name, open.budgetId, open.startMs, durMs, open.traceId, open.parentId ?? null,
      );
      const span: Span = { id: open.id, name: open.name, budgetId: open.budgetId, startMs: open.startMs, durMs, traceId: open.traceId };
      if (open.parentId) span.parentId = open.parentId;
      return span;
    },
    edit(id, payload, traceId = "tr_edit") {
      guard();
      const open = client.begin("edit.local", traceId, "edit");
      db.prepare(
        "INSERT INTO rows (id, payload, updated_ms) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_ms = excluded.updated_ms",
      ).run(id, payload, clock.now());
      return client.end(open);
    },
    read(id) {
      guard();
      const row = db.prepare("SELECT payload FROM rows WHERE id = ?").get(id) as { payload: string } | undefined;
      return row ? row.payload : null;
    },
    openScreens(n) {
      guard();
      if (!Number.isInteger(n) || n < 1) throw new Error("openScreens wants a positive count");
      const row = db.prepare("SELECT v FROM meta WHERE k = 'screens'").get() as { v: string };
      putMeta.run("screens", String(Number(row.v) + n));
    },
    screens() {
      guard();
      const row = db.prepare("SELECT v FROM meta WHERE k = 'screens'").get() as { v: string };
      return Number(row.v);
    },
    sockets() {
      guard();
      const row = db.prepare("SELECT v FROM meta WHERE k = 'sockets'").get() as { v: string };
      return Number(row.v);
    },
    spans() {
      guard();
      const rows = db.prepare("SELECT id, name, budget_id, start_ms, dur_ms, trace_id, parent FROM spans ORDER BY id").all() as unknown as SpanRow[];
      return rows.map((r) => {
        const span: Span = { id: r.id, name: r.name, budgetId: r.budget_id, startMs: r.start_ms, durMs: r.dur_ms, traceId: r.trace_id };
        if (r.parent) span.parentId = r.parent;
        return span;
      });
    },
    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
  return client;
}
