-- mail core tables. Entity tables match generated/modules/mail/schema.sql so CREATE IF NOT EXISTS
-- is a no-op after the host applies the generated schema. Extra tables are this packet's own.

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
CREATE INDEX IF NOT EXISTS mail_mailbox_owner ON mail_mailbox ("ownerId");

-- One row per provider delivery. The RFC id table collapses the same message across inboxes.
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

-- Address directory used when contacts.resolve is empty or still a stub. score is 0 to 1.
CREATE TABLE IF NOT EXISTS mail_party (
  email TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  score REAL NOT NULL,
  PRIMARY KEY (email, "contactId")
);

-- Filing result. filed = 0 means the message stays in the mailbox view (private or paused).
CREATE TABLE IF NOT EXISTS mail_link (
  "messageId" TEXT PRIMARY KEY,
  linked TEXT NOT NULL,
  "contactId" TEXT,
  "conversationId" TEXT,
  "taskId" TEXT,
  filed INTEGER NOT NULL
);

-- Needs you row. id is the task id returned by mail.ingest.
CREATE TABLE IF NOT EXISTS mail_needs (
  id TEXT PRIMARY KEY,
  "messageId" TEXT NOT NULL,
  address TEXT NOT NULL,
  suggestions TEXT NOT NULL,
  state TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mail_follow (
  "threadKey" TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS mail_body (
  "messageId" TEXT PRIMARY KEY,
  text TEXT,
  html TEXT,
  "fromName" TEXT,
  bcc TEXT,
  headers TEXT
);

CREATE TABLE IF NOT EXISTS mail_idem (
  key TEXT NOT NULL,
  kind TEXT NOT NULL,
  "refId" TEXT NOT NULL,
  PRIMARY KEY (key, kind)
);

CREATE TABLE IF NOT EXISTS mail_imap (
  "mailboxId" TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  secure INTEGER NOT NULL,
  username TEXT NOT NULL,
  "passwordHandle" TEXT NOT NULL
);

-- One row per mailbox read, keyed by the person who read it.
CREATE TABLE IF NOT EXISTS mail_read_log (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  "mailboxId" TEXT NOT NULL,
  action TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mail_unread (
  "mailboxId" TEXT PRIMARY KEY,
  n INTEGER NOT NULL
);
