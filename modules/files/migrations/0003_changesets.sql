-- files: changesets (Review changes). Agent writes in a Review changes folder are staged here and reach the file tree only on Approve.
-- Staged content is sealed with ctx.seal (AES-GCM under the Space key); nothing is written to files_blob until Approve, so a
-- discarded changeset leaves no blob, no version and no file behind (spec 2.16, ARCH 7.5).

CREATE TABLE IF NOT EXISTS files_changeset (
  id TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL,          -- the topmost folder with Review changes on
  state TEXT NOT NULL,              -- open | changes_requested | approved | discarded
  author TEXT NOT NULL,             -- the agent or outside actor that wrote
  on_behalf_of TEXT,                -- the person who asked
  thread_id TEXT,
  reviewer TEXT,
  opened_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER,
  push_pending INTEGER NOT NULL DEFAULT 0,
  commit_sha TEXT,
  version_ids TEXT                  -- JSON list, set on Approve
);
CREATE INDEX IF NOT EXISTS files_changeset__folder ON files_changeset (folder_id, state);
CREATE INDEX IF NOT EXISTS files_changeset__behalf ON files_changeset (on_behalf_of);

CREATE TABLE IF NOT EXISTS files_changeset_file (
  changeset_id TEXT NOT NULL,
  path TEXT NOT NULL,               -- relative to the changeset folder
  status TEXT NOT NULL,             -- added | modified | deleted | renamed
  file_id TEXT,                     -- the file this changes; for an added file, the provisional id handed to the agent
  folder_id TEXT NOT NULL,          -- the folder the file sits in
  name TEXT NOT NULL,
  new_name TEXT,
  mime TEXT,
  base_version INTEGER,             -- the version the agent read; null for an added file
  content TEXT,                     -- sealed staged content (JSON of keyId, nonce, bytes); null for a deletion
  size INTEGER NOT NULL DEFAULT 0,
  added_lines INTEGER NOT NULL DEFAULT 0,
  removed_lines INTEGER NOT NULL DEFAULT 0,
  conflict INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (changeset_id, path)
);

CREATE TABLE IF NOT EXISTS files_changeset_comment (
  id TEXT PRIMARY KEY,
  changeset_id TEXT NOT NULL,
  path TEXT,
  file_id TEXT,
  anchor TEXT NOT NULL,             -- JSON
  text TEXT NOT NULL,
  mentions TEXT NOT NULL,           -- JSON list
  author TEXT NOT NULL,
  at INTEGER NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  sent INTEGER NOT NULL DEFAULT 0   -- 1 once Request changes carried it to the agent thread
);
CREATE INDEX IF NOT EXISTS files_changeset_comment__cs ON files_changeset_comment (changeset_id);

CREATE TABLE IF NOT EXISTS files_changeset_review (
  changeset_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  opened_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (changeset_id, actor_id)
);
