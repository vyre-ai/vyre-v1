-- esign: the seal on a finished signed PDF. The Space's own signing key is made the first time a file is sealed and kept only as ciphertext (sealed_key, the server's own sealing: ctx.seal);
-- esign_seal_cert lists every certificate this Space has sealed with (the one it made, or one brought through the Vault item Document_Seal), public parts only.

CREATE TABLE IF NOT EXISTS esign_seal (
  slot TEXT PRIMARY KEY,
  cert TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  sealed_key TEXT NOT NULL,
  made_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS esign_seal_cert (
  fingerprint TEXT PRIMARY KEY,
  cert TEXT NOT NULL,
  made_at INTEGER NOT NULL,
  source TEXT NOT NULL
);

ALTER TABLE esign_envelope ADD COLUMN seal_fingerprint TEXT;
