// Classification and access can narrow which FIELDS of a still-visible row a device may hold. The feed cannot say so: a patch omits a field, it never removes one, and the rescan that follows an access
// change only revisits rows that became wholly visible or hidden. So a device keeps whatever it cached under the old rules. This guard names, per (person, device), the fields it was last allowed to
// hold back (`sync_class_sig`), and when a field that was cached is now held back, or the server has no record of what the device was allowed (a replica from before this guard), the device is purged:
// the person's epoch rises, the seen marks go, and the replica comes back through a snapshot cut under the current rules. Conservative on purpose: a purge costs a resync, a stale field costs a leak.
// The epoch is the PERSON's, so every device of that person resnapshots, not only the narrowed one: a device scope exists only for revocation (a revoked device is refused for good), and the person's other devices
// may hold the same cached field.
import type { Tx } from "../../../../kernel/src/store/projection.ts";
import type { PullDeps } from "./pull.ts";
import type { Viewer, Who } from "./scope.ts";

const DDL =
  "CREATE TABLE IF NOT EXISTS sync_class_sig (person TEXT NOT NULL, device TEXT NOT NULL, sig TEXT NOT NULL, PRIMARY KEY (person, device)) WITHOUT ROWID";
const ready = new WeakSet<object>();
function ensure(db: Tx): void {
  if (ready.has(db)) return;
  db.exec(DDL);
  ready.add(db);
}

/**
 * The entities that have rows: read from the table when the access stamp has moved (or after a minute), not on every pull. `SELECT DISTINCT entity FROM sync_rows` walks the whole index, and the live
 * stream asks at every commit (4.7 s of a 60 s profile on a Space of 280,000 rows). An entity that gets its first row is looked at by the next read; its default configuration holds back what the
 * catalog says, and a field hidden by a grant or a label moves the access stamp.
 */
const ENTITIES_TTL_MS = 60_000;
const entityCache = new WeakMap<object, Map<string, { stamp: string; at: number; keys: string[] }>>();
function rowEntities(d: PullDeps, viewer: Viewer): string[] {
  const stamp = String(d.cache.stamp(viewer.who.person, viewer.now));
  let per = entityCache.get(d.db);
  if (!per) entityCache.set(d.db, (per = new Map()));
  const have = per.get(viewer.who.person);
  if (have && have.stamp === stamp && viewer.now - have.at < ENTITIES_TTL_MS && viewer.now >= have.at) return have.keys;
  const keys = d.db.all<{ entity: string }>("SELECT DISTINCT entity FROM sync_rows").map((r) => r.entity);
  per.set(viewer.who.person, { stamp, at: viewer.now, keys });
  return keys;
}

/** Entity to the fields this person on this device is held back from (grant hiddenFields, fields labelled above the ceiling), for every entity the server knows. */
export function heldBack(d: PullDeps, viewer: Viewer): Record<string, string[]> {
  const keys = new Set<string>(d.catalog.known().map((e) => e.key));
  for (const k of d.catalog.classified?.() ?? []) keys.add(k);
  for (const k of rowEntities(d, viewer)) keys.add(k);
  const out: Record<string, string[]> = {};
  const granted = d.cache.hiddenByGrants(viewer.who.person, viewer.now);
  for (const key of [...keys].sort()) {
    const cfg = d.catalog.get(key);
    if (cfg.profile[viewer.who.deviceClass] === "none") continue;
    const sc = viewer.scope(cfg);
    const fields = new Set<string>(sc.hidden);
    // a grant on a record type or an ancestor can hide a field of any row it reaches; which rows it reaches is decided per row, so the device is treated as held back from it on every entity of that access resource
    if (cfg.resource === "record") for (const f of granted) fields.add(f);
    for (const [f, rank] of Object.entries(cfg.fieldLabels)) if (rank > sc.cap) fields.add(f);
    if (fields.size) out[key] = [...fields].sort();
  }
  return out;
}

const holds = (db: Tx, who: Who, entity: string): boolean =>
  db.get<{ n: number }>(
    "SELECT 1 AS n FROM sync_seen_rows WHERE person = ? AND device = ? AND entity = ? LIMIT 1",
    who.person,
    who.device,
    entity,
  ) !== undefined;

const save = (db: Tx, who: Who, sig: string): void => {
  db.run(
    "INSERT INTO sync_class_sig (person, device, sig) VALUES (?, ?, ?) ON CONFLICT(person, device) DO UPDATE SET sig = excluded.sig",
    who.person,
    who.device,
    sig,
  );
};

/** Remember what this device is held back from. A snapshot calls it: the device then starts from nothing under the current rules. */
export function recordHeldBack(d: PullDeps, who: Who, viewer: Viewer): void {
  ensure(d.db);
  save(d.db, who, JSON.stringify(heldBack(d, viewer)));
}

/**
 * Before a pull returns data: true when this device holds a field it may no longer hold (so it must purge and resnapshot; the person's epoch has been raised and the marks cleared), false when it
 * may carry on. Always leaves the current signature stored for a device that carries on.
 */
export function purgeIfNarrowed(d: PullDeps, who: Who, viewer: Viewer): boolean {
  const db = d.db;
  ensure(db);
  const now = heldBack(d, viewer);
  const sig = JSON.stringify(now);
  const stored = db.get<{ sig: string }>(
    "SELECT sig FROM sync_class_sig WHERE person = ? AND device = ?",
    who.person,
    who.device,
  )?.sig;
  if (stored === sig) return false;
  let was: Record<string, string[]> = {};
  if (stored !== undefined) {
    try {
      was = JSON.parse(stored) as Record<string, string[]>;
    } catch {
      was = {};
    }
  }
  let narrowed = false;
  for (const [entity, fields] of Object.entries(now)) {
    if (stored !== undefined && fields.every((f) => (was[entity] ?? []).includes(f))) continue;
    if (holds(db, who, entity)) {
      narrowed = true;
      break;
    }
  }
  if (!narrowed) {
    save(db, who, sig);
    return false;
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    db.run(
      "INSERT INTO sync_epoch (person, epoch) VALUES (?, ?) ON CONFLICT(person) DO UPDATE SET epoch = epoch + 1",
      who.person,
      1,
    );
    db.run("DELETE FROM sync_seen_rows WHERE person = ?", who.person);
    db.run("DELETE FROM sync_snapshots WHERE person = ?", who.person);
    db.run("DELETE FROM sync_class_sig WHERE person = ?", who.person);
    db.exec("COMMIT");
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* keep the first failure */
    }
    throw e;
  }
  return true;
}
