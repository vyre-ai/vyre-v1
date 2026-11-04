-- CI runners (lane l-ci-runners). The settings are one row of JSON; every run is one row; ci_meta holds small once-only markers (the month a pause was told). Every statement is one CREATE.
CREATE TABLE IF NOT EXISTS "ci_settings" (
  "key" TEXT PRIMARY KEY,
  "value" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "ci_run" (
  "run_id" TEXT PRIMARY KEY,
  "job_id" INTEGER NOT NULL UNIQUE,
  "workflow_run_id" INTEGER NOT NULL,
  "repo" TEXT NOT NULL,
  "job_name" TEXT NOT NULL,
  "project_id" TEXT,
  "state" TEXT NOT NULL,
  "droplet_id" TEXT,
  "runner_id" INTEGER,
  "size" TEXT,
  "price_hourly" REAL,
  "queued_at" INTEGER NOT NULL,
  "started_at" INTEGER,
  "ended_at" INTEGER,
  "conclusion" TEXT,
  "cost_usd" REAL NOT NULL DEFAULT 0,
  "note" TEXT
);

CREATE INDEX IF NOT EXISTS "ci_run_state" ON "ci_run" ("state", "queued_at");

CREATE INDEX IF NOT EXISTS "ci_run_repo" ON "ci_run" ("repo", "queued_at");

CREATE TABLE IF NOT EXISTS "ci_meta" (
  "key" TEXT PRIMARY KEY,
  "value" TEXT NOT NULL
)
