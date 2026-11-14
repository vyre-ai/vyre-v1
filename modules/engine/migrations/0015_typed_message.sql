-- A message a person typed themselves (chat sets `typed` on message.received; the Gate already trusts only these words to ask for an act). A turn is "asked by" a person only through one of these:
-- a poke, a helper's restart line, or a line a module posted in a person's name is never in this table (engine.turn.asked_by).
CREATE TABLE IF NOT EXISTS engine_typed_message (
  message_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  at INTEGER NOT NULL
);
