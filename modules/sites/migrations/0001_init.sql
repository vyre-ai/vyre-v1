-- sites: own tables, prefixed sites_ so ctx.db accepts them (ARCH 7.6, spec 2.20).
-- Staging passwords are a sealed Vault handle, never a plaintext column.

CREATE TABLE IF NOT EXISTS sites_site (
  site_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  owner TEXT NOT NULL,
  repo_url TEXT,
  template_kit TEXT,
  repo_folder_id TEXT,
  root_folder TEXT NOT NULL,
  staging_url TEXT,
  production_url TEXT,
  state TEXT NOT NULL,
  staging_vault_handle TEXT,
  staging_seal TEXT,
  service_principal TEXT NOT NULL,
  owner_level TEXT NOT NULL,
  builder TEXT NOT NULL,
  idempotency_key TEXT,
  settings TEXT NOT NULL,
  deleted INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sites_deployment (
  deployment_id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  env TEXT NOT NULL,
  state TEXT NOT NULL,
  url TEXT,
  branch TEXT,
  commit_sha TEXT,
  at INTEGER NOT NULL,
  sealed INTEGER NOT NULL,
  vault_handle TEXT,
  container_name TEXT NOT NULL,
  network TEXT NOT NULL,
  removed INTEGER NOT NULL,
  image TEXT NOT NULL,
  checks TEXT NOT NULL,
  run_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sites_env (
  site_id TEXT NOT NULL,
  name TEXT NOT NULL,
  vault_handle TEXT NOT NULL,
  vault_name TEXT NOT NULL,
  injected INTEGER NOT NULL,
  PRIMARY KEY (site_id, name)
);

CREATE TABLE IF NOT EXISTS sites_domain (
  site_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  dns_ok INTEGER NOT NULL,
  certificate TEXT NOT NULL,
  PRIMARY KEY (site_id, domain)
);

CREATE TABLE IF NOT EXISTS sites_log (
  deployment_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  line TEXT NOT NULL,
  PRIMARY KEY (deployment_id, seq)
);

CREATE TABLE IF NOT EXISTS sites_grant (
  site_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  level TEXT NOT NULL,
  PRIMARY KEY (site_id, resource)
);

CREATE INDEX IF NOT EXISTS sites_site_owner ON sites_site (owner);
CREATE INDEX IF NOT EXISTS sites_deployment_site ON sites_deployment (site_id, at);
CREATE INDEX IF NOT EXISTS sites_log_deployment ON sites_log (deployment_id, seq);
