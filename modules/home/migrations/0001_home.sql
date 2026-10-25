-- Home tables (P-L6_09, spec 3.1, ARCH 7.1). home_digests and home_digests__fm repeat generated/modules/home/schema.sql exactly (IF NOT EXISTS), so either CREATE can run first;
-- home_idem holds the idempotency keys of home.write_digest.

CREATE TABLE IF NOT EXISTS "home_digests" (
  "id" TEXT PRIMARY KEY,
  "person" TEXT,
  "period_start" INTEGER,
  "period_end" INTEGER,
  "headline" TEXT,
  "items" TEXT,
  "seen_at" INTEGER,
  "built_by" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);
CREATE TABLE IF NOT EXISTS "home_digests__fm" (
  "id" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "hlc" TEXT NOT NULL,
  "actor" TEXT,
  "seq" INTEGER,
  PRIMARY KEY ("id", "field")
);
CREATE INDEX IF NOT EXISTS "home_digests__owner" ON "home_digests" ("person");
CREATE INDEX IF NOT EXISTS "home_digests_person_end" ON "home_digests" ("person", "period_end");

CREATE TABLE IF NOT EXISTS "home_idem" (
  "idem_key" TEXT PRIMARY KEY,
  "digest_id" TEXT NOT NULL
);
