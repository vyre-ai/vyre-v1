CREATE TABLE IF NOT EXISTS identity_recovery_noise (
  space TEXT PRIMARY KEY,
  seed TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS identity_recovery_challenges ON identity_codes (kind, person_id, expires_at);
-- A ciphertext hash is never a recovery credential. Existing encrypted wraps remain usable.
UPDATE identity_accounts SET recovery_hash = NULL;
