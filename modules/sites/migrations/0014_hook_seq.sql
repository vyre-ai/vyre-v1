-- The order of handled pushes is an explicit counter, not SQLite's implicit rowid: an id that is never used again, whatever is deleted (a failed push gives its row back). Rows from the same millisecond are ordered by it.
DROP TABLE IF EXISTS sites_hook_head;
CREATE TABLE IF NOT EXISTS sites_hook_head (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL,
  branch TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  before_sha TEXT NOT NULL,
  after_sha TEXT NOT NULL,
  at INTEGER NOT NULL,
  UNIQUE (site_id, branch, delivery_id)
);
CREATE INDEX IF NOT EXISTS sites_hook_head__after ON sites_hook_head (site_id, branch, after_sha);
