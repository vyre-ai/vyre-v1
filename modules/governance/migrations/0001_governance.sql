-- governance: holds on files, channels, threads, folders and people; the retention jobs' last and next run; erase findings (item ids only, kept 24 hours); erasures and the tombstones a restore replays.
-- Nothing here holds a name, an address or a value: ids and kinds only.

CREATE TABLE IF NOT EXISTS gov_hold (
  "kind" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "by" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  PRIMARY KEY ("kind", "targetId")
);

CREATE TABLE IF NOT EXISTS gov_job (
  "kind" TEXT PRIMARY KEY,
  "lastRunAt" INTEGER,
  "nextRunAt" INTEGER,
  "lastRemoved" INTEGER,
  "lastSkippedOnHold" INTEGER,
  "state" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gov_finding (
  "id" TEXT PRIMARY KEY,
  "by" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  "expiresAt" INTEGER NOT NULL,
  "recordIds" TEXT NOT NULL,
  "items" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gov_erase (
  "findingId" TEXT PRIMARY KEY,
  "by" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  "kinds" TEXT NOT NULL,
  "tombstones" INTEGER NOT NULL,
  "runId" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gov_tombstone (
  "id" TEXT PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "subjectType" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  "by" TEXT NOT NULL,
  "findingId" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gov_state (
  "key" TEXT PRIMARY KEY,
  "value" TEXT NOT NULL
);
