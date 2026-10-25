-- Spaces tables (P-L7_07). Star and follow match generated/modules/spaces/schema.sql so either CREATE runs first.

CREATE TABLE IF NOT EXISTS "spaces_profile" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "logo_file_id" TEXT,
  "kind" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "spaces_follow" (
  "id" TEXT PRIMARY KEY,
  "person" TEXT,
  "resourceType" TEXT,
  "resourceId" TEXT,
  "createdAt" INTEGER,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);
CREATE INDEX IF NOT EXISTS "spaces_follow__owner" ON "spaces_follow" ("person");

CREATE TABLE IF NOT EXISTS "spaces_star" (
  "id" TEXT PRIMARY KEY,
  "person" TEXT,
  "resourceType" TEXT,
  "resourceId" TEXT,
  "createdAt" INTEGER,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);
CREATE INDEX IF NOT EXISTS "spaces_star__owner" ON "spaces_star" ("person");

-- first-run checklist: one row per finished step, one row per person who dismissed it
CREATE TABLE IF NOT EXISTS "spaces_onboarding" (
  "person" TEXT NOT NULL,
  "step" TEXT NOT NULL,
  "done_at" INTEGER NOT NULL,
  PRIMARY KEY ("person", "step")
);
CREATE TABLE IF NOT EXISTS "spaces_onboarding_state" (
  "person" TEXT PRIMARY KEY,
  "dismissed_at" INTEGER NOT NULL
);
