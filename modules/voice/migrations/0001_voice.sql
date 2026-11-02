-- voice. A person's Talk choices and the Space's one key. Values never live here: only the Vault item's id and handle.

CREATE TABLE IF NOT EXISTS voice_prefs (
  "person" TEXT PRIMARY KEY,
  "enabled" INTEGER NOT NULL,
  "provider" TEXT NOT NULL,
  "language" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "keyItem" TEXT,
  "updatedAt" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS voice_space (
  "id" TEXT PRIMARY KEY,
  "enabled" INTEGER NOT NULL,
  "provider" TEXT NOT NULL,
  "keyItem" TEXT NOT NULL,
  "handle" TEXT NOT NULL,
  "setBy" TEXT NOT NULL,
  "checkedAt" INTEGER NOT NULL,
  "state" TEXT NOT NULL,
  "updatedAt" INTEGER NOT NULL
);
