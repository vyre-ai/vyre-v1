-- A site that comes from a GitHub repo can take GitHub's webhook. hook_secret is the shared secret, sealed with the Space's key (shown once when it is made, never again); hook_follow is the JSON list of
-- branch patterns that get a preview on a push (the production branch deploys when the site deploys on push). sites_hook_delivery remembers each delivery id so one is never acted on twice;
-- sites_push is the work a verified delivery left for the server's tick, which runs it as the person who deployed the site last (so the Vault checks their access).
ALTER TABLE sites_site ADD COLUMN hook_secret TEXT;
ALTER TABLE sites_site ADD COLUMN hook_follow TEXT;

CREATE TABLE IF NOT EXISTS sites_hook_delivery (
  delivery_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (delivery_id, site_id)
);

CREATE TABLE IF NOT EXISTS sites_push (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  branch TEXT NOT NULL,
  sha TEXT,
  action TEXT NOT NULL,
  at INTEGER NOT NULL,
  done_at INTEGER
);
CREATE INDEX IF NOT EXISTS sites_push__open ON sites_push (done_at, at);
