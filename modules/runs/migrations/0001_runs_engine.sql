-- Runs engine tables (P-L6_03, ARCH 4.7, 7.7). runs_items and runs_items__fm repeat generated/modules/runs/schema.sql exactly (IF NOT EXISTS), so either CREATE can run first;
-- the tables below hold the durable step log, the waits, the idempotent start keys and the per-run facts the Run row has no column for.

CREATE TABLE IF NOT EXISTS "runs_items" (
  "id" TEXT PRIMARY KEY,
  "kind" TEXT,
  "name" TEXT,
  "owner" TEXT,
  "started_by" TEXT,
  "subject" TEXT,
  "status" TEXT,
  "wait_reason" TEXT,
  "definition_version" REAL,
  "key_used" TEXT,
  "model_used" TEXT,
  "cost_micros" REAL,
  "started_at" INTEGER,
  "ended_at" INTEGER,
  "parent_run" TEXT,
  "thread_id" TEXT,
  "trace_id" TEXT,
  "summary" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);
CREATE TABLE IF NOT EXISTS "runs_items__fm" (
  "id" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "hlc" TEXT NOT NULL,
  "actor" TEXT,
  "seq" INTEGER,
  PRIMARY KEY ("id", "field")
);
CREATE INDEX IF NOT EXISTS "runs_items__owner" ON "runs_items" ("owner");


-- One row per step attempt: the durable step log. idem_key is run:step:attempt, so a replayed attempt reuses the key and a provider can dedupe.
-- ord is the order a step was first seen; recovery resumes at the first step whose latest attempt is not terminal.
CREATE TABLE IF NOT EXISTS "runs_steps" (
  "run_id" TEXT NOT NULL,
  "step" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL,
  "ord" INTEGER NOT NULL,
  "state" TEXT NOT NULL,
  "branch" TEXT,
  "input_ref" TEXT,
  "output_ref" TEXT,
  "input_json" TEXT,
  "output_json" TEXT,
  "error_code" TEXT,
  "error_message" TEXT,
  "idem_key" TEXT NOT NULL,
  "retry_at" INTEGER,
  "next_step" TEXT,
  "ended_next" INTEGER NOT NULL DEFAULT 0,
  "started_at" INTEGER,
  "ended_at" INTEGER,
  "trace_span" TEXT,
  PRIMARY KEY ("run_id", "step", "attempt")
);
CREATE INDEX IF NOT EXISTS "runs_steps_run" ON "runs_steps" ("run_id", "ord");

-- A Run that waits: for an approval (task), background work, a key, an event, another Run or a time. until_at is the timeout.
CREATE TABLE IF NOT EXISTS "runs_waits" (
  "run_id" TEXT PRIMARY KEY,
  "reason" TEXT NOT NULL,
  "on_json" TEXT,
  "cancel_on" TEXT,
  "until_at" INTEGER,
  "task_id" TEXT,
  "label" TEXT,
  "created_at" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "runs_waits_until" ON "runs_waits" ("until_at");

-- Facts about a Run that the contract row does not carry.
CREATE TABLE IF NOT EXISTS "runs_extra" (
  "run_id" TEXT PRIMARY KEY,
  "error_code" TEXT,
  "error_message" TEXT,
  "error_step" TEXT,
  "stop_reason" TEXT,
  "stopped_by" TEXT,
  "retry_of" TEXT,
  "from_step" TEXT,
  "replay_of" TEXT,
  "replay_version" TEXT,
  "undone_at" INTEGER,
  "consecutive" INTEGER
);

-- runs.start is idempotent by key.
CREATE TABLE IF NOT EXISTS "runs_idem" (
  "idem_key" TEXT PRIMARY KEY,
  "run_id" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "runs_items_status" ON "runs_items" ("status");
CREATE INDEX IF NOT EXISTS "runs_items_started" ON "runs_items" ("started_at");
CREATE INDEX IF NOT EXISTS "runs_items_subject" ON "runs_items" ("subject");
