-- The Unblock task raised when a turn had no account to run on (P-L2_23): when the person answers it (adds a key), the host wakes the agent in that thread again. One row per task.
CREATE TABLE IF NOT EXISTS engine_unblock (
  task_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  asker TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS engine_unblock_thread ON engine_unblock (thread_id, agent_id, asker);
