-- Living tasks (lane r42-alive): evidence that settles a task. A task may carry one "done when" (kind + key): when the event that proves it arrives (a Vault item with that name, a message sent to a contact,
-- a meeting that ended, a connection made) the task closes Done with the proof as its note. key is stored lowercase.
CREATE TABLE IF NOT EXISTS "tasks_proof" (
  "task_id" TEXT PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "key" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "tasks_proof_kind_key" ON "tasks_proof" ("kind", "key");
