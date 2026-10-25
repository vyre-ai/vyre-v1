-- templates: the gallery of single-item packages in Kit format (spec 2.21, 3.6; ARCH 7.6).
-- source "kit": a shipped one-item Kit that the kits module installs (kit_id names it). source "saved": an item a person saved as a template; manifest holds its Kit-format JSON.
-- A shipped template row is a cache of what kits.list and kits.preview say, kept so the gallery does not ask the kits module about every Kit on every open.
-- Nothing secret is stored: a template names Vault handles, never values.

CREATE TABLE IF NOT EXISTS templates_template (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  source TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  version TEXT NOT NULL,
  adds TEXT NOT NULL,
  kit_id TEXT,
  manifest TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS templates_template__key ON templates_template (key);
CREATE INDEX IF NOT EXISTS templates_template__kind ON templates_template (kind);
