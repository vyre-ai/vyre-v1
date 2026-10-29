-- vault: custom provider definitions (a Space's own OpenAI-compatible endpoints) and the address a provider row talks to. Built-in definitions are files (modules/vault/providers/*.json), not rows.
CREATE TABLE IF NOT EXISTS vault_provider_def (
  "key" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "base" TEXT NOT NULL,
  "keyless" INTEGER NOT NULL DEFAULT 0,
  "models" TEXT NOT NULL DEFAULT '[]',
  "createdBy" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL,
  "deleted_at" INTEGER
);
CREATE TABLE IF NOT EXISTS vault_provider_extra (
  "providerId" TEXT PRIMARY KEY,
  "address" TEXT NOT NULL
);
