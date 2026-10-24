-- health module tables (P-L7b_02; spec 4.18, ARCH 3.5 HealthCheckDef, 7.10).
-- Every table is prefixed health_ because ctx.db refuses any other name.

-- The latest result of each manifest health check. title, module and next are copied from the HealthCheckDef when the check runs,
-- so health.status never needs the manifests. since is the time the state last changed.
CREATE TABLE IF NOT EXISTS health_state (
  check_key TEXT PRIMARY KEY,
  module TEXT NOT NULL,
  title TEXT NOT NULL,
  state TEXT NOT NULL,
  detail TEXT,
  latency_ms INTEGER,
  checked_at INTEGER NOT NULL,
  since INTEGER NOT NULL,
  next TEXT NOT NULL
);

-- One row per run of a check, for health.history. Pruned after 30 days.
CREATE TABLE IF NOT EXISTS health_sample (
  id INTEGER PRIMARY KEY,
  check_key TEXT NOT NULL,
  at INTEGER NOT NULL,
  state TEXT NOT NULL,
  latency_ms INTEGER,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS health_sample_key ON health_sample(check_key, at);
CREATE INDEX IF NOT EXISTS health_sample_at ON health_sample(at);

-- What an unhealthy check holds back, with the reason shown on the paused automation, sync, send or campaign.
CREATE TABLE IF NOT EXISTS health_pause (
  area TEXT NOT NULL,
  check_key TEXT NOT NULL,
  reason TEXT NOT NULL,
  since INTEGER NOT NULL,
  PRIMARY KEY (area, check_key)
);

-- What the host reports about itself: disk encryption, event log, search index lag, scheduler ticks, Docker, Caddy, free disk, clock skew.
-- The host daemon (supervisor, scheduler, diskcheck, caddy driver) writes one row per probe; the health.<probe> capabilities read it.
-- name is the probe name (disk_encrypted, events_db, index_db, scheduler, docker, caddy, disk_space, time_skew).
-- values_json holds the numbers an expression may read, for example {"freeBytes":123} or {"skewMs":40}.
CREATE TABLE IF NOT EXISTS health_probe (
  name TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  detail TEXT,
  latency_ms INTEGER,
  values_json TEXT,
  at INTEGER NOT NULL
);

-- Server services as the supervisor reports them. started_at gives the uptime.
CREATE TABLE IF NOT EXISTS health_service (
  name TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  restarts INTEGER NOT NULL
);

-- A restart asked for in Console. The supervisor picks up rows with done_at empty, restarts the service, sets done_at and updates health_service.
CREATE TABLE IF NOT EXISTS health_restart (
  id TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  by_principal TEXT NOT NULL,
  on_behalf TEXT,
  at INTEGER NOT NULL,
  done_at INTEGER
);
CREATE INDEX IF NOT EXISTS health_restart_open ON health_restart(done_at, at);

-- A support bundle: ids, versions, health and log metadata, never content.
CREATE TABLE IF NOT EXISTS health_bundle (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  by_principal TEXT NOT NULL,
  at INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  body TEXT NOT NULL
);
