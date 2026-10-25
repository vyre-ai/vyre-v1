-- Scheduler tables (P-L6_07, spec 2.12 and 2.13, ARCH 7.7 and 6.8). The module declares no entity, so every table is created here.
-- Schedules fire a capability call; waits wake a Run when an event, another Run or a time matches.

CREATE TABLE IF NOT EXISTS "scheduler_api_schedules" (
  "id" TEXT PRIMARY KEY,
  "owner_kind" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "principal" TEXT NOT NULL,
  "cap" TEXT NOT NULL,
  "input" TEXT NOT NULL,
  "at_ms" INTEGER,
  "cron" TEXT,
  "tz" TEXT,
  "if_missed" TEXT NOT NULL,
  "active" INTEGER NOT NULL,
  "paused_reason" TEXT,
  "next_at" INTEGER,
  "last_fired_at" INTEGER,
  "created_by" TEXT NOT NULL,
  "created_at" INTEGER NOT NULL,
  "canceled_at" INTEGER
);
CREATE INDEX IF NOT EXISTS "scheduler_api_schedules_due" ON "scheduler_api_schedules" ("active", "next_at");
CREATE INDEX IF NOT EXISTS "scheduler_api_schedules_owner" ON "scheduler_api_schedules" ("owner_kind", "owner_id");

-- idempotency keys of scheduler.schedule
CREATE TABLE IF NOT EXISTS "scheduler_api_idem" (
  "idem_key" TEXT PRIMARY KEY,
  "ref_id" TEXT NOT NULL
);

-- one row per fire of a schedule time: a second fire of the same time does nothing
CREATE TABLE IF NOT EXISTS "scheduler_api_fires" (
  "schedule_id" TEXT NOT NULL,
  "scheduled_for" INTEGER NOT NULL,
  "run_id" TEXT,
  "fired_at" INTEGER NOT NULL,
  PRIMARY KEY ("schedule_id", "scheduled_for")
);

-- what catch_up did about each missed schedule (the owner digest reads this)
CREATE TABLE IF NOT EXISTS "scheduler_api_missed" (
  "schedule_id" TEXT NOT NULL,
  "scheduled_for" INTEGER NOT NULL,
  "owner_kind" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "handling" TEXT NOT NULL,
  "run_id" TEXT,
  "note" TEXT,
  "handled_at" INTEGER NOT NULL,
  PRIMARY KEY ("schedule_id", "scheduled_for")
);
CREATE INDEX IF NOT EXISTS "scheduler_api_missed_at" ON "scheduler_api_missed" ("handled_at");

CREATE TABLE IF NOT EXISTS "scheduler_api_waits" (
  "id" TEXT PRIMARY KEY,
  "run_id" TEXT NOT NULL,
  "on_json" TEXT NOT NULL,
  "event_type" TEXT,
  "filter_hash" TEXT,
  "target_run" TEXT,
  "at_ms" INTEGER,
  "subject" TEXT,
  "subject_type" TEXT,
  "subject_id" TEXT,
  "thread_id" TEXT,
  "step_id" TEXT,
  "expires_at" INTEGER NOT NULL,
  "cancels_on" TEXT NOT NULL DEFAULT '[]',
  "state" TEXT NOT NULL,
  "created_at" INTEGER NOT NULL,
  "ended_at" INTEGER
);
CREATE INDEX IF NOT EXISTS "scheduler_api_waits_event" ON "scheduler_api_waits" ("state", "event_type", "filter_hash");
CREATE INDEX IF NOT EXISTS "scheduler_api_waits_run" ON "scheduler_api_waits" ("run_id", "state");
CREATE INDEX IF NOT EXISTS "scheduler_api_waits_expiry" ON "scheduler_api_waits" ("state", "expires_at");

-- Space policy values for the two scheduler.* settings; a missing row means the default of the manifest.
CREATE TABLE IF NOT EXISTS "scheduler_api_policy" (
  "policy_key" TEXT PRIMARY KEY,
  "policy_value" TEXT NOT NULL
);
