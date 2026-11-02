-- sites as routes: a site is a name and an address pointing at a port on a computer, or at a folder in Files. Vyre does not build or run it; an agent does, on a computer.
-- access: public (/p/<slug>, through the Gate), password (its own domain, through Caddy), space and private (/a/<id>, signed in). kind 'artifact' is a private page made by a model.
ALTER TABLE sites_site ADD COLUMN slug TEXT;
ALTER TABLE sites_site ADD COLUMN computer_id TEXT;
ALTER TABLE sites_site ADD COLUMN port INTEGER;
ALTER TABLE sites_site ADD COLUMN target_folder TEXT;
ALTER TABLE sites_site ADD COLUMN access TEXT NOT NULL DEFAULT 'private';
ALTER TABLE sites_site ADD COLUMN live INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sites_site ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS sites_site__slug ON sites_site (slug) WHERE slug IS NOT NULL AND deleted_at IS NULL;

-- a short-lived address for one person: the token is in the path so relative URLs keep it, and only its hash is stored
CREATE TABLE IF NOT EXISTS sites_ticket (
  token_hash TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  principal TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sites_ticket__expires ON sites_ticket (expires_at);
