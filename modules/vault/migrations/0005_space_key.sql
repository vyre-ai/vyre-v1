-- vault: the Space AI key (one per Space). It names the provider row an owner or admin set for everyone and the Restricted folder it sits in, and keeps the model list the provider last answered,
-- so a member's model picker does not ask the provider each time. No value lives here; the item holds it.
CREATE TABLE IF NOT EXISTS vault_space_key (
  "id" TEXT PRIMARY KEY,
  "providerId" TEXT NOT NULL,
  "folderId" TEXT NOT NULL,
  "setBy" TEXT NOT NULL,
  "setAt" INTEGER NOT NULL,
  "checkedAt" INTEGER NOT NULL,
  "models" TEXT NOT NULL DEFAULT '[]',
  "state" TEXT NOT NULL DEFAULT 'ok'
);
