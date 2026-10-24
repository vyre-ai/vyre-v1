-- records: holds and version notes (spec 2.9, 2.26; ARCH 7.4). Created lazily by handlers/history.ts, which runs this same DDL.
-- Versions themselves are not stored: a version is one record.* event in the kernel log, and as_of and restore_version replay those events.
CREATE TABLE IF NOT EXISTS records_holds (
  hold_id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  id TEXT NOT NULL,
  reason TEXT NOT NULL,
  by TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS records_holds_row ON records_holds (type, id);

-- Why a version exists when it is more than "created" / "updated" / "removed" / "restored" (for example "restored from version 3"), and an optional name.
CREATE TABLE IF NOT EXISTS records_version_notes (
  type TEXT NOT NULL,
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  reason TEXT,
  name TEXT,
  PRIMARY KEY (type, id, version)
);
