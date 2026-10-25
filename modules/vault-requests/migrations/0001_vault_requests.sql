-- Vault requests (P-L7_12, spec 2.17, ARCH 7.8). Every table is named vault_requests_* (ctx.db guard, ARCH B2).
-- A request asks the managers of a vault folder (or the Space's vault managers) for a key it needs. The row holds the request, who may decide it, and its cards; it never holds a value.
CREATE TABLE IF NOT EXISTS "vault_requests_requests" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "fields_json" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "requester_kind" TEXT NOT NULL,
  "requester_id" TEXT NOT NULL,
  "for_run" TEXT,
  "folder_id" TEXT,
  "state" TEXT NOT NULL,
  "item_id" TEXT,
  "note" TEXT,
  "idem_key" TEXT NOT NULL,
  "managers_json" TEXT NOT NULL,
  "task_ids_json" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  "decided_by" TEXT,
  "decided_at" INTEGER
);
CREATE INDEX IF NOT EXISTS "vault_requests_by_requester" ON "vault_requests_requests" ("requester_id", "state");
