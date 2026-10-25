-- vault: AI providers (spec 2.17, 4.14; ARCH 7.8). A provider is a sign-in or a key the Vault already holds as an item, plus what the engine needs to pick it: which provider, how it is connected, whose it is and
-- whether the Space may use it. No value lives here; the item holds it. A subscription sign-in is a flow: start leaves a row here, the person's computer saves the credential as an ai_subscription item, complete links them.
CREATE TABLE IF NOT EXISTS vault_provider (
  "id" TEXT PRIMARY KEY,
  "providerKey" TEXT NOT NULL,
  "connection" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "spaceMayUse" INTEGER NOT NULL DEFAULT 0,
  "state" TEXT NOT NULL DEFAULT 'ok',
  "createdAt" INTEGER NOT NULL,
  "deleted_at" INTEGER
);
CREATE TABLE IF NOT EXISTS vault_provider_flow (
  "id" TEXT PRIMARY KEY,
  "person" TEXT NOT NULL,
  "providerKey" TEXT NOT NULL,
  "startedAt" INTEGER NOT NULL,
  "doneAt" INTEGER
);
