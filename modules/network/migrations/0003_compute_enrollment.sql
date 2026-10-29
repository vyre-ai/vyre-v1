-- Computers that join the Space for compute. A join code is single use; the computer then asks to be admitted with its own public key and waits for a person to approve it.
ALTER TABLE network_join ADD COLUMN scope TEXT NOT NULL DEFAULT 'space';
ALTER TABLE network_join ADD COLUMN used_at INTEGER;
ALTER TABLE network_server ADD COLUMN enrollment TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE network_server ADD COLUMN public_key TEXT;
ALTER TABLE network_server ADD COLUMN fingerprint TEXT;
ALTER TABLE network_server ADD COLUMN facts_json TEXT;
ALTER TABLE network_server ADD COLUMN owner TEXT;
ALTER TABLE network_server ADD COLUMN credential_hash TEXT;
ALTER TABLE network_server ADD COLUMN requested_at INTEGER;
ALTER TABLE network_server ADD COLUMN decided_by TEXT;
ALTER TABLE network_server ADD COLUMN decided_at INTEGER;
