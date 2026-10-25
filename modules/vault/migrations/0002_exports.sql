-- vault: .env export pull links (spec 2.17, ARCH 7.8). The file is sealed under the filler's key when the link is made; only the hash of the pull token is kept, so the database alone never opens an export.
CREATE TABLE IF NOT EXISTS vault_export (
  "id" TEXT PRIMARY KEY,
  "folderId" TEXT NOT NULL,
  "by" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL,
  "expiresAt" INTEGER NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "box" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "itemCount" INTEGER NOT NULL,
  "pulledAt" INTEGER,
  "revokedAt" INTEGER
);
