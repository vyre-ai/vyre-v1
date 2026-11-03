-- memory: each person's memory public key in this Space (owner ruling 3 Nov 2026, spec b7). Only the public half of a key pair made from the person key; it lets background jobs seal a person's
-- new facts while they are signed out. The private half is never stored: it is made again from the person key while the keyring holds it.
CREATE TABLE IF NOT EXISTS memory_person_keys (
  owner_ref TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  key_tag TEXT NOT NULL,
  registered_at INTEGER NOT NULL
);
