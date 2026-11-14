-- The subagents a command-line engine starts inside its own turn (finding F41): one row when it starts and one update when it ends. The task line, who asked, the times and the words it returned. The step it is on
-- rides the live stream and is never written. message_id is the reply the row hangs under: the row goes when that message or its chat is erased (own-subagents.ts).
CREATE TABLE IF NOT EXISTS engine_own_subagent (
  thread_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  asker TEXT NOT NULL DEFAULT '',
  message_id TEXT,
  title TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'working',
  found TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  PRIMARY KEY (thread_id, call_id)
);
CREATE INDEX IF NOT EXISTS engine_own_subagent_turn ON engine_own_subagent (turn_id);
CREATE INDEX IF NOT EXISTS engine_own_subagent_message ON engine_own_subagent (message_id);
