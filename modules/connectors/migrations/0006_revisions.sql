-- The revision of a connector: a number the server owns that moves on every change to its stored definition (a publish, a roll back, a sync-spec publish, a refresh of a shipped one, a new draft) and never
-- repeats, even for a connector deleted and made again (the sequence is one counter for all connectors). The connect card pins it, so a card never connects to a definition it did not show.
CREATE TABLE IF NOT EXISTS cn_revision_seq (id INTEGER PRIMARY KEY CHECK (id = 1), n INTEGER NOT NULL);
INSERT OR IGNORE INTO cn_revision_seq (id, n) VALUES (1, 0);
CREATE TABLE IF NOT EXISTS cn_revisions (key TEXT PRIMARY KEY, rev INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS cn_revision_insert AFTER INSERT ON cn_connectors
BEGIN
  UPDATE cn_revision_seq SET n = n + 1 WHERE id = 1;
  INSERT OR REPLACE INTO cn_revisions (key, rev) SELECT NEW.key, n FROM cn_revision_seq WHERE id = 1;
END;
CREATE TRIGGER IF NOT EXISTS cn_revision_update AFTER UPDATE OF def ON cn_connectors WHEN OLD.def IS NOT NEW.def
BEGIN
  UPDATE cn_revision_seq SET n = n + 1 WHERE id = 1;
  INSERT OR REPLACE INTO cn_revisions (key, rev) SELECT NEW.key, n FROM cn_revision_seq WHERE id = 1;
END;
CREATE TRIGGER IF NOT EXISTS cn_revision_delete AFTER DELETE ON cn_connectors
BEGIN
  UPDATE cn_revision_seq SET n = n + 1 WHERE id = 1;
  DELETE FROM cn_revisions WHERE key = OLD.key;
END;
