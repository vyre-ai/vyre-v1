// Headless perf client (ARCH 9). Spans and screen opens live in node:sqlite.
// One connection row is inserted at open. Further screens reuse it. A fake UI clock stamps spans.
// sync/src/protocol.ts is the frozen wire contract. This client is the harness store those probes read.

import { DatabaseSync } from "node:sqlite";
import type { StatementSync } from "node:sqlite";
import type { Span } from "./types.ts";
import { createClock } from "./clock.ts";
import type { FakeClock } from "./clock.ts";

const SCHEMA = `
CREATE TABLE connection (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  device_id TEXT NOT NULL
);
CREATE TABLE screens (
  n INTEGER PRIMARY KEY,
  screen_id TEXT NOT NULL
);
CREATE TABLE spans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  budget_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  parent_id TEXT,
  start_ms REAL NOT NULL,
  end_ms REAL NOT NULL
);
`;

export interface Mark {
  name: string;
  budgetId: string;
  traceId: string;
  durMs: number;
  parentId?: string;
}

interface SpanSql {
  id: string;
  name: string;
  budget_id: string;
  trace_id: string;
  parent_id: string | null;
  start_ms: number;
  end_ms: number;
}

export class HeadlessClient {
  readonly db: DatabaseSync;
  readonly clock: FakeClock;
  readonly deviceId: string;
  private seq = 1;
  private insertSpan: StatementSync;
  private insertScreen: StatementSync;
  private countConn: StatementSync;
  private countScreens: StatementSync;
  private readSpans: StatementSync;

  constructor(opts?: { clock?: FakeClock; deviceId?: string; db?: DatabaseSync }) {
    this.deviceId = opts?.deviceId ?? "dev_headless";
    this.clock = opts?.clock ?? createClock(0);
    this.db = opts?.db ?? new DatabaseSync(":memory:");
    this.db.exec(SCHEMA);
    this.db.prepare("INSERT INTO connection (id, device_id) VALUES (1, ?)").run(this.deviceId);
    this.insertSpan = this.db.prepare("INSERT INTO spans (id, name, budget_id, trace_id, parent_id, start_ms, end_ms) VALUES (?, ?, ?, ?, ?, ?, ?)");
    this.insertScreen = this.db.prepare("INSERT INTO screens (screen_id) VALUES (?)");
    this.countConn = this.db.prepare("SELECT COUNT(*) AS n FROM connection");
    this.countScreens = this.db.prepare("SELECT COUNT(*) AS n FROM screens");
    this.readSpans = this.db.prepare("SELECT id, name, budget_id, trace_id, parent_id, start_ms, end_ms FROM spans ORDER BY start_ms, id");
  }

  /** Server gauge ws.connections for this device. The table rejects a second row. */
  get connectionCount(): number {
    const row = this.countConn.get() as { n: number } | undefined;
    return row?.n ?? 0;
  }

  get screenCount(): number {
    const row = this.countScreens.get() as { n: number } | undefined;
    return row?.n ?? 0;
  }

  /** Opens a screen on the existing socket. */
  openScreen(screenId: string): void {
    if (screenId.length === 0) throw new Error("screen id required");
    this.insertScreen.run(screenId);
  }

  /** Records a span and advances the fake clock by durMs. */
  mark(input: Mark): Span {
    if (!Number.isFinite(input.durMs) || input.durMs < 0) throw new RangeError("span duration must be a finite number >= 0");
    const startMs = this.clock.now();
    const endMs = this.clock.advance(input.durMs);
    const id = `sp_${this.seq}`;
    this.seq += 1;
    const parentId = input.parentId ?? null;
    this.insertSpan.run(id, input.name, input.budgetId, input.traceId, parentId, startMs, endMs);
    return { id, name: input.name, budgetId: input.budgetId, traceId: input.traceId, parentId, startMs, endMs };
  }

  spans(): Span[] {
    const rows = this.readSpans.all() as SpanSql[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      budgetId: row.budget_id,
      traceId: row.trace_id,
      parentId: row.parent_id === null ? null : row.parent_id,
      startMs: row.start_ms,
      endMs: row.end_ms,
    }));
  }

  close(): void {
    this.db.close();
  }
}
