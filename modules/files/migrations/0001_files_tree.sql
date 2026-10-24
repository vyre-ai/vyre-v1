-- files: folder tree, blob manifest, recent list, upload slots, trash index.
-- Entity tables files_file and files_file_version come from generated/modules/files/schema.sql.
-- Apply that schema first. Bytes in files_blob are AES-GCM ciphertext from ctx.seal (ARCH 4.1, 7.5).

CREATE TABLE IF NOT EXISTS files_folder (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  scope TEXT NOT NULL,
  owner TEXT NOT NULL,
  label INTEGER NOT NULL DEFAULT 0,
  git INTEGER NOT NULL DEFAULT 0,
  review_changes INTEGER NOT NULL DEFAULT 0,
  source_mount TEXT,
  source_provider TEXT,
  root_key TEXT,
  system_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS files_folder__parent ON files_folder (parent_id);
CREATE INDEX IF NOT EXISTS files_folder__root ON files_folder (root_key);
CREATE INDEX IF NOT EXISTS files_folder__owner ON files_folder (owner);
CREATE INDEX IF NOT EXISTS files_folder__system ON files_folder (system_key);

CREATE TABLE IF NOT EXISTS files_blob (
  id TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime TEXT,
  key_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  bytes TEXT NOT NULL,
  scope TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  refs INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS files_blob__hash ON files_blob (hash);

CREATE TABLE IF NOT EXISTS files_recent (
  actor TEXT NOT NULL,
  file_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (actor, file_id)
);

CREATE INDEX IF NOT EXISTS files_recent__at ON files_recent (at);

CREATE TABLE IF NOT EXISTS files_upload (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime TEXT,
  expires_at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS files_trash (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  root_id TEXT NOT NULL,
  deleted_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS files_trash__root ON files_trash (root_id);
