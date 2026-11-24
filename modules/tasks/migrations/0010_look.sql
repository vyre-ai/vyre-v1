-- Living tasks (lane r42-alive): the daily look. One row per run (when, which model, how many tasks it saw, what it proposed, tokens), so the cost is never a guess; and the last time each task was looked at,
-- so the same few are not read every day.
CREATE TABLE IF NOT EXISTS "tasks_look_log" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "at" INTEGER NOT NULL,
  "model" TEXT NOT NULL DEFAULT '',
  "tasks" INTEGER NOT NULL DEFAULT 0,
  "asked" INTEGER NOT NULL DEFAULT 0,
  "done" INTEGER NOT NULL DEFAULT 0,
  "rejected" INTEGER NOT NULL DEFAULT 0,
  "tokens_in" INTEGER NOT NULL DEFAULT 0,
  "tokens_out" INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS "tasks_look_seen" (
  "task_id" TEXT PRIMARY KEY,
  "at" INTEGER NOT NULL
);
