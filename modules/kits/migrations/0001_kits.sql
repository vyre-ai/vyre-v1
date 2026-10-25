-- kits: the Kits this Space knows (built in or published), their versions, what each install applied, sandbox denials and test runs (spec 2.21; ARCH 7.6, 10.4).
-- A Kit version row holds the whole manifest as JSON. Nothing secret is stored: a Kit names Vault handles, never values.
-- Status values: kit_version.state is live | retired; channel is stable | beta.

CREATE TABLE IF NOT EXISTS kits_kit (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  channel TEXT NOT NULL,
  builtin INTEGER NOT NULL DEFAULT 0,
  installed_version TEXT,
  previous_version TEXT,
  installed_by TEXT,
  installed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS kits_kit__key ON kits_kit (key);

CREATE TABLE IF NOT EXISTS kits_version (
  id TEXT PRIMARY KEY,
  kit_id TEXT NOT NULL,
  version TEXT NOT NULL,
  channel TEXT NOT NULL,
  content TEXT NOT NULL,
  hash TEXT NOT NULL,
  published_by TEXT NOT NULL,
  at INTEGER NOT NULL,
  state TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS kits_version__kit_version ON kits_version (kit_id, version);

CREATE TABLE IF NOT EXISTS kits_head (
  kit_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  version_id TEXT NOT NULL,
  PRIMARY KEY (kit_id, channel)
);

CREATE TABLE IF NOT EXISTS kits_applied (
  kit_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  item_hash TEXT NOT NULL,
  undo TEXT,
  at INTEGER NOT NULL,
  PRIMARY KEY (kit_id, item_key)
);

CREATE TABLE IF NOT EXISTS kits_denial (
  id TEXT PRIMARY KEY,
  kit_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  what TEXT NOT NULL,
  trace_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS kits_denial__kit ON kits_denial (kit_id);

CREATE TABLE IF NOT EXISTS kits_test_run (
  id TEXT PRIMARY KEY,
  kit_id TEXT NOT NULL,
  version TEXT NOT NULL,
  passed INTEGER NOT NULL,
  failures TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS kits_test_run__kit ON kits_test_run (kit_id);
