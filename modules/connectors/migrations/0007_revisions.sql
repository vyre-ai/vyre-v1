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
-- a state change (draft to live and back) is a change to what the connector is: the trigger watches the definition and the state
DROP TRIGGER IF EXISTS cn_revision_update;
CREATE TRIGGER IF NOT EXISTS cn_revision_changed AFTER UPDATE OF def, state ON cn_connectors WHEN OLD.def IS NOT NEW.def OR OLD.state IS NOT NEW.state
BEGIN
  UPDATE cn_revision_seq SET n = n + 1 WHERE id = 1;
  INSERT OR REPLACE INTO cn_revisions (key, rev) SELECT NEW.key, n FROM cn_revision_seq WHERE id = 1;
END;
CREATE TRIGGER IF NOT EXISTS cn_revision_delete AFTER DELETE ON cn_connectors
BEGIN
  UPDATE cn_revision_seq SET n = n + 1 WHERE id = 1;
  DELETE FROM cn_revisions WHERE key = OLD.key;
END;
-- a connector that exists when this migration first runs gets its own revision, in order, and the sequence moves past them all: nothing reads "0", and no later revision of a key can equal an earlier one
INSERT OR IGNORE INTO cn_revisions (key, rev)
  SELECT key, (SELECT n FROM cn_revision_seq WHERE id = 1) + ROW_NUMBER() OVER (ORDER BY created_at, key) FROM cn_connectors WHERE key NOT IN (SELECT key FROM cn_revisions);
UPDATE cn_revision_seq SET n = MAX(n, (SELECT COALESCE(MAX(rev), 0) FROM cn_revisions)) WHERE id = 1;
