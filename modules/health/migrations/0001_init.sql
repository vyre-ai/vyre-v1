-- health: check samples, latest rows, pause reasons, services, probe overrides, support bundles.
CREATE TABLE IF NOT EXISTS health_sample (
  key TEXT NOT NULL,
  at INTEGER NOT NULL,
  state TEXT NOT NULL,
  latency_ms INTEGER,
  detail TEXT,
  PRIMARY KEY (key, at)
);

CREATE TABLE IF NOT EXISTS health_latest (
  key TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  state TEXT NOT NULL,
  detail TEXT,
  checked_at INTEGER NOT NULL,
  module TEXT NOT NULL,
  next TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS health_pause (
  area TEXT NOT NULL,
  key TEXT NOT NULL,
  reason TEXT NOT NULL,
  PRIMARY KEY (area, key)
);

CREATE TABLE IF NOT EXISTS health_service (
  name TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  restarts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS health_probe (
  cap TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  detail TEXT,
  latency_ms INTEGER,
  free_bytes INTEGER,
  skew_ms INTEGER
);

CREATE TABLE IF NOT EXISTS health_bundle (
  idempotency_key TEXT PRIMARY KEY,
  bundle_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
