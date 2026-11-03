-- The clock of tasks (lane l-tasks): each person's time zone, copied from profile.timezone so "due today" is their day, and what the clock already said, so a reminder or a nudge is said once.
CREATE TABLE IF NOT EXISTS "tasks_tz" (
  "person" TEXT PRIMARY KEY,
  "tz" TEXT NOT NULL
);
-- one row per thing the clock said about a task: 'day:<due>' (the due day began), 'time:<due>' (the due time passed), 'nudge:<updatedAt>' (a step sat too long)
CREATE TABLE IF NOT EXISTS "tasks_said" (
  "task_id" TEXT NOT NULL,
  "what" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  PRIMARY KEY ("task_id", "what")
);
CREATE INDEX IF NOT EXISTS "tasks_meta_due" ON "tasks_meta" ("due");
CREATE INDEX IF NOT EXISTS "tasks_meta_snoozed" ON "tasks_meta" ("snoozed_until");
