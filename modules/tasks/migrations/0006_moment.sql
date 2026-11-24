-- Living tasks (lane r42-alive): the moment a task stops mattering ("the call is Thu 18:30"). One row per task that has one. A due date is not a moment: overdue work is still owed.
-- until is when it stops mattering; the clock archives the task one grace period later (tasks.moment_grace_days) with code passed.
CREATE TABLE IF NOT EXISTS "tasks_moment" (
  "task_id" TEXT PRIMARY KEY,
  "until" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "tasks_moment_until" ON "tasks_moment" ("until");
