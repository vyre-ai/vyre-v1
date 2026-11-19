-- Named email templates (lane r42-email-in). A Space template overrides the built-in text of the same key; a document can keep its own version of a key.
-- Text carries merge tokens: {{field}} or {{field|fallback}}. A template row is never deleted in place: reset removes the Space version and the built-in returns.

CREATE TABLE IF NOT EXISTS mail_template (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  text TEXT NOT NULL,
  html TEXT,
  "recordType" TEXT,
  version INTEGER NOT NULL,
  "updatedBy" TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS mail_template__key ON mail_template (key);
-- one live template per key: a reset leaves its old row behind, but never two live ones
CREATE UNIQUE INDEX IF NOT EXISTS mail_template__live_key ON mail_template (key) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS mail_template_doc (
  "documentId" TEXT NOT NULL,
  key TEXT NOT NULL,
  subject TEXT NOT NULL,
  text TEXT NOT NULL,
  html TEXT,
  "updatedBy" TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY ("documentId", key)
);
