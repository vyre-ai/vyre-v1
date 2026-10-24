-- Automations tables (P-L6_04, spec 2.12, ARCH 7.7). The module declares no entity, so every table is created here.
-- A definition is a JSON graph kept as text; each definition change appends a row to automations_versions (One History).

CREATE TABLE IF NOT EXISTS "automations_defs" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "kind" TEXT NOT NULL,
  "group_id" TEXT,
  "folder_id" TEXT,
  "owner_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "paused_reason" TEXT,
  "version" INTEGER NOT NULL,
  "definition" TEXT NOT NULL,
  "followers" TEXT NOT NULL DEFAULT '[]',
  "alerts" TEXT NOT NULL,
  "created_by" TEXT NOT NULL,
  "created_at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL,
  "deleted_at" INTEGER
);
CREATE INDEX IF NOT EXISTS "automations_defs_owner" ON "automations_defs" ("owner_id", "kind");
CREATE INDEX IF NOT EXISTS "automations_defs_group" ON "automations_defs" ("group_id");
CREATE INDEX IF NOT EXISTS "automations_defs_status" ON "automations_defs" ("status");

CREATE TABLE IF NOT EXISTS "automations_versions" (
  "version_id" TEXT PRIMARY KEY,
  "automation_id" TEXT NOT NULL,
  "n" INTEGER NOT NULL,
  "by_who" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  "reason" TEXT,
  "name" TEXT,
  "definition" TEXT NOT NULL,
  UNIQUE ("automation_id", "n")
);

CREATE TABLE IF NOT EXISTS "automations_groups" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "ord" INTEGER NOT NULL
);

-- The secret in the inbound webhook URL; rotating replaces it.
CREATE TABLE IF NOT EXISTS "automations_webhooks" (
  "automation_id" TEXT PRIMARY KEY,
  "secret" TEXT NOT NULL,
  "rotated_at" INTEGER NOT NULL
);

-- What a promoted Automation holds as itself (the access diff that was confirmed) and the vault names it may use.
CREATE TABLE IF NOT EXISTS "automations_access" (
  "automation_id" TEXT NOT NULL,
  "resource" TEXT NOT NULL,
  "level" TEXT NOT NULL,
  "via" TEXT NOT NULL,
  PRIMARY KEY ("automation_id", "resource", "level")
);
CREATE TABLE IF NOT EXISTS "automations_vault" (
  "automation_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  PRIMARY KEY ("automation_id", "name")
);

-- One row per Run an Automation started: the version it pinned, what started it, and the principal it runs as. The executor reads this by run id.
CREATE TABLE IF NOT EXISTS "automations_runs" (
  "run_id" TEXT PRIMARY KEY,
  "automation_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "trigger_key" TEXT NOT NULL,
  "test" INTEGER NOT NULL DEFAULT 0,
  "payload" TEXT NOT NULL,
  "depth" INTEGER NOT NULL,
  "origin" TEXT,
  "event_id" TEXT,
  "principal_kind" TEXT NOT NULL,
  "principal_id" TEXT NOT NULL,
  "parent_run" TEXT,
  "started_at" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "automations_runs_automation" ON "automations_runs" ("automation_id", "started_at");

-- Space policy values for the three automations.* settings; a missing row means the default of the manifest.
CREATE TABLE IF NOT EXISTS "automations_policy" (
  "policy_key" TEXT PRIMARY KEY,
  "policy_value" TEXT NOT NULL
);
