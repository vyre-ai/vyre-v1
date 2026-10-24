-- Tasks state tables (P-L6_01, ARCH 4.7).
-- tasks_meta matches generated/modules/tasks/schema.sql exactly so either CREATE runs first.
-- tasks_core holds the record-level fields (title, state, links). The record type `task` is declared by module projects; until that lands the task row lives here.
-- The columns of tasks_meta that hold JSON (assigned, reviewer, approver, blocks, depends_on, followers, working_notes) store one JSON text.

CREATE TABLE IF NOT EXISTS "tasks_meta" (
  "id" TEXT PRIMARY KEY,
  "kind" TEXT,
  "assigned" TEXT,
  "reviewer" TEXT,
  "approver" TEXT,
  "taken_by" TEXT,
  "taken_at" INTEGER,
  "snoozed_until" INTEGER,
  "why" TEXT,
  "blocks" TEXT,
  "source_kind" TEXT,
  "source_id" TEXT,
  "parent_task" TEXT,
  "depends_on" TEXT,
  "followers" TEXT,
  "working_notes" TEXT,
  "review_loops" REAL,
  "decision_id" TEXT,
  "payload_hash" TEXT,
  "expires_at" INTEGER,
  "due" INTEGER,
  "effort" REAL,
  "thread_id" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);
CREATE TABLE IF NOT EXISTS "tasks_meta__fm" (
  "id" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "hlc" TEXT NOT NULL,
  "actor" TEXT,
  "seq" INTEGER,
  PRIMARY KEY ("id", "field")
);
CREATE INDEX IF NOT EXISTS "tasks_meta__owner" ON "tasks_meta" ("assigned");

CREATE TABLE IF NOT EXISTS "tasks_core" (
  "id" TEXT PRIMARY KEY,
  "title" TEXT NOT NULL,
  "summary" TEXT,
  "state" TEXT NOT NULL,
  "actions" TEXT NOT NULL DEFAULT '[]',
  "file_ids" TEXT NOT NULL DEFAULT '[]',
  "record_id" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "handled_by" TEXT,
  "handled_at" INTEGER,
  "responsible" TEXT
);
CREATE INDEX IF NOT EXISTS "tasks_core_state" ON "tasks_core" ("state");
CREATE INDEX IF NOT EXISTS "tasks_core_record" ON "tasks_core" ("record_id");
CREATE INDEX IF NOT EXISTS "tasks_core_creator" ON "tasks_core" ("created_by");

CREATE INDEX IF NOT EXISTS "tasks_meta_source" ON "tasks_meta" ("source_kind", "source_id");
CREATE INDEX IF NOT EXISTS "tasks_meta_parent" ON "tasks_meta" ("parent_task");

-- One row per event a task capability emitted, for tasks.history. event_id is the id ctx.emit returned.
CREATE TABLE IF NOT EXISTS "tasks_history" (
  "id" TEXT PRIMARY KEY,
  "task_id" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "note" TEXT,
  "event_id" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "tasks_history_task" ON "tasks_history" ("task_id", "at");

-- Space policy values for the three tasks.* settings; a missing row means the default of the manifest.
CREATE TABLE IF NOT EXISTS "tasks_policy" (
  "policy_key" TEXT PRIMARY KEY,
  "policy_value" TEXT NOT NULL
);
