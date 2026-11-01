-- OAuth for remote MCP connections (MCP authorization: discovery, a registered public client, PKCE). One row per connection: where its authorization server is, the client id the server gave
-- Vyre, and the tokens, sealed with ctx.seal (scope mcp.oauth), never plain. The pending half (state, the PKCE verifier sealed, the redirect address and who started it) lives in the same row
-- until the sign-in comes back. No capability answers with a token.
CREATE TABLE IF NOT EXISTS engine_mcp_oauth (
  connection_id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  token_endpoint TEXT NOT NULL,
  client_id TEXT NOT NULL,
  tokens_sealed TEXT,
  expires_at INTEGER,
  pending_state TEXT,
  pending_verifier_sealed TEXT,
  redirect_uri TEXT,
  started_by TEXT,
  updated_at INTEGER NOT NULL
);
