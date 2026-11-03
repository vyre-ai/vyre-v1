-- The cursor of the log events folded into the access store is this computer's own: a sequence number of its own log. It lives here, a table that never travels between the computers of a
-- Personal Space (host/src/peers/sync.ts LOCAL), not in access_fields, which does: a cursor copied from another computer's log made this one skip its own events at or below it.
CREATE TABLE IF NOT EXISTS "access_local_cursor" (
  "id" TEXT PRIMARY KEY,
  "seq" INTEGER NOT NULL
);
INSERT OR IGNORE INTO "access_local_cursor" ("id", "seq") SELECT "k", "rank" FROM "access_fields" WHERE "k" = 'seed_cursor';
DELETE FROM "access_fields" WHERE "k" = 'seed_cursor';
