-- dropbox: the app (which Vault item holds the key), each connected Dropbox account (one per person, or one for the Space), the sign-ins in flight (PKCE verifier by state),
-- webhook events already applied, and an id-to-path index so a change feed that names only a deleted path can say which mounted item went.

CREATE TABLE IF NOT EXISTS dropbox_config (
  "id" TEXT PRIMARY KEY,
  "vaultItem" TEXT NOT NULL,
  "appKey" TEXT NOT NULL,
  "updated_at" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dropbox_account (
  "connectionId" TEXT PRIMARY KEY,
  "ownerKind" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "email" TEXT,
  "name" TEXT,
  "refreshHandle" TEXT NOT NULL,
  "refreshItem" TEXT NOT NULL,
  "created_at" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dropbox_oauth (
  "state" TEXT PRIMARY KEY,
  "ownerKind" TEXT NOT NULL,
  "startedBy" TEXT NOT NULL,
  "verifier" TEXT NOT NULL,
  "redirectUri" TEXT NOT NULL,
  "created_at" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dropbox_event (
  "eventId" TEXT PRIMARY KEY,
  "at" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dropbox_node (
  "connectionId" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "pathLower" TEXT NOT NULL,
  "isFolder" INTEGER NOT NULL,
  PRIMARY KEY ("connectionId", "nodeId")
);

CREATE INDEX IF NOT EXISTS dropbox_node_path ON dropbox_node ("connectionId", "pathLower");
