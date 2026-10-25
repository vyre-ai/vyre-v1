// Server half of purge (ARCH 5.7). Two jobs.
//   bumpEpoch   raises a person's sync epoch (device revoked, person suspended or removed, password reset, clearance lowered, key rotation). Every replica of that person below the new epoch gets
//               `reset: "purge"` on its next pull or hello, and every live connection gets a `purge` frame now. The seen marks go too, so the next snapshot starts from nothing.
//   reindexScope  after a grant, revoke or label change, asks pull to look again at the rows that may have changed hands. The `sync.row_rescan` events enter the log, so every device that held a row
//               and may no longer see it gets a `hide` on its next pull or `ev` frame (pull compares the device's seen mark with what the person may see now).
// DECISION (ruling 35): three scopes, so a purge reaches only the devices that must wipe.
//   device  (reason device_revoked): only that device wipes. Its own epoch rises in sync_device_epoch; the person's epoch and every other device are untouched.
//   person  (suspended, removed, password_reset, clearance_lowered): every device of the person wipes. The person's sync_epoch rises.
//   space   (key_rotation, which comes with a person leaving a Space): the Space's key epoch rises in sync_space_epoch and the leaving person's own epoch rises, so the leaver wipes while the
//           members who stay keep their replicas (their data is re-encrypted lazily under the new key).
// What a device must present is `effectiveEpoch` = max(person epoch, device epoch). The pull and hello paths still read the person epoch alone (sync/src/server/pull/pull.ts, modules/sync/handlers/live.ts);
// they must call effectiveEpoch(db, person, device) for the device scope to take effect on a pull. That edit is outside this packet and is asked of the lead in the packet comment.
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
  /** The live hub's targeted purge: frame and close only this device's connections. Returns how many. */
  purgeDevice?(person: string, device: string, epoch: number): number;
}

export type BumpScope = "device" | "person" | "space";
const SCOPE_OF: Record<BumpReason, BumpScope> = {
  device_revoked: "device", suspended: "person", removed: "person", password_reset: "person", clearance_lowered: "person", key_rotation: "space",
};
export const scopeOf = (reason: BumpReason): BumpScope => SCOPE_OF[reason];

const EPOCH_TABLES = `
CREATE TABLE IF NOT EXISTS sync_device_epoch (person TEXT NOT NULL, device TEXT NOT NULL, epoch INTEGER NOT NULL, PRIMARY KEY (person, device)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sync_space_epoch (id INTEGER PRIMARY KEY CHECK (id = 1), epoch INTEGER NOT NULL);`;

/** The epoch a device must present: its person's, or its own if that is higher. */
export function effectiveEpoch(db: Tx, person: string, device: string): number {
  db.exec(EPOCH_TABLES);
  const own = db.get<{ epoch: number }>("SELECT epoch FROM sync_device_epoch WHERE person = ? AND device = ?", person, device)?.epoch ?? 0;
  return Math.max(epochOf(db, person), own);
}

/** The Space data key epoch (rises when a member leaves). */
export function spaceEpoch(db: Tx): number {
  db.exec(EPOCH_TABLES);
  return db.get<{ epoch: number }>("SELECT epoch FROM sync_space_epoch WHERE id = 1")?.epoch ?? 0;
}

export type BumpReason = "device_revoked" | "suspended" | "removed" | "password_reset" | "clearance_lowered" | "key_rotation";
export interface BumpInput { personId: string; reason: BumpReason; deviceId?: string }
export interface BumpResult { epoch: number; closed: number; scope: BumpScope }

export function bumpEpoch(d: PurgeServerDeps, input: BumpInput, traceId: string, actor: string): BumpResult {
  const db = d.db;
  const scope = scopeOf(input.reason);
  if (scope === "device" && !input.deviceId) throw new Error("a device purge names the device");
  db.exec(EPOCH_TABLES);
  let epoch = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    const person = epochOf(db, input.personId);
    if (scope === "device") {
      const own = db.get<{ epoch: number }>("SELECT epoch FROM sync_device_epoch WHERE person = ? AND device = ?", input.personId, input.deviceId)?.epoch ?? 0;
      // Above anything the device can hold: its own last epoch and the person's.
      epoch = Math.max(person, own) + 1;
      db.run("INSERT INTO sync_device_epoch (person, device, epoch) VALUES (?, ?, ?) ON CONFLICT(person, device) DO UPDATE SET epoch = excluded.epoch", input.personId, input.deviceId, epoch);
      db.run("DELETE FROM sync_seen_rows WHERE person = ? AND device = ?", input.personId, input.deviceId);
      db.run("DELETE FROM sync_snapshots WHERE person = ? AND device = ?", input.personId, input.deviceId);
    } else {
      epoch = person + 1;
      db.run("INSERT INTO sync_epoch (person, epoch) VALUES (?, ?) ON CONFLICT(person) DO UPDATE SET epoch = excluded.epoch", input.personId, epoch);
      db.run("DELETE FROM sync_seen_rows WHERE person = ?", input.personId);
      db.run("DELETE FROM sync_snapshots WHERE person = ?", input.personId);
      if (scope === "space") db.run("INSERT INTO sync_space_epoch (id, epoch) VALUES (1, 1) ON CONFLICT(id) DO UPDATE SET epoch = epoch + 1");
    }
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
    closed = scope === "device" ? (d.purgeDevice?.(input.personId, input.deviceId as string, epoch) ?? 0) : d.purgeLive(input.personId, epoch);
  }
  return { epoch, closed, scope };
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
