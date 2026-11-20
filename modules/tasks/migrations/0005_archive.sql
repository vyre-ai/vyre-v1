-- Living tasks (lane r42-alive): a task that is put away is archived. It is not deleted and Archived is not a seventh state: one row here is the mark, and the task keeps the state it had,
-- so Put back is one delete and the task is exactly where it was. Lists, counts and the clock leave a marked task out; search and the Archived list show it.
-- by is who archived it (a person, an agent, or the server for a rule), code is the rule (hand, asked, passed, gone, quiet), why is the one sentence a person reads, and proof is what that
-- sentence rests on (a quote, the id of the thing that settled it) as JSON.
CREATE TABLE IF NOT EXISTS "tasks_archive" (
  "task_id" TEXT PRIMARY KEY,
  "at" INTEGER NOT NULL,
  "by" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "why" TEXT NOT NULL DEFAULT '',
  "proof" TEXT
);
CREATE INDEX IF NOT EXISTS "tasks_archive_at" ON "tasks_archive" ("at");
