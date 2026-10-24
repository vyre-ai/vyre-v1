// Server half of purge (ARCH 5.7). Two jobs.
//   bumpEpoch   raises a person's sync epoch (device revoked, person suspended or removed, password reset, clearance lowered, key rotation). Every replica of that person below the new epoch gets
//               `reset: "purge"` on its next pull or hello, and every live connection gets a `purge` frame now. The seen marks go too, so the next snapshot starts from nothing.
//   reindexScope  after a grant, revoke or label change, asks pull to look again at the rows that may have changed hands. The `sync.row_rescan` events enter the log, so every device that held a row
//               and may no longer see it gets a `hide` on its next pull or `ev` frame (pull compares the device's seen mark with what the person may see now).
// DECISION: the epoch is per person, as the sync_epoch table is. Revoking one device raises the person's epoch, so the person's other devices purge once and take a fresh snapshot; a revoked device
// cannot sign in again, so it never gets that far. This costs a resync on healthy devices in exchange for one rule with no case where a revoked device keeps an old epoch that still works.
import type { Tx } from "../../../kernel/src/store/projection.ts";
import type { NewEvent } from "../../../kernel/src/log/types.ts";
import type { Catalog } from "../server/pull/index.ts";
import { epochOf } from "../server/pull/index.ts";

/** Above this many rows in one entity the reindex also tells clients the range changed (sync.scope_changed). */
export const RESCAN_SUMMARY_ROWS = 100;

export interface PurgeServerDeps {
  db: Tx;
  catalog: Catalog;
  /** Append one event to the log (the sync.changes projection folds it in the same transaction). */
  append(ev: NewEvent): { seq: number };
  /** The live hub's purge: frame and close every connection of the person. Returns how many. */
  purgeLive(person: string, epoch: number): number;
}

export type BumpReason = "device_revoked" | "suspended" | "removed" | "password_reset" | "clearance_lowered" | "key_rotation";
export interface BumpInput { personId: string; reason: BumpReason; deviceId?: string }
export interface BumpResult { epoch: number; closed: number }

export function bumpEpoch(d: PurgeServerDeps, input: BumpInput, traceId: string, actor: string): BumpResult {
  const db = d.db;
  let epoch = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    epoch = epochOf(db, input.personId) + 1;
    db.run("INSERT INTO sync_epoch (person, epoch) VALUES (?, ?) ON CONFLICT(person) DO UPDATE SET epoch = excluded.epoch", input.personId, epoch);
    db.run("DELETE FROM sync_seen_rows WHERE person = ?", input.personId);
    db.run("DELETE FROM sync_snapshots WHERE person = ?", input.personId);
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* keep the first failure */ }
    throw e;
  }
  let closed = 0;
  try {
    // The epoch is already raised: even if the record of it cannot be written, the replicas purge.
    d.append({
      type: "sync.epoch_bumped", sv: 1, trace_id: traceId, actor, vis: "owner", entity: "person", entity_id: input.personId,
      payload: { personId: input.personId, epoch, reason: input.reason, ...(input.deviceId !== undefined ? { deviceId: input.deviceId } : {}) },
    });
  } finally {
    closed = d.purgeLive(input.personId, epoch);
  }
  return { epoch, closed };
}

export interface ReindexInput { resourceType: string; resourceId: string; entity?: string }
export interface ReindexResult { changed: number; scopeChanged: boolean }

/** Entities whose rows are guarded by this resource type: the catalog's, plus any entity the server holds rows for that falls back to the same type. */
function entitiesOf(d: PurgeServerDeps, input: ReindexInput): string[] {
  if (input.entity) return [input.entity];
  const keys = new Set<string>();
  for (const e of d.catalog.known()) if (e.resource === input.resourceType) keys.add(e.key);
  for (const r of d.db.all<{ entity: string }>("SELECT DISTINCT entity FROM sync_rows")) if (d.catalog.get(r.entity).resource === input.resourceType) keys.add(r.entity);
  return [...keys].sort();
}

export function reindexScope(d: PurgeServerDeps, input: ReindexInput, traceId: string, actor: string): ReindexResult {
  let changed = 0;
  let scopeChanged = false;
  for (const entity of entitiesOf(d, input)) {
    const ids = d.db.all<{ id: string }>("SELECT id FROM sync_rows WHERE entity = ? AND deleted = 0 ORDER BY id", entity);
    for (const { id } of ids) {
      d.append({ type: "sync.row_rescan", sv: 1, trace_id: traceId, actor, vis: "space", payload: { entity, id } });
      changed += 1;
    }
    if (ids.length > RESCAN_SUMMARY_ROWS) {
      scopeChanged = true;
      d.append({
        type: "sync.scope_changed", sv: 1, trace_id: traceId, actor, vis: "participants", entity,
        payload: { entity, filter: { resourceType: input.resourceType, resourceId: input.resourceId }, rows: ids.length },
      });
    }
  }
  return { changed, scopeChanged };
}
