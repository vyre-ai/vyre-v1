-- portal: outside accounts of a site (not Space members), their sessions, one-use links, row rules and sign-in throttling.
-- Secrets are never stored: password_hash is PBKDF2-SHA256 with a per-account salt; link and session tokens are stored as SHA-256 hashes only.
-- Status values: account.state is invited | active | disabled; account.method is magic_link | password.

CREATE TABLE IF NOT EXISTS portal_account (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  email TEXT NOT NULL,
  method TEXT NOT NULL,
  state TEXT NOT NULL,
  password_hash TEXT,
  record_id TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  disabled_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS portal_account__site_email ON portal_account (site_id, email);
CREATE INDEX IF NOT EXISTS portal_account__record ON portal_account (record_id);

CREATE TABLE IF NOT EXISTS portal_link (
  account_id TEXT NOT NULL,
  record_type TEXT NOT NULL,
  rule TEXT NOT NULL,
  created_by TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (account_id, record_type)
);

CREATE TABLE IF NOT EXISTS portal_magic (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS portal_magic__account ON portal_magic (account_id);

CREATE TABLE IF NOT EXISTS portal_session (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS portal_session__account ON portal_session (account_id);

CREATE TABLE IF NOT EXISTS portal_attempt (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
