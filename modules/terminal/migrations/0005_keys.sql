-- terminal: a take-over is a lease (15 Nov). `lease` names one take-over of one terminal; `next_seq` is the number the next key batch of that take-over must carry, so a batch lost on the way is a gap, never skipped.
-- terminal_key_batch is what the server remembers of each batch it was given: a batch is applied at most once, a repeat of it gets the first answer back, and an answer lasts ten minutes.
CREATE TABLE IF NOT EXISTS terminal_lease (
  terminal_id TEXT PRIMARY KEY,
  lease TEXT NOT NULL,
  next_seq INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS terminal_key_batch (
  terminal_id TEXT NOT NULL,
  lease TEXT NOT NULL,
  seq INTEGER NOT NULL,
  batch_key TEXT NOT NULL,
  person_id TEXT NOT NULL,
  state TEXT NOT NULL,
  answer TEXT,
  at INTEGER NOT NULL,
  PRIMARY KEY (terminal_id, lease, seq)
);
CREATE INDEX IF NOT EXISTS terminal_key_batch_key ON terminal_key_batch (terminal_id, lease, batch_key);
