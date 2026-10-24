-- connectors module state (ARCH 8). Connectors (live definitions, drafts, versions) and Connections. Secrets are never stored: a connection keeps the NAME of the Vault item for each secret.
CREATE TABLE IF NOT EXISTS cn_connectors (
  key TEXT PRIMARY KEY, title TEXT NOT NULL, mode TEXT NOT NULL, scope TEXT NOT NULL, builtin INTEGER NOT NULL DEFAULT 0, version TEXT NOT NULL,
  state TEXT NOT NULL, def TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cn_drafts (
  draft_id TEXT PRIMARY KEY, key TEXT NOT NULL, def TEXT NOT NULL, note TEXT, created_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cn_drafts_key ON cn_drafts (key, created_at);
CREATE TABLE IF NOT EXISTS cn_versions (
  key TEXT NOT NULL, version TEXT NOT NULL, def TEXT NOT NULL, at INTEGER NOT NULL, by TEXT NOT NULL, note TEXT, tests INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (key, version)
);
CREATE TABLE IF NOT EXISTS cn_connections (
  connection_id TEXT PRIMARY KEY, connector TEXT NOT NULL, title TEXT NOT NULL, owner_kind TEXT NOT NULL, owner_id TEXT NOT NULL, state TEXT NOT NULL, paused_by TEXT, paused_from TEXT,
  scopes TEXT NOT NULL DEFAULT '[]', secrets TEXT NOT NULL DEFAULT '{}', last_sync_at INTEGER, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cn_connections_connector ON cn_connections (connector);
CREATE TABLE IF NOT EXISTS cn_oauth (state TEXT PRIMARY KEY, connection_id TEXT NOT NULL, created_at INTEGER NOT NULL, reconnect INTEGER NOT NULL DEFAULT 0);
-- One row per call to the app: what was called, never a secret, a header value or a body.
CREATE TABLE IF NOT EXISTS cn_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, connection_id TEXT, connector TEXT NOT NULL, action TEXT NOT NULL, method TEXT, host TEXT, path TEXT, status INTEGER, ms INTEGER, error TEXT, actor TEXT
);
CREATE INDEX IF NOT EXISTS cn_log_connection ON cn_log (connection_id, at);
