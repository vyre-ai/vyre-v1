-- esign: built-in signing (provider vyre; contract SIGN-CONTRACT-R33). Only built-in envelopes use these tables; hosted providers keep 0001's.
-- A signer's link token is never stored: only its SHA-256. The sent document is stored as sent, so editing the file afterwards changes nothing.

ALTER TABLE esign_envelope ADD COLUMN expires_at INTEGER;
ALTER TABLE esign_envelope ADD COLUMN message TEXT;
ALTER TABLE esign_envelope ADD COLUMN declined_reason TEXT;
ALTER TABLE esign_envelope ADD COLUMN original_sha256 TEXT;
ALTER TABLE esign_envelope ADD COLUMN sent_sha256 TEXT;
ALTER TABLE esign_envelope ADD COLUMN final_sha256 TEXT;
ALTER TABLE esign_envelope ADD COLUMN sender_name TEXT;

CREATE TABLE IF NOT EXISTS esign_vsigner (
  envelope_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  order_no INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  token_hash TEXT,
  token_made_at INTEGER,
  viewed_at INTEGER,
  signed_at INTEGER,
  signed_name TEXT,
  sig_kind TEXT,
  sig_text TEXT,
  sig_png BLOB,
  PRIMARY KEY (envelope_id, idx)
);

CREATE UNIQUE INDEX IF NOT EXISTS esign_vsigner__token ON esign_vsigner (token_hash);

CREATE TABLE IF NOT EXISTS esign_doc (
  envelope_id TEXT PRIMARY KEY,
  sent BLOB NOT NULL,
  final BLOB,
  places TEXT NOT NULL,
  pages TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS esign_event (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  envelope_id TEXT NOT NULL,
  signer_idx INTEGER,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  ip TEXT,
  ua TEXT,
  detail TEXT
);

CREATE INDEX IF NOT EXISTS esign_event__envelope ON esign_event (envelope_id, seq);
