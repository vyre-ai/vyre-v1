-- Rewind (chat gap G36, G37): after a person goes back to a point, the agents of that chat no longer read the messages after it (up to where the rewind was made). The chat keeps and shows every message.
CREATE TABLE IF NOT EXISTS engine_rewind (
  thread_id TEXT NOT NULL,
  after_seq INTEGER NOT NULL,
  upto_seq INTEGER NOT NULL,
  by_person TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS engine_rewind_thread ON engine_rewind (thread_id);
