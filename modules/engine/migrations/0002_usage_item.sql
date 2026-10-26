-- Which Vault item (the API key or the sign-in) paid for a turn (P-CC_36). A table of its own rather than a column on engine_usage, so 0001 stays as a Space may already have applied it
-- and this file can run again without error. A turn with no row here has no known key (usage before this shipped, or a local model).
CREATE TABLE IF NOT EXISTS engine_usage_item (
  turn_id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS engine_usage_item_item ON engine_usage_item (item_id);
