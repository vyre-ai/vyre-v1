// Event index for the trace view (ARCH 4.9: "logs.db + events.db joined by trace id").
// An async consumer folds every event into logs_event: sequence, trace id, type, time, actor and entity. No payload is copied.
// The trace view reads that table, so logs.trace never touches the event log itself. Replay is idempotent (INSERT OR REPLACE on seq).
import type { StoredEvent } from "../../kernel/src/log/types.ts";
import type { AsyncConsumer, ProjectionDef, Tx } from "../../kernel/src/store/projection.ts";

/** Same statement as migrations/0001_init.sql; a test keeps the two equal. */
export const EVENT_DDL = `CREATE TABLE IF NOT EXISTS logs_event (
  seq INTEGER PRIMARY KEY,
  trace_id TEXT NOT NULL,
  type TEXT NOT NULL,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  entity TEXT
);
CREATE INDEX IF NOT EXISTS logs_event_trace ON logs_event(trace_id, seq);`;

const INSERT = "INSERT OR REPLACE INTO logs_event (seq, trace_id, type, at, actor, entity) VALUES (?, ?, ?, ?, ?, ?)";

/** `record/rec_x` when the event names an entity id, the bare entity type when it does not, null when it names neither. */
export function entityOf(e: Pick<StoredEvent, "entity" | "entity_id">): string | null {
  if (!e.entity) return null;
  return e.entity_id ? `${e.entity}/${e.entity_id}` : e.entity;
}

export function foldEvent(tx: Tx, e: StoredEvent): void {
  tx.run(INSERT, e.seq, e.trace_id, e.type, e.at, e.actor, entityOf(e));
}

/** Every event type is indexed, so `on` answers for any name instead of listing the 598. */
const everyEvent: Record<string, (tx: Tx, e: StoredEvent) => void> = new Proxy({} as Record<string, (tx: Tx, e: StoredEvent) => void>, {
  get: (_target, name) => (typeof name === "string" ? foldEvent : undefined),
});

export const logsEvents: AsyncConsumer = {
  name: "logs.events",
  version: 1,
  mode: "async",
  rebuild: "replay",
  init(tx) { tx.exec(EVENT_DDL); },
  reset(tx) { tx.exec("DELETE FROM logs_event"); },
  on: everyEvent,
};

export const projections: ProjectionDef[] = [logsEvents];
export const inline = {};
export const consumers = { "logs.events": logsEvents };
