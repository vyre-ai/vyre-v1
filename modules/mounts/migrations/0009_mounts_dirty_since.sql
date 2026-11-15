-- dirty_since: when the edit waiting in an item was FIRST made (dirty_at is the last one). The quiet window defers an edit while it is still being made, but never longer than five minutes from the first one.
ALTER TABLE mounts_item ADD COLUMN dirty_since INTEGER;
