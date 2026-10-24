-- mail core. The entity tables repeat generated/modules/mail/schema.sql column for column, so CREATE IF NOT EXISTS
-- does nothing once the host has applied the generated schema. Every other table here is this module's own.

CREATE TABLE IF NOT EXISTS mail_mailbox (
  "id" TEXT PRIMARY KEY,
  "kind" TEXT,
  "address" TEXT,
  "title" TEXT,
  "ownerId" TEXT,
  "agentId" TEXT,
  "provider" TEXT,
  "privacy" TEXT,
  "state" TEXT,
  "connectionId" TEXT,
  "lastSyncAt" INTEGER,
  "paused" INTEGER,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);
CREATE INDEX IF NOT EXISTS mail_mailbox__owner ON mail_mailbox ("ownerId");

CREATE TABLE IF NOT EXISTS mail_message (
  "id" TEXT PRIMARY KEY,
  "mailboxId" TEXT,
  "inboxIds" TEXT,
  "providerId" TEXT,
  "rfcMessageId" TEXT,
  "threadId" TEXT,
  "direction" TEXT,
  "status" TEXT,
  "fromAddress" TEXT,
  "toAddresses" TEXT,
  "ccAddresses" TEXT,
  "subject" TEXT,
  "snippet" TEXT,
  "body" TEXT,
  "sentAt" INTEGER,
  "contactId" TEXT,
  "isPrivate" INTEGER,
  "campaignId" TEXT,
  "attachments" TEXT,
  "draftedByAgent" TEXT,
  "traceId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);
CREATE INDEX IF NOT EXISTS mail_message_rfc ON mail_message ("rfcMessageId");
CREATE INDEX IF NOT EXISTS mail_message_status ON mail_message (status);

CREATE TABLE IF NOT EXISTS mail_domain (
  "id" TEXT PRIMARY KEY,
  "name" TEXT,
  "provider" TEXT,
  "spf" TEXT,
  "dkim" TEXT,
  "dmarc" TEXT,
  "verified" INTEGER,
  "isDefault" INTEGER,
  "records" TEXT,
  "checkedAt" INTEGER,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);

CREATE TABLE IF NOT EXISTS mail_route (
  "id" TEXT PRIMARY KEY,
  "domainId" TEXT,
  "localPart" TEXT,
  "mailboxId" TEXT,
  "provider" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);

-- One row per provider delivery. (source, providerId) is the dedupe key; the same message in a second inbox lands in mail_rfc.
CREATE TABLE IF NOT EXISTS mail_seen (
  source TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  PRIMARY KEY (source, "providerId")
);

CREATE TABLE IF NOT EXISTS mail_rfc (
  "rfcMessageId" TEXT PRIMARY KEY,
  "messageId" TEXT NOT NULL
);

-- What inbox.link_message answered for a message. A message from a private or paused mailbox has no row
-- until a second inbox that may file it receives the same message.
CREATE TABLE IF NOT EXISTS mail_link (
  "messageId" TEXT PRIMARY KEY,
  linked TEXT NOT NULL,
  "contactId" TEXT,
  "conversationId" TEXT,
  "taskId" TEXT
);

-- Message parts that do not belong in the synced row: both bodies, the display name, Bcc and the raw headers.
CREATE TABLE IF NOT EXISTS mail_body (
  "messageId" TEXT PRIMARY KEY,
  text TEXT,
  html TEXT,
  "fromName" TEXT,
  bcc TEXT,
  headers TEXT
);

-- Handler-level idempotency for mail.connect, so a replay returns the same mailbox even outside the host pipeline.
CREATE TABLE IF NOT EXISTS mail_idem (
  "idemKey" TEXT NOT NULL,
  kind TEXT NOT NULL,
  "refId" TEXT NOT NULL,
  PRIMARY KEY ("idemKey", kind)
);

-- IMAP settings of a mailbox. The password is never stored: passwordHandle is a Vault handle. cursor is the per-folder UID
-- watermark as JSON, uidValidity the folder epoch (a change resets the cursor; dedupe makes the re-read harmless).
CREATE TABLE IF NOT EXISTS mail_imap (
  "mailboxId" TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  secure INTEGER NOT NULL,
  username TEXT NOT NULL,
  "passwordHandle" TEXT NOT NULL,
  "uidValidity" INTEGER,
  cursor TEXT
);

-- One row per mailbox read, keyed by the person whose mailbox was read (spec 2.18: reads are logged per person).
CREATE TABLE IF NOT EXISTS mail_read_log (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  "mailboxId" TEXT NOT NULL,
  action TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mail_read_log__mailbox ON mail_read_log ("mailboxId");
