-- Live Folders. A cloud mount in live_only mode keeps the tree and metadata from the provider and fetches content when a file is opened.
-- mounts_item.cached_version is the remote_version the Vyre copy of the content was fetched at; null means a placeholder that has not been opened, and a value that differs from remote_version means the copy is stale.
-- remote_rev is the provider's revision or etag of the current content (what a write is conditional on); editor_* and modified_at are the provider's "last edited by"; dirty_by is who made the Vyre-side edit waiting to go out.
-- Server copies keep working as before: their content is fetched in every pass, so cached_version follows remote_version.
ALTER TABLE mounts_item ADD COLUMN remote_rev TEXT;
ALTER TABLE mounts_item ADD COLUMN cached_version TEXT;
ALTER TABLE mounts_item ADD COLUMN editor_name TEXT;
ALTER TABLE mounts_item ADD COLUMN editor_email TEXT;
ALTER TABLE mounts_item ADD COLUMN modified_at INTEGER;
ALTER TABLE mounts_item ADD COLUMN dirty_by TEXT;
UPDATE mounts_item SET cached_version = remote_version WHERE is_folder = 0 AND remote_version IS NOT NULL;

-- Push channel (Drive changes.watch channel id, Graph subscription id) and what closes it; watch_expires is null when the provider renews it on its own (Graph).
-- client_seen_at is the last time an app showing the mount said so: while it is recent and there is no push channel, the mount polls every 30 s.
ALTER TABLE mounts_mount ADD COLUMN watch_id TEXT;
ALTER TABLE mounts_mount ADD COLUMN watch_resource TEXT;
ALTER TABLE mounts_mount ADD COLUMN watch_expires INTEGER;
ALTER TABLE mounts_mount ADD COLUMN client_seen_at INTEGER;

-- Every revision Vyre sent to a provider, with who made the edit (a person or an agent), so the history can name them where the provider only knows the connected account.
CREATE TABLE IF NOT EXISTS mounts_revision (
  mount_id TEXT NOT NULL,
  remote_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  by_actor TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (mount_id, remote_id, revision_id)
);
