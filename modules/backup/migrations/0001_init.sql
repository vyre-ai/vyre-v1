-- backup module tables (P-L7b_05; spec 5 Backups and export, 2.26, ARCH 7.10).
-- Every table is prefixed backup_ because ctx.db refuses any other name.

-- The backup settings, one row per key: target (JSON of the target, never a credential), schedule (a five-field cron line, UTC),
-- enabled (1 or 0), next_at (epoch ms of the next scheduled run) and last_ok_at (epoch ms of the last backup that finished).
CREATE TABLE IF NOT EXISTS backup_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- One row per backup attempt. state is done or failed; only done rows are listed and restorable.
-- object_key is where the archive sits on the target. head_hash is the event-log hash at seq, checked again after a restore.
CREATE TABLE IF NOT EXISTS backup_item (
  backup_id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  state TEXT NOT NULL,
  kind TEXT NOT NULL,
  seq INTEGER NOT NULL,
  from_seq INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  verified INTEGER NOT NULL,
  target TEXT NOT NULL,
  object_key TEXT NOT NULL,
  head_hash TEXT NOT NULL,
  encrypted INTEGER NOT NULL,
  tombstones INTEGER NOT NULL,
  reason TEXT
);
CREATE INDEX IF NOT EXISTS backup_item_at ON backup_item(at);

-- Every owner export: who asked, when, what was left out and where the zip went.
CREATE TABLE IF NOT EXISTS backup_export (
  run_id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  by_principal TEXT NOT NULL,
  on_behalf TEXT,
  state TEXT NOT NULL,
  file_id TEXT,
  size_bytes INTEGER NOT NULL,
  entries INTEGER NOT NULL,
  skipped INTEGER NOT NULL
);
