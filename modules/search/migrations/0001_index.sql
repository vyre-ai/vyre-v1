-- search: the one server index (ARCH 4.3 consumers search.fts and search.vectors, ARCH 9; spec b11).
-- Every table is search_*: ctx.db refuses anything else. End-to-end content (private chats, personal memory, Mine vault items) is never written here: the index consumer drops it.
-- A document is deleted and inserted again when it changes, so its rowid grows with recency; the full text table shares that rowid.

CREATE TABLE IF NOT EXISTS search_docs (
  n INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  path TEXT,
  link TEXT NOT NULL,
  label INTEGER NOT NULL DEFAULT 0,
  res_type TEXT NOT NULL,
  res_id TEXT,
  folder_id TEXT,
  record_type TEXT,
  updated_at INTEGER,
  embedded INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS search_docs_key ON search_docs (entity, id);
CREATE INDEX IF NOT EXISTS search_docs_kind ON search_docs (kind, id);
CREATE INDEX IF NOT EXISTS search_docs_pending ON search_docs (embedded, n);

-- Full text: BM25 over title and body, prefix indexes for type-ahead; kind, record type and folder are indexed columns so a filter is part of the match.
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(title, body, kind, rtype, folder, tokenize='unicode61 remove_diacritics 2', prefix='1 2 3');

-- One 384-dimension vector per document, as a little-endian float32 BLOB (brute-force cosine; sqlite-vec is an optional accelerator).
CREATE TABLE IF NOT EXISTS search_vectors (
  n INTEGER PRIMARY KEY,
  dim INTEGER NOT NULL,
  vec BLOB NOT NULL
);

-- The last sequence applied for an entity row, so a repeated or late event is harmless; a delete leaves its sequence here.
CREATE TABLE IF NOT EXISTS search_seen (
  entity TEXT NOT NULL,
  id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  PRIMARY KEY (entity, id)
);

-- Rows the indexer could not read yet (the source answered with an error): retried by the next apply or rebuild, counted as lag.
CREATE TABLE IF NOT EXISTS search_failed (
  entity TEXT NOT NULL,
  id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  error TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (entity, id)
);

-- What each person opened, newest first (Recent before typing).
CREATE TABLE IF NOT EXISTS search_recent (
  principal TEXT NOT NULL,
  kind TEXT NOT NULL,
  item_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (principal, kind, item_id)
);
CREATE INDEX IF NOT EXISTS search_recent_at ON search_recent (principal, at);

CREATE TABLE IF NOT EXISTS search_meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
