-- A person's own Microsoft sign-in for mail (not tenant-wide consent): the OAuth client the Space has (which Vault item holds it), each person's signed-in account with its refresh token sealed
-- here (never in the Vault, never returned by a capability), and the sign-ins in flight (PKCE verifier by state).
CREATE TABLE IF NOT EXISTS microsoft_user_app (
  id TEXT PRIMARY KEY,
  "vaultItem" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS microsoft_user_account (
  "accountId" TEXT PRIMARY KEY,
  "ownerId" TEXT NOT NULL,
  email TEXT NOT NULL,
  "refreshSealed" TEXT NOT NULL,
  "mailboxId" TEXT,
  "fixTaskId" TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS microsoft_user_account__owner ON microsoft_user_account ("ownerId", email);

CREATE TABLE IF NOT EXISTS microsoft_user_oauth (
  state TEXT PRIMARY KEY,
  "startedBy" TEXT NOT NULL,
  verifier TEXT NOT NULL,
  "redirectUri" TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
