-- Plugins and outside tools (CHAT-DESIGN rulings 4 and 6). A marketplace is a git URL or a folder with .claude-plugin/marketplace.json; an installed plugin keeps its text files here so the
-- sandbox can be given them. Nothing in these tables runs: plugin code runs only in the agent's sandbox.
CREATE TABLE IF NOT EXISTS "agents_marketplaces" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "kind" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "ref" TEXT NOT NULL,
  "owner_name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "catalog_json" TEXT NOT NULL,
  "files_json" TEXT NOT NULL,
  "warnings_json" TEXT NOT NULL,
  "revision" TEXT NOT NULL,
  "author" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  "updated_at" INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS "agents_plugins" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "marketplace_id" TEXT NOT NULL,
  "marketplace" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "contents_json" TEXT NOT NULL,
  "files_json" TEXT NOT NULL,
  "config_json" TEXT NOT NULL,
  "enabled" INTEGER NOT NULL,
  "author" TEXT NOT NULL,
  "at" INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "agents_plugins__name" ON "agents_plugins" ("name", "scope", "agent_id");
CREATE TABLE IF NOT EXISTS "agents_plugin_allow" (
  "kind" TEXT NOT NULL,
  "marketplace" TEXT NOT NULL,
  "plugin" TEXT NOT NULL,
  "author" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  PRIMARY KEY ("kind", "marketplace", "plugin")
);
CREATE TABLE IF NOT EXISTS "agents_mcp_connections" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL,
  "transport" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "command" TEXT NOT NULL,
  "args_json" TEXT NOT NULL,
  "env_json" TEXT NOT NULL,
  "headers_json" TEXT NOT NULL,
  "enabled" INTEGER NOT NULL,
  "author" TEXT NOT NULL,
  "at" INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "agents_mcp_connections__name" ON "agents_mcp_connections" ("name", "scope", "agent_id");
