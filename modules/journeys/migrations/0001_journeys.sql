-- Journeys tables (P-L6_06, spec 2.12, ARCH 7.7). The module declares no entity; the Journey record itself lives in the record type each Journey creates (module records).
-- These tables hold the design and its versions, where each record stands, the tasks made for it, and the time limits already raised.

CREATE TABLE IF NOT EXISTS "journeys_defs" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "subject_type" TEXT NOT NULL,
  "record_type" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "stages" TEXT NOT NULL,
  "start_rule" TEXT,
  "start_automation_id" TEXT,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "deleted_at" INTEGER
);
CREATE INDEX IF NOT EXISTS "journeys_defs_type" ON "journeys_defs" ("record_type");

-- Every design a Journey has had. In-flight records stay on the version they started on until journeys.migrate moves them.
CREATE TABLE IF NOT EXISTS "journeys_versions" (
  "version_id" TEXT PRIMARY KEY,
  "journey_id" TEXT NOT NULL,
  "n" INTEGER NOT NULL,
  "by_who" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  "reason" TEXT,
  "name" TEXT,
  "stages" TEXT NOT NULL,
  "start_rule" TEXT,
  UNIQUE ("journey_id", "n")
);

-- One row per Journey record: which subject it follows, the version it runs on, its stage and when it entered it.
CREATE TABLE IF NOT EXISTS "journeys_records" (
  "record_id" TEXT PRIMARY KEY,
  "journey_id" TEXT NOT NULL,
  "subject_record_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "stage" TEXT NOT NULL,
  "start_stage" TEXT NOT NULL,
  "entered_at" INTEGER NOT NULL,
  "completed_at" INTEGER,
  "owner_id" TEXT NOT NULL,
  "start_key" TEXT NOT NULL,
  "channel_id" TEXT,
  "thread_id" TEXT,
  "started_at" INTEGER NOT NULL,
  UNIQUE ("journey_id", "subject_record_id"),
  UNIQUE ("start_key")
);
CREATE INDEX IF NOT EXISTS "journeys_records_journey" ON "journeys_records" ("journey_id", "stage");

-- The tasks made for a record in a stage, by the key of their template. A stage advances when its required tasks are done.
CREATE TABLE IF NOT EXISTS "journeys_tasks" (
  "record_id" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "task_key" TEXT NOT NULL,
  "entered_at" INTEGER NOT NULL,
  "task_id" TEXT NOT NULL,
  "required" INTEGER NOT NULL,
  PRIMARY KEY ("record_id", "stage", "task_key", "entered_at")
);

-- Time limits already raised for a stay in a stage, so a limit is reported once and escalated once.
CREATE TABLE IF NOT EXISTS "journeys_breaches" (
  "record_id" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "entered_at" INTEGER NOT NULL,
  "escalated" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("record_id", "stage", "entered_at")
);
