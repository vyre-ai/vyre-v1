-- one backup or restore at a time per site, held in a row so it survives a restart (the holder is the process that took it: a lock held by an earlier process is dead and is taken over),
-- and a backup made before a restore is kept until a date whatever the clean-up rule says
CREATE TABLE IF NOT EXISTS sites_site_lock (
  site_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  holder TEXT NOT NULL,
  since INTEGER NOT NULL
);
ALTER TABLE sites_backup ADD COLUMN keep_until INTEGER;
