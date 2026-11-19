-- Living tasks (lane r42-alive): (1) tasks_cursor, where each clock pass over many tasks stopped, so a pass reads the next 200 and wraps round and no old row starves those behind it; (2) tasks_putback, the tasks a person put
-- back: a rule that finds them again (an event delivered twice, a goal that ended) leaves them alone, because the person already said they still matter.
CREATE TABLE IF NOT EXISTS "tasks_cursor" (
  "name" TEXT PRIMARY KEY,
  "value" TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "tasks_putback" (
  "task_id" TEXT PRIMARY KEY,
  "at" INTEGER NOT NULL
);
