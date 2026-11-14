-- state (contract P2): what one person has done with one thing, kept apart from the thing. Made here by migration, never at first use.
-- A row of state_person exists only once there is something to say (an arrival, a flag); no row means read, open, not starred, not followed, not muted.

-- The thing's newest position (`head`) and the badge it counts in. Made when the first entry arrives.
CREATE TABLE IF NOT EXISTS state_thing (
  "type" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "head" INTEGER NOT NULL DEFAULT 0,
  "head_at" INTEGER,
  "scope_type" TEXT NOT NULL,
  "scope_id" TEXT NOT NULL DEFAULT '',
  PRIMARY KEY ("type", "id")
);
CREATE INDEX IF NOT EXISTS state_thing__scope ON state_thing ("scope_type", "scope_id");

-- One person on one thing. `read_upto` is a position, `unread` the cached number of entries after it that someone else wrote.
-- `hidden`: the person lost access; the row keeps its flags but leaves every list and badge until access comes back.
-- `version`, `updated_at` and `deleted_at` are the synced-entity columns (the pattern of spaces_star); deleted_at stays empty until the replica step.
CREATE TABLE IF NOT EXISTS state_person (
  "person" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "read_upto" INTEGER NOT NULL DEFAULT 0,
  "unread" INTEGER NOT NULL DEFAULT 0,
  "done_at" INTEGER,
  "starred_at" INTEGER,
  "follow" TEXT,
  "alert" INTEGER NOT NULL DEFAULT 0,
  "muted_until" INTEGER,
  "scope_type" TEXT NOT NULL,
  "scope_id" TEXT NOT NULL DEFAULT '',
  "hidden" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER,
  PRIMARY KEY ("person", "type", "id")
);
-- the Unread filter and the badges
CREATE INDEX IF NOT EXISTS state_person__unread ON state_person ("person", "scope_type", "scope_id", "unread") WHERE "unread" > 0 AND "done_at" IS NULL;
-- the Done list, and the anti-join that keeps done things out of Open
CREATE INDEX IF NOT EXISTS state_person__done ON state_person ("person", "done_at") WHERE "done_at" IS NOT NULL;
CREATE INDEX IF NOT EXISTS state_person__starred ON state_person ("person", "starred_at") WHERE "starred_at" IS NOT NULL;
CREATE INDEX IF NOT EXISTS state_person__follow ON state_person ("person", "follow") WHERE "follow" IS NOT NULL;
-- the sweep that clears a mute once its time has passed
CREATE INDEX IF NOT EXISTS state_person__muted ON state_person ("muted_until") WHERE "muted_until" IS NOT NULL;
-- who follows a thing, and every row of a thing (recount, merge, forget)
CREATE INDEX IF NOT EXISTS state_person__thing ON state_person ("type", "id");
-- gain and lose: every row of one person in one scope
CREATE INDEX IF NOT EXISTS state_person__scope ON state_person ("person", "scope_type", "scope_id");

-- A badge: how many things have something unread (not done, not muted), and how many entries that is. One primary-key read.
CREATE TABLE IF NOT EXISTS state_count (
  "person" TEXT NOT NULL,
  "scope_type" TEXT NOT NULL,
  "scope_id" TEXT NOT NULL DEFAULT '',
  "things" INTEGER NOT NULL DEFAULT 0,
  "entries" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("person", "scope_type", "scope_id")
);
