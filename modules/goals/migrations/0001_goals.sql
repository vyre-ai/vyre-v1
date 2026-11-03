-- Goals (lane L6). A goal row, the readings of its source, its wake-ups, its steps, the threads and tasks it owns, what waits on whom, the records it touches and its activity.
-- Every statement is one CREATE: projections.ts runs the same list one by one when a table is missing, so a test ctx and the daemon end up with the same schema.

CREATE TABLE IF NOT EXISTS "goals_goal" (
  "id" TEXT PRIMARY KEY,
  "title" TEXT NOT NULL,
  "outcome" TEXT,
  "finish" TEXT NOT NULL,
  "deadline" INTEGER NOT NULL,
  "owner" TEXT NOT NULL,
  "lead_agent" TEXT NOT NULL,
  "helpers" TEXT NOT NULL DEFAULT '[]',
  "project_id" TEXT,
  "record_ids" TEXT NOT NULL DEFAULT '[]',
  "budget" TEXT NOT NULL DEFAULT '{}',
  "rhythm" TEXT NOT NULL,
  "zone" TEXT NOT NULL DEFAULT 'UTC',
  "quiet" TEXT,
  "permissions" TEXT NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL,
  "status_reason" TEXT,
  "thread_id" TEXT,
  "root_task_id" TEXT,
  "folder_id" TEXT,
  "source_thread_id" TEXT,
  "start_value" REAL,
  "value" REAL,
  "value_at" INTEGER,
  "read_error" TEXT,
  "read_fails" INTEGER NOT NULL DEFAULT 0,
  "checkins" INTEGER NOT NULL DEFAULT 0,
  "last_checkin_at" INTEGER,
  "next_checkin_at" INTEGER,
  "last_signal" REAL,
  "flat_checkins" INTEGER NOT NULL DEFAULT 0,
  "stuck_after" INTEGER NOT NULL DEFAULT 3,
  "spent_micros" INTEGER NOT NULL DEFAULT 0,
  "turns" INTEGER NOT NULL DEFAULT 0,
  "budget_warned" INTEGER NOT NULL DEFAULT 0,
  "stuck_task_id" TEXT,
  "budget_task_id" TEXT,
  "poll_at" INTEGER,
  "created_by" TEXT NOT NULL,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "ended_at" INTEGER,
  "ended" TEXT,
  "summary" TEXT,
  "retro" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "goals_goal_status" ON "goals_goal" ("status");
CREATE INDEX IF NOT EXISTS "goals_goal_owner" ON "goals_goal" ("owner");
CREATE TABLE IF NOT EXISTS "goals_reading" (
  "goal_id" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  "value" REAL,
  "ok" INTEGER NOT NULL,
  "error" TEXT,
  PRIMARY KEY ("goal_id", "at")
);
CREATE TABLE IF NOT EXISTS "goals_wake" (
  "id" TEXT PRIMARY KEY,
  "goal_id" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "detail" TEXT,
  "due_at" INTEGER NOT NULL,
  "state" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "sent_at" INTEGER,
  "claimed_at" INTEGER,
  "reported_at" INTEGER,
  "created_at" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "goals_wake_goal" ON "goals_wake" ("goal_id", "state");
CREATE TABLE IF NOT EXISTS "goals_step" (
  "goal_id" TEXT NOT NULL,
  "step_id" TEXT NOT NULL,
  "title" TEXT,
  "state" TEXT NOT NULL,
  "result" TEXT,
  "by" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  "done_at" INTEGER,
  PRIMARY KEY ("goal_id", "step_id")
);
CREATE TABLE IF NOT EXISTS "goals_thread" (
  "thread_id" TEXT PRIMARY KEY,
  "goal_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "goals_task" (
  "task_id" TEXT PRIMARY KEY,
  "goal_id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "state" TEXT,
  "title" TEXT,
  "key" TEXT
);
CREATE INDEX IF NOT EXISTS "goals_task_goal" ON "goals_task" ("goal_id");
CREATE TABLE IF NOT EXISTS "goals_wait" (
  "goal_id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "assigned" TEXT,
  "since" INTEGER NOT NULL,
  PRIMARY KEY ("goal_id", "task_id")
);
CREATE TABLE IF NOT EXISTS "goals_link" (
  "goal_id" TEXT NOT NULL,
  "record_id" TEXT NOT NULL,
  PRIMARY KEY ("goal_id", "record_id")
);
CREATE INDEX IF NOT EXISTS "goals_link_record" ON "goals_link" ("record_id");
CREATE TABLE IF NOT EXISTS "goals_activity" (
  "goal_id" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  "at" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "by" TEXT,
  "ref" TEXT,
  PRIMARY KEY ("goal_id", "seq")
);
