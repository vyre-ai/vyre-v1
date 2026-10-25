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
