-- engine: the chats that have had messages since memory last read them, and the person to read them as (a private chat is only readable as one of its people). A chat is handed to memory.capture
-- when it closes and, once, when it has been quiet for a while.
CREATE TABLE IF NOT EXISTS engine_capture_state (
  thread_id TEXT PRIMARY KEY,
  person TEXT NOT NULL,
  last_at INTEGER NOT NULL,
  captured_at INTEGER
);
CREATE INDEX IF NOT EXISTS engine_capture_idle ON engine_capture_state (captured_at, last_at);
