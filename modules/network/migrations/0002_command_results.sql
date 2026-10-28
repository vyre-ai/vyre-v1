-- Bounded observed outcomes of queued host actions. Pending requests remain in network_command.
CREATE TABLE IF NOT EXISTS network_result (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  target TEXT NOT NULL,
  state TEXT NOT NULL,
  detail TEXT,
  at INTEGER NOT NULL
);
