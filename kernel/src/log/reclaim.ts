// Giving back the pages a delete freed, without ever holding the log for a whole VACUUM (a VACUUM of a 34 GB events.db stalls the one writer for minutes and needs 34 GB of free disk).
// events.db made by this version is auto_vacuum=incremental (store.ts): freed pages are handed back a slice at a time. A file made before that has no way to give pages back short of a VACUUM,
// which only the planned stopped-window command (`vyre-server compact`) does; there a delete still zeroes what it removed (secure_delete), so nothing is left to read, and the file just does not shrink.
import type { DatabaseSync } from "node:sqlite";

/** Pages handed back per step: a step is a few milliseconds. */
export const RECLAIM_STEP = 256;

/** True when the file gives pages back by itself (auto_vacuum = incremental). */
export function canReclaim(db: DatabaseSync): boolean {
  return Number((db.prepare("PRAGMA auto_vacuum").get() as { auto_vacuum: number }).auto_vacuum) === 2;
}

/** The pages on the free list now. */
export function freePages(db: DatabaseSync): number {
  return Number((db.prepare("PRAGMA freelist_count").get() as { freelist_count: number }).freelist_count);
}

/** Hand back at most `pages` free pages. Returns how many are still free (0 for a file that cannot give pages back). */
export function reclaimStep(db: DatabaseSync, pages: number = RECLAIM_STEP): number {
  if (!canReclaim(db)) return 0;
  db.exec(`PRAGMA incremental_vacuum(${Math.max(1, Math.trunc(pages))})`);
  return freePages(db);
}

/** A file this small may still be vacuumed whole when it cannot give pages back by itself: a few seconds. */
export const SMALL_FILE_BYTES = 1024 * 1024 * 1024;

/**
 * After an erase (a person's words removed from the log, an agent's answers forgotten): make sure no copy of what was removed stays in the file. The WAL is folded in; a file that gives pages back by itself
 * has every free page handed back (the bytes leave the file); an older file is vacuumed whole only when it is small. A big older file keeps zeroed pages (secure_delete) but cannot shed them without a stopped
 * window, so `scrubbed` says false and the caller records that the planned compact (`vyre-server compact`) is still owed. Never a VACUUM of a big live log.
 */
export function scrubAfterErase(db: DatabaseSync): { scrubbed: boolean } {
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  if (canReclaim(db)) {
    while (reclaimStep(db, 4096) > 0) {
      /* each step is a few milliseconds of the log's time */
    }
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    return { scrubbed: true };
  }
  const pages = Number((db.prepare("PRAGMA page_count").get() as { page_count: number }).page_count);
  const size = pages * Number((db.prepare("PRAGMA page_size").get() as { page_size: number }).page_size);
  if (size > SMALL_FILE_BYTES) return { scrubbed: false };
  db.exec("VACUUM");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  return { scrubbed: true };
}
