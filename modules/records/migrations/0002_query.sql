-- records: saved views, cached view counts and search indexes (spec 2.9, ARCH 7.4). Created lazily by handlers/query.ts, which runs this same DDL.
-- Everything here is prefixed qx_ so a records.rows projection reset (it drops rt_*) never meets an FTS5 shadow table.
-- Per type, handlers/query.ts adds on demand:
--   qx_<type>_<hash>     partial index (WHERE deleted_at IS NULL) on the view's sort expressions, then id: a page is a range scan of LIMIT rows
--   qx_<type>_fts        FTS5 table of every text value, rowid = rt_<type>.rowid, kept by the triggers qx_<type>_fts_ai and qx_<type>_fts_au
CREATE TABLE IF NOT EXISTS qx_counts (
  type TEXT NOT NULL,
  key TEXT NOT NULL,          -- canonical JSON of the filter
  n INTEGER NOT NULL,
  stamp INTEGER NOT NULL,     -- max(rs_changes.cursor) when n was counted; a later write makes the row stale
  PRIMARY KEY (type, key)
);

CREATE TABLE IF NOT EXISTS qx_views (
  view_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  spec TEXT NOT NULL,         -- JSON: filter, sort, group, fields, limit
  shared INTEGER NOT NULL DEFAULT 0,
  owner_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS qx_views_type ON qx_views (type, shared);
