-- updates module tables (P-L7b_06; spec 3.10, b13 releases, ARCH 7.10).
-- Every table is prefixed updates_ because ctx.db refuses any other name.

-- Settings and the last look at the release feed, one row per key:
--   channel (stable, beta or nightly), checked_at (epoch ms), available (a version or empty),
--   notes, security (1 when the waiting release is a security update), apps_json (the app versions the feed lists).
CREATE TABLE IF NOT EXISTS updates_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- One row per update or roll back. result is ok, failed or rolled_back. reason says why a failed update failed.
CREATE TABLE IF NOT EXISTS updates_history (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  from_version TEXT NOT NULL,
  to_version TEXT NOT NULL,
  result TEXT NOT NULL,
  seconds INTEGER NOT NULL,
  backup_id TEXT,
  reason TEXT
);
CREATE INDEX IF NOT EXISTS updates_history_at ON updates_history(at);
