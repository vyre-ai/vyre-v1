-- The tool calls of a turn as they happen (agent/src/turn-engine/journal.ts), so a turn a dead host left can be resumed from what it did instead of ending host_lost. One row per call; the rows of a turn go when it ends,
-- and a row older than a week is swept (a turn that was never resumed).
CREATE TABLE IF NOT EXISTS engine_turn_journal (
  turn_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  name TEXT NOT NULL,
  input_json TEXT,
  safety TEXT NOT NULL,
  state TEXT NOT NULL,
  summary TEXT,
  own INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL,
  ended_at INTEGER,
  PRIMARY KEY (turn_id, call_id)
);
CREATE INDEX IF NOT EXISTS engine_turn_journal_thread ON engine_turn_journal (thread_id);
CREATE INDEX IF NOT EXISTS engine_turn_journal_at ON engine_turn_journal (at);
