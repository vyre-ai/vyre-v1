-- dirty_at: when the edit waiting in an item was last made in Vyre. A pass the scheduler starts on its own sends an edit to the provider only once it has been quiet for PUSH_QUIET_MS, so a long edit makes one
-- revision at the provider, not one for every pause (Drive prunes old revisions). A person's own Sync now, and leaving the file, send at once.
ALTER TABLE mounts_item ADD COLUMN dirty_at INTEGER;
