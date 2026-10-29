-- OAuth sign-in. The flow row adds what a state must be bound to (who started it, the PKCE verifier); the token row records WHERE the tokens are in the Vault (item ids) and when the access
-- token ends. No token, code or secret is ever stored here: tokens live in Vault items and the connection keeps only their handles.
CREATE TABLE IF NOT EXISTS cn_oauth_flow (
  state TEXT PRIMARY KEY, started_by TEXT NOT NULL, verifier TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cn_oauth_tokens (
  connection_id TEXT NOT NULL, slot TEXT NOT NULL, item_id TEXT NOT NULL, expires_at INTEGER, PRIMARY KEY (connection_id, slot)
);
