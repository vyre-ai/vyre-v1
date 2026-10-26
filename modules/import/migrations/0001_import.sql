-- Import tables (P-L3_10, spec 2.9 Lifecycle, 2.10, ARCH 7.4). A parse stages the source as a session that expires after 24 hours and holds the rows; a preview keeps the plan it checked
-- under a token; a commit writes the rows through records.bulk_upsert as a Run and keeps the counts. No record data lives here once an import is done: the rows are dropped.

CREATE TABLE IF NOT EXISTS "import_session" (
  "importId" TEXT PRIMARY KEY,
  "source" TEXT NOT NULL,
  "tables" TEXT NOT NULL,
  "dataHash" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL,
  "expiresAt" INTEGER NOT NULL,
  "type" TEXT,
  "previewToken" TEXT,
  "plan" TEXT,
  "runId" TEXT,
  "created" INTEGER NOT NULL DEFAULT 0,
  "updated" INTEGER NOT NULL DEFAULT 0,
  "skipped" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "ranAutomations" INTEGER NOT NULL DEFAULT 0,
  "errors" TEXT,
  "errorsFileId" TEXT
);
CREATE INDEX IF NOT EXISTS "import_session_type" ON "import_session" ("type", "createdAt");

-- Results of calls that carry an idempotency key, so the same key returns the same answer.
CREATE TABLE IF NOT EXISTS "import_key" (
  "key" TEXT PRIMARY KEY,
  "cap" TEXT NOT NULL,
  "result" TEXT NOT NULL
);

-- Local Codex and Claude Code history is copied, never mounted.  These are
-- deliberately separate from the temporary tabular import session above: an
-- imported conversation is archival data with source provenance and must not
-- be changed when the source history later changes or disappears.
CREATE TABLE IF NOT EXISTS "import_session_source" (
  "spaceId" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "destinationScope" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "disconnectedAt" INTEGER,
  "createdAt" INTEGER NOT NULL,
  PRIMARY KEY("spaceId", "owner", "destinationScope", "sourceKey")
);
CREATE TABLE IF NOT EXISTS "import_project_binding" (
  "spaceId" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "destinationScope" TEXT NOT NULL,
  "identityKey" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL,
  PRIMARY KEY("spaceId", "owner", "destinationScope", "identityKey")
);
CREATE TABLE IF NOT EXISTS "import_conversation" (
  "conversationId" TEXT PRIMARY KEY,
  "spaceId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "sourceSessionId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "destinationScope" TEXT NOT NULL,
  "projectId" TEXT,
  "destinationKind" TEXT NOT NULL,
  "identityKey" TEXT,
  "title" TEXT,
  "startedAt" INTEGER NOT NULL,
  "importedAt" INTEGER NOT NULL,
  "immutable" INTEGER NOT NULL DEFAULT 1,
  "continuedThreadId" TEXT,
  UNIQUE("spaceId", "owner", "destinationScope", "sourceKey", "sourceSessionId")
);
CREATE TABLE IF NOT EXISTS "import_message" (
  "messageId" TEXT PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "sourceMessageId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  "immutable" INTEGER NOT NULL DEFAULT 1,
  UNIQUE("conversationId", "sourceMessageId")
);
CREATE TABLE IF NOT EXISTS "import_session_conflict" (
  "conflictId" TEXT PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "sourceMessageId" TEXT NOT NULL,
  "incomingText" TEXT NOT NULL,
  "detectedAt" INTEGER NOT NULL,
  UNIQUE("conversationId", "sourceMessageId")
);
CREATE INDEX IF NOT EXISTS "import_conversation_owner" ON "import_conversation" ("spaceId", "owner", "destinationScope", "importedAt");
