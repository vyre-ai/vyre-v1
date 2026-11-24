-- Plain env values and where an env var applies. A name takes its value from a Vault key (vault_handle) or is a plain value kept here (plain, not secret: a mode, a public address, a flag).
-- scope: all, production or previews. A site's secrets stay in the Vault; the app offers a pasted .env as secrets (Vault) and plain values.
ALTER TABLE sites_env ADD COLUMN plain TEXT;
ALTER TABLE sites_env ADD COLUMN scope TEXT NOT NULL DEFAULT 'all';
