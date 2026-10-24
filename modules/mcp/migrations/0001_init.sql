-- mcp: tokens and sessions of the MCP server (ARCH 6.6, 6.7; spec 2.2, 4.12).
-- Every table is mcp_*: ctx.db refuses anything else. No secret is stored, only the SHA-256 of a token.

-- A one-time registration token for an outside agent, and what it became once the outside tool traded it in. state: issued | registered | revoked.
CREATE TABLE IF NOT EXISTS mcp_tokens (
  token_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  channel_id TEXT,
  scopes TEXT NOT NULL,
  issued_by TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  state TEXT NOT NULL,
  actor_id TEXT UNIQUE,
  cred_hash TEXT UNIQUE,
  registered_at INTEGER,
  client_name TEXT,
  client_version TEXT,
  reveals INTEGER NOT NULL DEFAULT 0
);

-- A session of the MCP server: an outside actor connected with its credential, or a CLI engine's loopback session (token_hash set at mint).
CREATE TABLE IF NOT EXISTS mcp_sessions (
  session_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  token_hash TEXT UNIQUE,
  token_id TEXT,
  principal TEXT NOT NULL,
  acting_for TEXT,
  thread_id TEXT,
  run_id TEXT,
  trace_id TEXT,
  name TEXT,
  scopes TEXT,
  started_at INTEGER NOT NULL,
  expires_at INTEGER,
  last_call_at INTEGER,
  calls INTEGER NOT NULL DEFAULT 0,
  closed_at INTEGER
);
CREATE INDEX IF NOT EXISTS mcp_sessions_started ON mcp_sessions (started_at);
CREATE INDEX IF NOT EXISTS mcp_sessions_principal ON mcp_sessions (principal);
