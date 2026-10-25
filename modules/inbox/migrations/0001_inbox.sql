-- inbox. The two entity tables repeat generated/modules/inbox/schema.sql column for column (CREATE IF NOT EXISTS does nothing once the host has applied the
-- generated schema), then the tables the module keeps for itself: the messages, texts and calls each conversation holds, the matches that can be undone, and
-- the Needs you task raised for a sender.

CREATE TABLE IF NOT EXISTS inbox_conversation (
  "id" TEXT PRIMARY KEY,
  "contactId" TEXT,
  "address" TEXT,
  "displayName" TEXT,
  "lastMessageAt" INTEGER,
  "lastChannel" TEXT,
  "lastPreview" TEXT,
  "unreadCount" REAL,
  "needsMatch" INTEGER,
  "ownerId" TEXT,
  "mailboxIds" TEXT,
  "numberIds" TEXT,
  "campaignId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);
CREATE INDEX IF NOT EXISTS inbox_conversation__owner ON inbox_conversation ("ownerId");
CREATE INDEX IF NOT EXISTS inbox_conversation__parent ON inbox_conversation ("contactId");

CREATE TABLE IF NOT EXISTS inbox_follow (
  "id" TEXT PRIMARY KEY,
  "contactId" TEXT,
  "principalId" TEXT,
  "alertOnReplies" INTEGER,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);
CREATE INDEX IF NOT EXISTS inbox_follow__owner ON inbox_follow ("principalId");
CREATE INDEX IF NOT EXISTS inbox_follow__parent ON inbox_follow ("contactId");

-- One row per stored message, text or call. The id is the kind and the reference of the thing, so linking it twice is one row.
CREATE TABLE IF NOT EXISTS inbox_item (
  "id" TEXT PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "refId" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  "mailboxId" TEXT,
  "numberId" TEXT,
  "campaignId" TEXT,
  "threadId" TEXT,
  "subject" TEXT,
  "preview" TEXT,
  "participants" TEXT,
  "unread" INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS inbox_item__conversation ON inbox_item ("conversationId", "at");
CREATE INDEX IF NOT EXISTS inbox_item__thread ON inbox_item ("threadId");
CREATE INDEX IF NOT EXISTS inbox_item__address ON inbox_item ("address");

-- A match that Undo can take back: whether the sender's conversation took the record (rename) or was folded into the record's own conversation (merge).
CREATE TABLE IF NOT EXISTS inbox_undo (
  "token" TEXT PRIMARY KEY,
  "mode" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "snapshot" TEXT NOT NULL,
  "itemIds" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  "undone" INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS inbox_undo__target ON inbox_undo ("targetId");

-- The Needs you task raised for a sender, so a second unsure message does not raise another.
CREATE TABLE IF NOT EXISTS inbox_match_task (
  "conversationId" TEXT PRIMARY KEY,
  "taskId" TEXT NOT NULL
);
