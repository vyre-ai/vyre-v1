-- sites: promotion history (which staging build became which production deployment) and site tables (site-scoped record types).
-- A production deployment is a row of sites_deployment with env = production; sites_promotion says where it came from.
-- Site tables keep their definition and versioned migrations here; the record type key stays the same when a table is promoted to the Space.

CREATE TABLE IF NOT EXISTS sites_promotion (
  production_id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  source_id TEXT,
  pr_number INTEGER,
  merge_sha TEXT,
  promoted_by TEXT NOT NULL,
  at INTEGER NOT NULL,
  rolled_back_at INTEGER
);

CREATE INDEX IF NOT EXISTS sites_promotion__site ON sites_promotion (site_id);

CREATE TABLE IF NOT EXISTS sites_table (
  type TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  key TEXT NOT NULL,
  fields TEXT NOT NULL,
  scope TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  promoted_by TEXT,
  promoted_at INTEGER
);

CREATE INDEX IF NOT EXISTS sites_table__site ON sites_table (site_id);

CREATE TABLE IF NOT EXISTS sites_table_version (
  type TEXT NOT NULL,
  version INTEGER NOT NULL,
  change TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  by TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (type, version)
);
