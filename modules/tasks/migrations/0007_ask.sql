-- Living tasks (lane r42-alive): "Still need these?". A moment a person or an agent STATED ends the task by itself; a moment the Space only guessed (the default an agent gets) never does: when it passes the task
-- goes on the weekly card instead (tasks_ask). The card is answered Keep (not asked again for 90 days: kept_until) or Archive; a row nobody answers for a week archives itself (code quiet).
ALTER TABLE "tasks_moment" ADD COLUMN "stated" INTEGER NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS "tasks_ask" (
  "task_id" TEXT PRIMARY KEY,
  "at" INTEGER NOT NULL,
  "why" TEXT NOT NULL DEFAULT '',
  "kept_until" INTEGER
);
CREATE INDEX IF NOT EXISTS "tasks_ask_at" ON "tasks_ask" ("at");
