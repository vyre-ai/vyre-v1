-- The Run node (r42-runtime, DESIGN-r42-runtime.md sections 3 to 7): one row per unit of agent work (a turn, a helper, a subagent, a handoff, a teammate ask, a watcher, a terminal command, a job, an MCP-started run),
-- in a tree under root_run. Not part of runs_items: that table is a synced entity with a window of recent rows, and agent work would crowd the automation runs out of it.
CREATE TABLE IF NOT EXISTS "runs_node" (
  "run_id" TEXT PRIMARY KEY,
  "root_run" TEXT NOT NULL,
  "parent_run" TEXT,
  "depth" INTEGER NOT NULL DEFAULT 0,
  "kind" TEXT NOT NULL,
  "name" TEXT,
  "owner" TEXT NOT NULL,
  "started_by" TEXT NOT NULL,
  "who_kind" TEXT NOT NULL,
  "who_id" TEXT,
  "engine" TEXT,
  "model" TEXT,
  "thread_id" TEXT,
  "status" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "brief_json" TEXT,
  "budget_json" TEXT,
  "spent_json" TEXT NOT NULL,
  "wake_json" TEXT,
  "checkpoint_json" TEXT,
  "result_json" TEXT,
  "evidence_json" TEXT,
  "origin_json" TEXT,
  "policy_json" TEXT,
  "summary" TEXT,
  "error_code" TEXT,
  "error_message" TEXT,
  "stop_reason" TEXT,
  "lease_holder" TEXT,
  "lease_until" INTEGER,
  "heartbeat_at" INTEGER,
  "idem_key" TEXT,
  "started_at" INTEGER NOT NULL,
  "ended_at" INTEGER,
  "updated_at" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "runs_node_root" ON "runs_node" ("root_run", "depth", "started_at");
CREATE INDEX IF NOT EXISTS "runs_node_parent" ON "runs_node" ("parent_run");
CREATE INDEX IF NOT EXISTS "runs_node_owner" ON "runs_node" ("owner", "status");
CREATE INDEX IF NOT EXISTS "runs_node_thread" ON "runs_node" ("thread_id");
CREATE INDEX IF NOT EXISTS "runs_node_lease" ON "runs_node" ("status", "lease_until");
CREATE UNIQUE INDEX IF NOT EXISTS "runs_node_idem" ON "runs_node" ("idem_key") WHERE "idem_key" IS NOT NULL;

-- One log per tree. seq is the cursor a reader keeps ("everything since 41"); (run_id, event_key) makes an event idempotent.
CREATE TABLE IF NOT EXISTS "runs_event" (
  "root_run" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  "run_id" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "actor" TEXT,
  "event_key" TEXT,
  "payload_json" TEXT,
  PRIMARY KEY ("root_run", "seq")
);
CREATE UNIQUE INDEX IF NOT EXISTS "runs_event_key" ON "runs_event" ("run_id", "event_key") WHERE "event_key" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "runs_event_run" ON "runs_event" ("run_id", "seq");
