-- The order of a site's pushes comes from the commits they name, not from a clock. Each handled push keeps its branch, the commit it came from (before) and the commit it went to (after); a push whose head is
-- one of those is old news. This replaces sites_hook_seen (the newest commit time per branch), which a commit with a wrong date could poison.
DROP TABLE IF EXISTS sites_hook_seen;
CREATE TABLE IF NOT EXISTS sites_hook_head (
  site_id TEXT NOT NULL,
  branch TEXT NOT NULL,
  delivery_id TEXT NOT NULL,
  before_sha TEXT NOT NULL,
  after_sha TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (site_id, branch, delivery_id)
);
CREATE INDEX IF NOT EXISTS sites_hook_head__after ON sites_hook_head (site_id, branch, after_sha);
