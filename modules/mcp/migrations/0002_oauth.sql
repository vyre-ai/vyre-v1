-- Sign-in for outside agents: Vyre is the OAuth 2.1 authorization server of its own /mcp. No secret is stored: codes and tokens are kept as SHA-256, and a client has no secret at all (public clients, PKCE only).

-- A client that registered itself (RFC 7591). Everything here is what the client says about itself: the name is shown as such, and a logo or a home page is never kept.
CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
  client_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  used_at INTEGER
);

-- One press waiting: a client asked to join and a person has not answered yet. The tab that asked holds the proof (only its hash is here); the code reaches only that tab.
CREATE TABLE IF NOT EXISTS mcp_oauth_requests (
  request_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  state TEXT,
  resource TEXT NOT NULL,
  proof_hash TEXT NOT NULL,
  match TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  person TEXT,
  agent_id TEXT,
  grant_id TEXT,
  delivered_at INTEGER
);
CREATE INDEX IF NOT EXISTS mcp_oauth_requests__expires ON mcp_oauth_requests (expires_at);

-- One sign-in: this client, for this person, as this agent, for this address. Every code and token hangs off it, so ending it ends all of them at once.
CREATE TABLE IF NOT EXISTS mcp_oauth_grants (
  grant_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  person TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  redirect_host TEXT,
  session_id TEXT,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  revoked_why TEXT
);
CREATE INDEX IF NOT EXISTS mcp_oauth_grants__agent ON mcp_oauth_grants (agent_id);
CREATE INDEX IF NOT EXISTS mcp_oauth_grants__person ON mcp_oauth_grants (person);

-- A code (60 seconds, one use), an access token (15 minutes) or a refresh token (rotated at every use). kind: code | access | refresh.
CREATE TABLE IF NOT EXISTS mcp_oauth_tokens (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  grant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  redirect_uri TEXT,
  code_challenge TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS mcp_oauth_tokens__grant ON mcp_oauth_tokens (grant_id);

-- What an outside agent did, for its profile: the tool, how it ended and where. Never an input or an answer.
CREATE TABLE IF NOT EXISTS mcp_activity (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  person TEXT NOT NULL,
  tool TEXT NOT NULL,
  cap TEXT,
  outcome TEXT NOT NULL,
  thread_id TEXT,
  task_id TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mcp_activity__agent ON mcp_activity (agent_id, at);
