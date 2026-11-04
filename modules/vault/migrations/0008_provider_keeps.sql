-- vault: which AI accounts keep nothing of what they are sent (an admin's say). One row per provider the admin set; no row means the account is not known to keep nothing. A local model needs no row:
-- it always keeps nothing. No value lives here.
CREATE TABLE IF NOT EXISTS vault_provider_keeps (
  "providerId" TEXT PRIMARY KEY,
  "keepsNothing" INTEGER NOT NULL DEFAULT 0,
  "setBy" TEXT NOT NULL,
  "setAt" INTEGER NOT NULL
);
