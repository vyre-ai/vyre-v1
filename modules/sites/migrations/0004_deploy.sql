-- sites Vyre builds and runs (sites.deploy): the source a site is built from, its CPU and memory, the container that serves it now, and its own Postgres or Redis.
-- A site with a source is served from container_id at port; a site without one is a route to a computer or a folder as before. Values of env vars and tokens are never stored: sites_env keeps
-- Vault handles, and an addon's password is sealed.
ALTER TABLE sites_site ADD COLUMN source TEXT;
ALTER TABLE sites_site ADD COLUMN limits TEXT;
ALTER TABLE sites_site ADD COLUMN auto_deploy INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sites_site ADD COLUMN container_id TEXT;
ALTER TABLE sites_site ADD COLUMN current_deployment TEXT;
ALTER TABLE sites_site ADD COLUMN password_hash TEXT;
ALTER TABLE sites_site ADD COLUMN deployed_by TEXT;

ALTER TABLE sites_deployment ADD COLUMN note TEXT;
ALTER TABLE sites_deployment ADD COLUMN problem TEXT;
ALTER TABLE sites_deployment ADD COLUMN fix TEXT;
ALTER TABLE sites_deployment ADD COLUMN port INTEGER;
ALTER TABLE sites_deployment ADD COLUMN message TEXT;
ALTER TABLE sites_deployment ADD COLUMN plan TEXT;
ALTER TABLE sites_deployment ADD COLUMN finished_at INTEGER;

CREATE TABLE IF NOT EXISTS sites_addon (
  site_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  container_id TEXT,
  state TEXT NOT NULL,
  env_name TEXT NOT NULL,
  secret TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (site_id, kind)
);
