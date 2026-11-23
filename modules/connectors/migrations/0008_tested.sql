-- The first time a call to a connector's app came back with a success (2xx or 3xx): a connector with no row here is "untested" (r43 meier-apps, 24 Nov 2026). One row per connector, so asking never reads the call log,
-- and the fact stays if the log is ever pruned. Connectors that were answered before this table exists get their row once, from the log.
CREATE TABLE IF NOT EXISTS cn_tested (key TEXT PRIMARY KEY, at INTEGER NOT NULL);
-- The back-fill runs once (the marker row), not at every start: the log can be large.
CREATE TABLE IF NOT EXISTS cn_tested_backfill (id INTEGER PRIMARY KEY CHECK (id = 1), at INTEGER NOT NULL);
INSERT OR IGNORE INTO cn_tested (key, at)
  SELECT connector, MIN(at) FROM cn_log WHERE status >= 200 AND status < 400 AND NOT EXISTS (SELECT 1 FROM cn_tested_backfill) GROUP BY connector;
INSERT OR IGNORE INTO cn_tested_backfill (id, at) VALUES (1, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
-- a connector that is removed and made again starts untested
CREATE TRIGGER IF NOT EXISTS cn_tested_delete AFTER DELETE ON cn_connectors
BEGIN
  DELETE FROM cn_tested WHERE key = OLD.key;
END;
