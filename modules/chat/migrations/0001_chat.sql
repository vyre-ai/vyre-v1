-- Chat tables (P-L2_10, ARCH 6.1). The four entity tables repeat generated/modules/chat/schema.sql exactly (IF NOT EXISTS), so either CREATE can run first.
-- Below them: the per-thread sequence counter and its unique index (gap-free threadSeq), channels, the waiting blocks (questions, plans) and plans.
-- entity message (generated)
CREATE TABLE IF NOT EXISTS "chat_message" (
  "id" TEXT PRIMARY KEY,
  "thread" TEXT,
  "threadSeq" REAL,
  "author" TEXT,
  "kind" TEXT,
  "body" TEXT,
  "blocks" TEXT,
  "replyTo" TEXT,
  "via" TEXT,
  "depth" REAL,
  "attachments" TEXT,
  "pinned" INTEGER,
  "reactions" TEXT,
  "editedAt" INTEGER,
  "createdAt" INTEGER,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);
CREATE TABLE IF NOT EXISTS "chat_message__fm" (
  "id" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "hlc" TEXT NOT NULL,
  "actor" TEXT,
  "seq" INTEGER,
  PRIMARY KEY ("id", "field")
);
CREATE INDEX IF NOT EXISTS "chat_message__parent" ON "chat_message" ("thread");

-- entity thread (generated)
CREATE TABLE IF NOT EXISTS "chat_thread" (
  "id" TEXT PRIMARY KEY,
  "kind" TEXT,
  "title" TEXT,
  "starter" TEXT,
  "recordId" TEXT,
  "folderId" TEXT,
  "scopeType" TEXT,
  "scopeId" TEXT,
  "channelId" TEXT,
  "parentThreadId" TEXT,
  "parentMessageId" TEXT,
  "listed" INTEGER,
  "modePlan" INTEGER,
  "createdAt" INTEGER,
  "closedAt" INTEGER,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);
CREATE TABLE IF NOT EXISTS "chat_thread__fm" (
  "id" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "hlc" TEXT NOT NULL,
  "actor" TEXT,
  "seq" INTEGER,
  PRIMARY KEY ("id", "field")
);
CREATE INDEX IF NOT EXISTS "chat_thread__owner" ON "chat_thread" ("starter");

-- entity thread_agent (generated)
CREATE TABLE IF NOT EXISTS "chat_thread_agent" (
  "id" TEXT PRIMARY KEY,
  "thread" TEXT,
  "agentId" TEXT,
  "mode" TEXT,
  "model" TEXT,
  "provider" TEXT,
  "effort" TEXT,
  "accountRef" TEXT,
  "addedBy" TEXT,
  "watches" INTEGER,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);
CREATE TABLE IF NOT EXISTS "chat_thread_agent__fm" (
  "id" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "hlc" TEXT NOT NULL,
  "actor" TEXT,
  "seq" INTEGER,
  PRIMARY KEY ("id", "field")
);
CREATE INDEX IF NOT EXISTS "chat_thread_agent__parent" ON "chat_thread_agent" ("thread");

-- entity thread_member (generated)
CREATE TABLE IF NOT EXISTS "chat_thread_member" (
  "id" TEXT PRIMARY KEY,
  "thread" TEXT,
  "principal" TEXT,
  "role" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updated_at" INTEGER,
  "deleted_at" INTEGER
);
CREATE TABLE IF NOT EXISTS "chat_thread_member__fm" (
  "id" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "hlc" TEXT NOT NULL,
  "actor" TEXT,
  "seq" INTEGER,
  PRIMARY KEY ("id", "field")
);
CREATE INDEX IF NOT EXISTS "chat_thread_member__parent" ON "chat_thread_member" ("thread");

-- One row per thread: the last threadSeq handed out. A post bumps it and inserts the message in the same handler call, so numbers never skip or repeat.
CREATE TABLE IF NOT EXISTS "chat_thread_seq" (
  "thread" TEXT PRIMARY KEY,
  "last" INTEGER NOT NULL
);
-- Gap-free order and the index behind "last 50 messages" (ORDER BY threadSeq DESC LIMIT 50 walks this index, no sort).
CREATE UNIQUE INDEX IF NOT EXISTS "chat_message__seq" ON "chat_message" ("thread", "threadSeq");
-- A Run has one thread (kind run, scopeType run, scopeId = the Run id).
CREATE UNIQUE INDEX IF NOT EXISTS "chat_thread__run" ON "chat_thread" ("scopeId") WHERE "kind" = 'run';
CREATE INDEX IF NOT EXISTS "chat_thread__parent_message" ON "chat_thread" ("parentMessageId");
CREATE INDEX IF NOT EXISTS "chat_thread__channel" ON "chat_thread" ("channelId");

-- A channel is a named room; its messages live in its main thread (kind channel). Members and agents are the main thread's member and agent rows.
CREATE TABLE IF NOT EXISTS "chat_channel" (
  "id" TEXT PRIMARY KEY,
  "mainThread" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "nameKey" TEXT NOT NULL,
  "topic" TEXT,
  "visibility" TEXT NOT NULL,
  "folderId" TEXT,
  "recordId" TEXT,
  "archived" INTEGER NOT NULL DEFAULT 0,
  "createdBy" TEXT,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "chat_channel__record" ON "chat_channel" ("recordId");
CREATE INDEX IF NOT EXISTS "chat_channel__name" ON "chat_channel" ("nameKey");

-- A block that waits for an answer (question, plan). The block also lives inside its message's blocks JSON; this row is the state the answer capabilities check.
CREATE TABLE IF NOT EXISTS "chat_block" (
  "id" TEXT PRIMARY KEY,
  "thread" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "data" TEXT NOT NULL,
  "answer" TEXT,
  "answeredBy" TEXT,
  "answeredAt" INTEGER,
  "createdAt" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "chat_block__thread" ON "chat_block" ("thread");

-- A plan: steps with ids and states. state: proposed, approved, rejected, done.
CREATE TABLE IF NOT EXISTS "chat_plan" (
  "id" TEXT PRIMARY KEY,
  "thread" TEXT NOT NULL,
  "block" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "steps" TEXT NOT NULL,
  "docFileId" TEXT,
  "decidedBy" TEXT,
  "decidedAt" INTEGER,
  "createdAt" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "chat_plan__thread" ON "chat_plan" ("thread");
