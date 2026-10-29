-- The Run of the Automation that completes a task (a task with "done by an Automation"): when that Run succeeds the task is done.

ALTER TABLE "journeys_tasks" ADD COLUMN "done_run_id" TEXT;
CREATE INDEX IF NOT EXISTS "journeys_tasks_done_run" ON "journeys_tasks" ("done_run_id");
