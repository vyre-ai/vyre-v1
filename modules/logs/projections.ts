// Inline projection: event metadata for the trace view. Payload bytes are not copied.
import type { StoredEvent } from "../../kernel/src/log/types.ts";
import type { InlineProjection, ProjectionDef, Tx } from "../../kernel/src/store/projection.ts";

function writeIx(tx: Tx, e: StoredEvent): void {
  tx.run(
    "INSERT OR REPLACE INTO logs_event_ix (seq, trace_id, type, at, actor, entity) VALUES (?, ?, ?, ?, ?, ?)",
    e.seq, e.trace_id, e.type, e.at, e.actor, e.entity ?? null,
  );
}

export const logsEvents: InlineProjection = {
  name: "logs.events",
  version: 1,
  mode: "inline",
  rebuild: "replay",
  init(tx) {
    tx.exec(`CREATE TABLE IF NOT EXISTS logs_event_ix (
      seq INTEGER NOT NULL,
      trace_id TEXT NOT NULL,
      type TEXT NOT NULL,
      at INTEGER NOT NULL,
      actor TEXT NOT NULL,
      entity TEXT,
      PRIMARY KEY (trace_id, seq)
    )`);
  },
  reset(tx) { tx.exec("DELETE FROM logs_event_ix"); },
  on: {
    "log.accessed": writeIx,
    "client_log.uploaded": writeIx,
    "replay.started": writeIx,
    "replay.finished": writeIx,
  },
};

export const projections: ProjectionDef[] = [logsEvents];
export const inline = { "logs.events": logsEvents };
export const consumers = {};
