-- site operations (r42-sites-run, slices 4 and 5): what a site printed, how it ran, its services, its scheduled jobs and their runs, and backups of its database.
-- Logs are bounded per scope (a deploy, a service or a job run) and per site by the store, never by hand. Samples are one a minute and a day old at most. Nothing here holds a secret.
CREATE TABLE IF NOT EXISTS sites_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  source TEXT NOT NULL,
  at INTEGER NOT NULL,
  level TEXT NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sites_log_scope ON sites_log (site_id, scope, id);

CREATE TABLE IF NOT EXISTS sites_log_cursor (
  site_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  ns TEXT NOT NULL,
  PRIMARY KEY (site_id, scope)
);

CREATE TABLE IF NOT EXISTS sites_metric (
  site_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  cpu REAL NOT NULL DEFAULT 0,
  mem_mb REAL NOT NULL DEFAULT 0,
  requests INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  p50 INTEGER NOT NULL DEFAULT 0,
  p95 INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, at)
);

CREATE TABLE IF NOT EXISTS sites_service (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  command TEXT NOT NULL,
  state TEXT NOT NULL,
  container_id TEXT,
  deployment_id TEXT,
  started_at INTEGER,
  restart_at INTEGER,
  streak INTEGER NOT NULL DEFAULT 0,
  crashes TEXT NOT NULL DEFAULT '[]',
  last_exit TEXT,
  note TEXT,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS sites_service_site ON sites_service (site_id);

CREATE TABLE IF NOT EXISTS sites_job (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  name TEXT NOT NULL,
  schedule TEXT NOT NULL,
  command TEXT NOT NULL,
  zone TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  timeout_sec INTEGER NOT NULL DEFAULT 600,
  last_slot INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS sites_job_site ON sites_job (site_id);

CREATE TABLE IF NOT EXISTS sites_job_run (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  state TEXT NOT NULL,
  slot INTEGER NOT NULL,
  by TEXT NOT NULL,
  queued_at INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER,
  exit_code INTEGER,
  note TEXT
);
CREATE INDEX IF NOT EXISTS sites_job_run_job ON sites_job_run (job_id, queued_at);

CREATE TABLE IF NOT EXISTS sites_backup (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  by TEXT NOT NULL,
  at INTEGER NOT NULL,
  ended_at INTEGER,
  bytes INTEGER,
  file_id TEXT,
  note TEXT,
  pinned INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS sites_backup_site ON sites_backup (site_id, at);
