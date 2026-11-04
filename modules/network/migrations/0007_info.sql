-- Facts the host reads about itself and its relay for the Console: this Space server's version, and the version the relay's /health reports (checked on the relay link, about every five minutes).
CREATE TABLE IF NOT EXISTS network_info (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  at INTEGER NOT NULL
);
