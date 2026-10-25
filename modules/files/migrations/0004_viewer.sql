-- files: comments and pins, freehand markup and outside links (spec 2.16; ARCH 7.5). The viewer's three kinds of data that live beside a file and not in its versions.
-- A comment may name a version it was made on; an area comment carries a pin number that is unique per file and never reused (a deleted pin keeps its row).
-- Markup is the whole set of strokes on one page (page 0 is an image or a file without pages); saving replaces that page's strokes.
-- An outside link stores only the hash of its token: the token is shown once, in the url the maker gets.

CREATE TABLE IF NOT EXISTS files_comment (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  version_id TEXT,
  anchor TEXT NOT NULL,             -- JSON
  pin INTEGER,
  text TEXT NOT NULL,
  mentions TEXT NOT NULL,           -- JSON list
  author TEXT NOT NULL,
  at INTEGER NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS files_comment__file ON files_comment (file_id);

CREATE TABLE IF NOT EXISTS files_markup (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  page INTEGER NOT NULL,
  strokes TEXT NOT NULL,            -- JSON
  author TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS files_markup__file ON files_markup (file_id);

CREATE TABLE IF NOT EXISTS files_external_link (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  opens INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS files_external_link__file ON files_external_link (file_id);
CREATE UNIQUE INDEX IF NOT EXISTS files_external_link__token ON files_external_link (token_hash);
