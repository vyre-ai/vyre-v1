-- sync: the pull and snapshot side (ARCH 5.1, 5.3, 5.8). The change feed and the server's own copy of each row are rebuilt from the log by the sync.changes projection;
-- the seen marks, epochs and snapshot sessions are server state and survive a rebuild.
CREATE TABLE IF NOT EXISTS sync_changes (
  seq INTEGER PRIMARY KEY,
  entity TEXT NOT NULL,
  id TEXT NOT NULL,
  op TEXT NOT NULL,
  fields TEXT NOT NULL,
  hlc TEXT NOT NULL,
  actor TEXT NOT NULL,
  vis TEXT NOT NULL,
  label INTEGER NOT NULL DEFAULT 0,
  enc INTEGER NOT NULL DEFAULT 0,
  trace TEXT
);
CREATE INDEX IF NOT EXISTS sync_changes_row ON sync_changes (entity, id, seq);

CREATE TABLE IF NOT EXISTS sync_rows (
  entity TEXT NOT NULL,
  id TEXT NOT NULL,
  owner_id TEXT,
  label INTEGER NOT NULL DEFAULT 0,
  holds INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  enc INTEGER NOT NULL DEFAULT 0,
  vis TEXT NOT NULL DEFAULT 'space',
  seq INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  fields TEXT NOT NULL,
  PRIMARY KEY (entity, id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS sync_rows_recent ON sync_rows (entity, deleted, updated_at);

-- Which rows each device holds (5.3 seen_rows). A mark records the seq that set it and the state before, so a pull from an older cursor reads the state it had then.
CREATE TABLE IF NOT EXISTS sync_seen_rows (
  person TEXT NOT NULL,
  device TEXT NOT NULL,
  entity TEXT NOT NULL,
  id TEXT NOT NULL,
  vis INTEGER NOT NULL,
  prev_vis INTEGER NOT NULL,
  at_seq INTEGER NOT NULL,
  PRIMARY KEY (person, device, entity, id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS sync_epoch (
  person TEXT PRIMARY KEY,
  epoch INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_snapshots (
  person TEXT NOT NULL,
  device TEXT NOT NULL,
  as_of INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  PRIMARY KEY (person, device, as_of)
) WITHOUT ROWID;
