-- Where the baton of a work task was last woken (work baton). One row per task: the signature of the baton (role, review loop, holder) the holder was last woken for, who was woken, the child
-- questions that already woke it, the thread and the person the turn runs for, and the clock of the no-silent-stop rule (when the turn ended, the one nudge, the escalation).
CREATE TABLE IF NOT EXISTS engine_task_baton (
  task_id TEXT PRIMARY KEY,
  sig TEXT NOT NULL,
  woken TEXT NOT NULL,
  answered TEXT NOT NULL,
  thread_id TEXT,
  asker TEXT,
  woke_at INTEGER NOT NULL,
  turn_ended_at INTEGER,
  nudged_at INTEGER,
  escalated_at INTEGER
);
