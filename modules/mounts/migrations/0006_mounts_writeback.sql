-- Write-back to Google Drive and OneDrive (15 Nov 2026).
-- op_seq counts the changes queued for an item (a rename, a move, a delete, a restore), so the key a provider write carries is the same on a retry of one change and new for the next one.
-- trashed_at is when the provider put the item in its own Trash for a delete made in Vyre: the row stays (a tombstone) so a restore from Vyre's Trash can bring the same item back there.
-- wait_reason is why the last attempt to send a change for the item failed, in words a person can read; it is cleared when the change goes out.
-- can_edit is what the provider says about the signed-in person's right to change the item (null: it does not say).
ALTER TABLE mounts_item ADD COLUMN op_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mounts_item ADD COLUMN trashed_at INTEGER;
ALTER TABLE mounts_item ADD COLUMN wait_reason TEXT;
ALTER TABLE mounts_item ADD COLUMN can_edit INTEGER;

-- A mount made before write-back existed never sent a change to its provider (every write was refused). It stays that way until its owner turns two-way on: the mount shows one line offering it.
ALTER TABLE mounts_mount ADD COLUMN two_way_offer INTEGER NOT NULL DEFAULT 0;
UPDATE mounts_mount SET pull_only = 1, two_way_offer = 1 WHERE kind IN ('google_drive', 'sharepoint', 'onedrive') AND deleted_at IS NULL;

-- A listing larger than one pass reads resumes where it stopped: the folders still to open (with the page token of the one being read), how many items were seen, and the ids seen so far.
ALTER TABLE mounts_mount ADD COLUMN scan_queue TEXT;
ALTER TABLE mounts_mount ADD COLUMN scan_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mounts_mount ADD COLUMN scan_cursor TEXT;
CREATE TABLE IF NOT EXISTS mounts_scan_seen (
  mount_id TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  PRIMARY KEY (mount_id, remote_id)
);
