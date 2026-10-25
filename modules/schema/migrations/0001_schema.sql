-- schema module state (ARCH 7.4). Record types live in the RecordStore (rs_types and rt_<type> tables, kernel); these tables hold what the store does not:
-- the full field definitions (sc_types), the change log, Trash for dropped fields and types, saved views, record page layouts and gap-check rules.
CREATE TABLE IF NOT EXISTS sc_types (
  type TEXT PRIMARY KEY, def TEXT NOT NULL, version INTEGER NOT NULL, system INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sc_changes (
  change_id TEXT PRIMARY KEY, at INTEGER NOT NULL, by TEXT NOT NULL, summary TEXT NOT NULL, destructive INTEGER NOT NULL, types TEXT NOT NULL, ops TEXT NOT NULL, reason TEXT
);
CREATE INDEX IF NOT EXISTS sc_changes_at ON sc_changes (at);
CREATE TABLE IF NOT EXISTS sc_trash (
  id INTEGER PRIMARY KEY AUTOINCREMENT, change_id TEXT NOT NULL, type TEXT NOT NULL, field TEXT, dropped_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  rows INTEGER NOT NULL, payload TEXT NOT NULL, restored_at INTEGER
);
CREATE INDEX IF NOT EXISTS sc_trash_type ON sc_trash (type, field);
CREATE TABLE IF NOT EXISTS sc_views (
  view_id TEXT PRIMARY KEY, type TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, shared INTEGER NOT NULL DEFAULT 0, owner_id TEXT NOT NULL, spec TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sc_views_type ON sc_views (type, shared);
CREATE TABLE IF NOT EXISTS sc_layout (type TEXT PRIMARY KEY, sections TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sc_gap_rules (type TEXT NOT NULL, rule_id TEXT NOT NULL, rule TEXT NOT NULL, PRIMARY KEY (type, rule_id));
CREATE TABLE IF NOT EXISTS sc_view_links (token TEXT PRIMARY KEY, view_id TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER);
