-- A portable copy of an Automation definition. The list is empty until someone exports one.
-- The row stores the definition graph. It does not store vault secrets.

CREATE TABLE IF NOT EXISTS "automations_packages" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "source_automation_id" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "definition" TEXT NOT NULL,
  "created_at" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "automations_packages_owner" ON "automations_packages" ("owner_id", "created_at");
