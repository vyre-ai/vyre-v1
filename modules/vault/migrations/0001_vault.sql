-- vault: item metadata (names, kinds, field keys, never a value), the sealed values, folders and the history of every use. vault_meta matches generated/modules/vault/schema.sql column for
-- column (either CREATE may run first). vault_secret holds the values: one row per item, a sealed box that only the owner's item key (enc=2, Mine) or the filler's key (enc=1, Shared) opens.
-- vault_item_x keeps what the entity does not: when it was created and last rotated, the deleter, the secret flag of each field (a flag, never a value).

CREATE TABLE IF NOT EXISTS "vault_meta" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT,
  "kind" TEXT,
  "folderId" TEXT,
  "owner" TEXT,
  "scope" TEXT,
  "fieldKeys" TEXT,
  "handle" TEXT,
  "spaceOnly" INTEGER,
  "injectIntoDeployments" INTEGER,
  "rotateEveryDays" REAL,
  "lastUsedAt" INTEGER,
  "updatedAt" INTEGER,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);
CREATE INDEX IF NOT EXISTS "vault_meta__owner" ON "vault_meta" ("owner");
CREATE INDEX IF NOT EXISTS "vault_meta__parent" ON "vault_meta" ("folderId");

CREATE TABLE IF NOT EXISTS vault_secret (
  "itemId" TEXT PRIMARY KEY,
  "enc" INTEGER NOT NULL,
  "keyId" TEXT NOT NULL,
  "wrapped" TEXT,
  "box" TEXT NOT NULL,
  "rev" INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS vault_item_x (
  "itemId" TEXT PRIMARY KEY,
  "createdAt" INTEGER NOT NULL,
  "lastRotatedAt" INTEGER,
  "secrets" TEXT NOT NULL,
  "deletedBy" TEXT
);

CREATE TABLE IF NOT EXISTS vault_folder (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "parentId" TEXT,
  "scope" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "whoCanExport" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL,
  "deleted_at" INTEGER
);

CREATE TABLE IF NOT EXISTS vault_history (
  "id" TEXT PRIMARY KEY,
  "itemId" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  "actor" TEXT NOT NULL,
  "onBehalfOf" TEXT,
  "action" TEXT NOT NULL,
  "field" TEXT,
  "via" TEXT,
  "detail" TEXT
);
