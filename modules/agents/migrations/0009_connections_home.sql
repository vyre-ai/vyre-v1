-- Vault > Connections (owner rulings D28 and D29, 3 Nov 2026, lane l-connections). A connection made by hand gains:
--   owner        the person a Mine connection belongs to (scope 'mine'): only their chats and their agents' turns for them use it; empty for Space and agent connections
--   share_json   who a Space connection is for: ["everyone"] or group ids; an admin sets it
--   source, source_ref   where it came from: registry (with the registry name), paste, import (with the file kind), hub, skill (with the skill name), kit, or hand
--   title        the name people read; the name stays the tool prefix
--   health, health_note, tools, checked_at   the last check: ok, needs_signin, key_refused, not_answering (and why), and how many tools it listed
--   used_at, used_by_json   the last call, and the agents that called it (newest first, a few)
ALTER TABLE "agents_mcp_connections" ADD COLUMN "owner" TEXT NOT NULL DEFAULT '';
ALTER TABLE "agents_mcp_connections" ADD COLUMN "share_json" TEXT NOT NULL DEFAULT '["everyone"]';
ALTER TABLE "agents_mcp_connections" ADD COLUMN "source" TEXT NOT NULL DEFAULT '';
ALTER TABLE "agents_mcp_connections" ADD COLUMN "source_ref" TEXT NOT NULL DEFAULT '';
ALTER TABLE "agents_mcp_connections" ADD COLUMN "title" TEXT NOT NULL DEFAULT '';
ALTER TABLE "agents_mcp_connections" ADD COLUMN "health" TEXT NOT NULL DEFAULT '';
ALTER TABLE "agents_mcp_connections" ADD COLUMN "health_note" TEXT NOT NULL DEFAULT '';
ALTER TABLE "agents_mcp_connections" ADD COLUMN "tools" INTEGER NOT NULL DEFAULT -1;
ALTER TABLE "agents_mcp_connections" ADD COLUMN "checked_at" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "agents_mcp_connections" ADD COLUMN "used_at" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "agents_mcp_connections" ADD COLUMN "used_by_json" TEXT NOT NULL DEFAULT '[]';
-- two people may each have a Mine connection called notion
DROP INDEX IF EXISTS "agents_mcp_connections__name";
CREATE UNIQUE INDEX IF NOT EXISTS "agents_mcp_connections__name_owner" ON "agents_mcp_connections" ("name", "scope", "agent_id", "owner");
-- The Space's rules for connections (Console policy, shown on the Vault page to admins): who may add Space connections, and an allow-list that limits what anyone else may add.
CREATE TABLE IF NOT EXISTS "agents_connection_policy" (
  "key" TEXT PRIMARY KEY,
  "value_json" TEXT NOT NULL,
  "author" TEXT NOT NULL,
  "at" INTEGER NOT NULL
);
-- The catalog as last fetched, so the Add sheet works offline: one row per server of a source.
CREATE TABLE IF NOT EXISTS "agents_mcp_catalog" (
  "id" TEXT PRIMARY KEY,
  "source" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "entry_json" TEXT NOT NULL,
  "at" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "agents_mcp_catalog__source" ON "agents_mcp_catalog" ("source", "name");
