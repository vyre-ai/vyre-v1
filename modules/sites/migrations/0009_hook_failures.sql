-- A delivery's id is kept for good (a signature has no clock, so an id never stops being a replay), and a push that could not run is recorded as failed, which gives its delivery id back so GitHub's redelivery is taken again.
-- sites_push says which delivery asked for it; sites_hook_seen is the newest event time handled per site and branch, so an old captured delivery is refused even if its id was never seen.
ALTER TABLE sites_push ADD COLUMN delivery_id TEXT;
ALTER TABLE sites_push ADD COLUMN failed_at INTEGER;
ALTER TABLE sites_push ADD COLUMN error TEXT;

CREATE TABLE IF NOT EXISTS sites_hook_seen (
  site_id TEXT NOT NULL,
  branch TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (site_id, branch)
);
