-- NOTE: a module may only touch tables that start with its id (email_builder_api_), so this table follows the rule; the 0001 tables (email_builder_*) do not and must be renamed
-- in a later migration before the module goes live (P-L8_LIVE).
-- saved blocks: a block (type and props as JSON) a person keeps to drop into any design; shared ones are visible to the Space.
CREATE TABLE IF NOT EXISTS email_builder_api_block (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  block TEXT NOT NULL,
  shared INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS email_builder_api_block__owner ON email_builder_api_block (owner);
