-- One level per connector action. The row stores the action key and the level.
-- It does not store a secret, a field value, or a field name.

CREATE TABLE IF NOT EXISTS "automations_connector_levels" (
  "action_key" TEXT PRIMARY KEY,
  "level" TEXT NOT NULL,
  "updated_at" INTEGER NOT NULL
);
