-- One Personal Space on several computers (lane l-multidevice). Every computer that holds a full copy of the Space is a peer; the host daemon writes these rows (host/src/peers).
-- network_peer is the Space's list of its computers, the same on each of them: name, what it runs, how the relay reaches it (route and the Space's shared box key, both public), and the hash
-- of the token it proves itself with when it asks another computer for changes. last_seen_at is when any computer last heard from it.
CREATE TABLE IF NOT EXISTS network_peer (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'computer',
  route TEXT NOT NULL,
  relay TEXT NOT NULL,
  token_hash TEXT,
  added_at INTEGER NOT NULL,
  added_by TEXT,
  last_seen_at INTEGER,
  removed_at INTEGER
);
-- A new computer asking to use this Personal Space, waiting for the person to allow it here (local to the computer that was asked). poll_hash: the hash of the secret the new computer
-- polls with; ask_hash: the hash of its sign-in-by-name secret. The token and the Space's keys are handed over once, inside the end-to-end channel, and never stored here.
CREATE TABLE IF NOT EXISTS network_peer_request (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL,
  poll_hash TEXT NOT NULL,
  ask_hash TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  decided_by TEXT,
  decided_at INTEGER,
  peer_id TEXT
);
-- Which network_peer row is this computer (one row, never copied to another computer), and how its copy stands: waiting counts the rows written here that another computer has not
-- taken yet, synced_at is when this computer last reached one.
CREATE TABLE IF NOT EXISTS network_peer_self (
  id INTEGER PRIMARY KEY,
  peer_id TEXT NOT NULL,
  waiting INTEGER NOT NULL DEFAULT 0,
  synced_at INTEGER
);
