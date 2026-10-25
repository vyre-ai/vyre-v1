-- email-builder-api: email designs with a version per save, and composer snippets (spec 2.19, 3.6).
-- blocks, html and plain hold the design as the author wrote it; the compiled HTML is made on demand and never stored.

CREATE TABLE IF NOT EXISTS email_builder_email (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT NOT NULL,
  owner TEXT NOT NULL,
  subject TEXT,
  blocks TEXT,
  html TEXT,
  plain TEXT,
  version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS email_builder_email__updated ON email_builder_email (updated_at);

CREATE TABLE IF NOT EXISTS email_builder_version (
  email_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  doc TEXT NOT NULL,
  at INTEGER NOT NULL,
  author TEXT NOT NULL,
  PRIMARY KEY (email_id, version)
);

CREATE TABLE IF NOT EXISTS email_builder_snippet (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  shortcut TEXT,
  shared INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS email_builder_snippet__owner ON email_builder_snippet (owner);

-- saved blocks: a block (type and props as JSON) a person keeps to drop into any design; shared ones are visible to the Space.
CREATE TABLE IF NOT EXISTS email_builder_block (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  block TEXT NOT NULL,
  shared INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS email_builder_block__owner ON email_builder_block (owner);
