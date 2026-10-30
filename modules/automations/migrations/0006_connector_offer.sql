-- One connector setup offer per Vault item. The row stores the item id, the app name, and the decision.
-- It does not store a key, a field value, or a field name.

CREATE TABLE IF NOT EXISTS "automations_connector_offers" (
  "item_id" TEXT PRIMARY KEY,
  "app_name" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "updated_at" INTEGER NOT NULL
);
