-- sites: sites, deployments (builds, staging, previews, production), env names, domains, routes, service grants, activity.
-- Environment values are never stored here: sites_env keeps the name and the Vault handle only (spec 2.20).
-- Status values: site.state and deployment.state are queued | building | ready | failed | stopped.

CREATE TABLE IF NOT EXISTS sites_site (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  owner TEXT NOT NULL,
  repo_url TEXT,
  repo_folder_id TEXT,
  template_kit TEXT,
  state TEXT NOT NULL,
  settings TEXT NOT NULL DEFAULT '{}',
  staging_secret TEXT,
  service_principal TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS sites_site__owner ON sites_site (owner);
CREATE INDEX IF NOT EXISTS sites_site__folder ON sites_site (repo_folder_id);

CREATE TABLE IF NOT EXISTS sites_deployment (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  env TEXT NOT NULL,
  state TEXT NOT NULL,
  url TEXT,
  branch TEXT,
  commit_sha TEXT,
  image TEXT,
  container_id TEXT,
  host TEXT,
  upstream TEXT,
  pr_number INTEGER,
  log TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL,
  at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  removed_at INTEGER,
  merge_pending INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS sites_deployment__site ON sites_deployment (site_id);
CREATE INDEX IF NOT EXISTS sites_deployment__env ON sites_deployment (site_id, env);

CREATE TABLE IF NOT EXISTS sites_env (
  site_id TEXT NOT NULL,
  name TEXT NOT NULL,
  vault_handle TEXT NOT NULL,
  injected INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, name)
);

CREATE TABLE IF NOT EXISTS sites_domain (
  site_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  dns_ok INTEGER NOT NULL DEFAULT 0,
  certificate TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  checked_at INTEGER NOT NULL,
  PRIMARY KEY (site_id, domain)
);

CREATE INDEX IF NOT EXISTS sites_domain__domain ON sites_domain (domain);

CREATE TABLE IF NOT EXISTS sites_route (
  host TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  deployment_id TEXT NOT NULL,
  env TEXT NOT NULL,
  auth_handle TEXT,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sites_route__site ON sites_route (site_id);

CREATE TABLE IF NOT EXISTS sites_grant (
  site_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  level TEXT NOT NULL,
  PRIMARY KEY (site_id, resource)
);

CREATE TABLE IF NOT EXISTS sites_activity (
  site_id TEXT PRIMARY KEY,
  last_event TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sites_activity__at ON sites_activity (at);
