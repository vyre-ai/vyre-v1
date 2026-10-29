-- A tested connector another Space can start from.
-- The row stores the app name, the action key, and the title. It does not store a secret or a vault id.

CREATE TABLE IF NOT EXISTS "automations_shared_connectors" (
  "action_key" TEXT PRIMARY KEY,
  "app_name" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "level" TEXT NOT NULL,
  "updated_at" INTEGER NOT NULL
);
