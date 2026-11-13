-- The Wake table (P1 contract, section 2): a schedule row becomes one wake, and a fire becomes a row with a state that one claim moves. Additive for the schedules; the fires table is rebuilt because its key
-- changes from (schedule, time) to (schedule, due key), which a retry ("key#2") and an event wake (a message id) need. Nothing wrote scheduler_api_fires before this (no caller of scheduler.schedule or tick outside
-- tests), and any row there is carried over as a finished fire with the due key it had: its time.

ALTER TABLE "scheduler_api_schedules" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'call';
ALTER TABLE "scheduler_api_schedules" ADD COLUMN "person" TEXT;
ALTER TABLE "scheduler_api_schedules" ADD COLUMN "agent_id" TEXT;
ALTER TABLE "scheduler_api_schedules" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'private';
ALTER TABLE "scheduler_api_schedules" ADD COLUMN "room_id" TEXT;
ALTER TABLE "scheduler_api_schedules" ADD COLUMN "zone" TEXT;
ALTER TABLE "scheduler_api_schedules" ADD COLUMN "quiet" TEXT;
ALTER TABLE "scheduler_api_schedules" ADD COLUMN "on_event" TEXT;
ALTER TABLE "scheduler_api_schedules" ADD COLUMN "on_filter" TEXT;
ALTER TABLE "scheduler_api_schedules" ADD COLUMN "overlap" TEXT NOT NULL DEFAULT 'skip';
ALTER TABLE "scheduler_api_schedules" ADD COLUMN "answer_within_min" INTEGER;
ALTER TABLE "scheduler_api_schedules" ADD COLUMN "max_attempts" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "scheduler_api_schedules" ADD COLUMN "paused_by" TEXT;

CREATE TABLE "scheduler_api_fires_wake" (
  "schedule_id" TEXT NOT NULL,
  "due_key" TEXT NOT NULL,
  "scheduled_for" INTEGER NOT NULL,
  "run_id" TEXT,
  "fired_at" INTEGER NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'done',
  "reasons" TEXT,
  "claimed_by" TEXT,
  "lease_until" INTEGER,
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "skip_reason" TEXT,
  "ended_at" INTEGER,
  PRIMARY KEY ("schedule_id", "due_key")
);
INSERT INTO "scheduler_api_fires_wake" ("schedule_id", "due_key", "scheduled_for", "run_id", "fired_at", "state", "ended_at")
  SELECT "schedule_id", CAST("scheduled_for" AS TEXT), "scheduled_for", "run_id", "fired_at", 'done', "fired_at" FROM "scheduler_api_fires";
DROP TABLE "scheduler_api_fires";
ALTER TABLE "scheduler_api_fires_wake" RENAME TO "scheduler_api_fires";
-- at most one open fire per wake is looked up by state, and the claim and the retention pass read by state and time
CREATE INDEX "scheduler_api_fires_state" ON "scheduler_api_fires" ("state", "lease_until");
CREATE INDEX "scheduler_api_fires_wake_time" ON "scheduler_api_fires" ("schedule_id", "scheduled_for");
