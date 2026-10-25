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
