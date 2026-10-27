-- One cursor per scheduled Automation, plus the ticks that already started.
-- The cursor is the last decided scheduled time. A tick id is claimed only after automations.fire returns a run.
-- request_open remembers the one Needs You request so a restart does not open a second one.

CREATE TABLE IF NOT EXISTS "automations_schedule_state" (
  "automation_id" TEXT PRIMARY KEY,
  "cursor_ms" INTEGER NOT NULL,
  "paused" INTEGER NOT NULL DEFAULT 0,
  "paused_reason" TEXT,
  "request_open" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "automations_schedule_claims" (
  "tick_id" TEXT PRIMARY KEY,
  "automation_id" TEXT NOT NULL,
  "fire_at" INTEGER NOT NULL,
  "run_id" TEXT,
  "claimed_at" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "automations_schedule_claims_auto" ON "automations_schedule_claims" ("automation_id", "fire_at");
