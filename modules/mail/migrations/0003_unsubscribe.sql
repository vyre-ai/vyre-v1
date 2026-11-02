-- Unsubscribe links in regular email (spec 2.18): one row per link, per person. Only the hash of a token is kept. used_at is set once the opt-out took effect.

CREATE TABLE IF NOT EXISTS mail_unsub (
  token_hash TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  created_at INTEGER,
  used_at INTEGER
);
