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
-- taken yet, synced_at is when this computer last reached one, box the Space's box key (public) a server's join code carries.
CREATE TABLE IF NOT EXISTS network_peer_self (
  id INTEGER PRIMARY KEY,
  peer_id TEXT NOT NULL,
  waiting INTEGER NOT NULL DEFAULT 0,
  synced_at INTEGER,
  box TEXT
);
-- Which computer of a Personal Space runs the Space's scheduled work (automations, routines, watchers, provider pulls, nightly jobs): one at a time, by a lease every computer copies.
-- The holder renews expires_at every 30 seconds; when it sleeps, another computer takes it once it runs out. A server of the Space takes it from a computer.
CREATE TABLE IF NOT EXISTS network_runner (
  id TEXT PRIMARY KEY,
  peer_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  since INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
-- What a sync had to settle on this computer: the same name made on two computers while apart (one renamed), or a row that could not be merged and is kept whole aside.
CREATE TABLE IF NOT EXISTS network_peer_conflict (
  id TEXT PRIMARY KEY,
  store TEXT NOT NULL,
  tbl TEXT NOT NULL,
  row_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL,
  at INTEGER NOT NULL
);
-- A server joining this Personal Space with a one-time code (Settings, Computers, Add a server). The code carries this computer's route and the Space's box key (both public) and a secret whose hash
-- is kept here; it works once, for 30 minutes, and the person who made it allowed the server by making it.
CREATE TABLE IF NOT EXISTS network_peer_invite (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
-- A file's contents (a blob under blobs/) deleted on one computer of a Personal Space: the tombstone travels like any row, and every computer deletes its copy and never fetches it again.
CREATE TABLE IF NOT EXISTS network_peer_blob_gone (
  path TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);
-- The blobs this computer has had (never copied): one that was here and is gone was deleted here, so its tombstone is written.
CREATE TABLE IF NOT EXISTS network_peer_blob_seen (
  path TEXT PRIMARY KEY
);
