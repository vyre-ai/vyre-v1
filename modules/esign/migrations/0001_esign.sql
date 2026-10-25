-- esign: envelopes sent for signature, their signers, the default provider and a webhook dedupe table (spec 2.20, 3.6; ARCH 8.4).
-- Status values: envelope.status and signer.status are sent | viewed | signed | declined | cancelled.
-- Provider credentials are never stored here (they live in the Vault and in the provider objects the host configures).

CREATE TABLE IF NOT EXISTS esign_envelope (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_ref TEXT NOT NULL,
  title TEXT NOT NULL,
  file_id TEXT NOT NULL,
  folder_id TEXT,
  record_id TEXT,
  status TEXT NOT NULL,
  task_id TEXT,
  thread_id TEXT,
  signed_file_id TEXT,
  certificate_file_id TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS esign_envelope__ref ON esign_envelope (provider, provider_ref);
CREATE INDEX IF NOT EXISTS esign_envelope__record ON esign_envelope (record_id);
CREATE INDEX IF NOT EXISTS esign_envelope__file ON esign_envelope (file_id);

CREATE TABLE IF NOT EXISTS esign_signer (
  envelope_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  order_no INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  viewed_at INTEGER,
  signed_at INTEGER,
  PRIMARY KEY (envelope_id, email)
);

CREATE TABLE IF NOT EXISTS esign_setting (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS esign_hook_seen (
  provider TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (provider, dedupe_key)
);
