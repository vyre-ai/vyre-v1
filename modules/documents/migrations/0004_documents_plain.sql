-- documents: the bytes of every PDF that was set in the plain page look (no letterhead, headers or pictures), by SHA-256. The mark follows the content, not the file id: a copy, a move or a re-upload of the same bytes
-- is the same preview and is held for signing like the first one. A different version of the bytes is a different file and is not held.

CREATE TABLE IF NOT EXISTS documents_plain (
  sha256 TEXT PRIMARY KEY,
  made_at INTEGER NOT NULL
);

-- the files already found to be plain previews, by id and version, so asking again costs no read of the file
CREATE TABLE IF NOT EXISTS documents_plain_seen (
  file_id TEXT NOT NULL,
  version TEXT NOT NULL,
  PRIMARY KEY (file_id, version)
);
