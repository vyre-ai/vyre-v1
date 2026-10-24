// @reads /modules/sync/migrations/0001_pull.sql
// sync.changes (ARCH 5.1): the change feed pull scans and the server's own copy of each row. Inline, in the append transaction, rebuildable from the log.
// The seen marks, epochs and snapshot sessions are server state, not derived from the log, so a rebuild leaves them alone.
import { readFileSync } from "node:fs";
import type { InlineProjection } from "../../kernel/src/store/projection.ts";
import { foldEvent } from "../../sync/src/server/pull/fold.ts";
import type { OwnerFieldOf } from "../../sync/src/server/pull/fold.ts";

export const PULL_SCHEMA = readFileSync(new URL("./migrations/0001_pull.sql", import.meta.url), "utf8");

/** The events the sync lane reads. Record events come from the kernel store; `sync.row` and `sync.row_rescan` are for any module's own entities. */
export const SYNC_EVENTS = ["record.created", "record.updated", "record.removed", "record.restored", "sync.row", "sync.row_rescan"] as const;

export function syncChanges(ownerFieldOf: OwnerFieldOf): InlineProjection {
  const on: InlineProjection["on"] = {};
  for (const type of SYNC_EVENTS) on[type] = (tx, e) => { foldEvent(tx, e, ownerFieldOf); };
  return {
    name: "sync.changes", version: 1, mode: "inline", rebuild: "replay",
    init(tx) { tx.exec(PULL_SCHEMA); },
    reset(tx) { tx.exec("DELETE FROM sync_changes; DELETE FROM sync_rows;"); },
    on,
  };
}
