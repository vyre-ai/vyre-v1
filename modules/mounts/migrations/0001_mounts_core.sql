-- mounts: one row per mounted folder and one row per mapped item. Files and folders themselves live in the files module; mounts_item remembers which provider item (or device path) each one came from.
-- mounts_mount.state is idle | syncing | paused | failing (device_offline is derived for local mounts that stopped reporting). mode is server_copy | live_only.
-- conflicts counts what the last pass of a git mount reported; other mounts count their conflicted items.
-- lag: stale_since is the time the oldest change that has not synced was seen (a local edit waiting to go out, or the first failed pass); it is cleared when a pass leaves nothing waiting.

CREATE TABLE IF NOT EXISTS mounts_mount (
  id TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  connection_id TEXT,
  ref TEXT,
  path TEXT,
  branch TEXT,
  device_id TEXT,
  local_path TEXT,
  name TEXT NOT NULL,
  mode TEXT NOT NULL,
  review_changes INTEGER NOT NULL,
  pull_only INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL,
  cursor TEXT,
  owner TEXT NOT NULL,
  last_sync_at INTEGER,
  stale_since INTEGER,
  next_sync_at INTEGER,
  conflicts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

-- item_key is the mount's own stable id for the item; remote_id is the provider id (Drive file id, Graph item id) or the relative path on a device, null until a Vyre-side item has been pushed.
-- synced_version is the files version last pulled or pushed; local_version the newest version seen in Vyre; dirty means local_version has not gone out (or a delete is waiting).
CREATE TABLE IF NOT EXISTS mounts_item (
  mount_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  remote_id TEXT,
  parent_key TEXT,
  file_id TEXT,
  folder_id TEXT,
  name TEXT NOT NULL,
  is_folder INTEGER NOT NULL DEFAULT 0,
  native INTEGER NOT NULL DEFAULT 0,
  remote_version TEXT,
  synced_version INTEGER,
  local_version INTEGER,
  dirty INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  conflict INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (mount_id, item_key)
);
