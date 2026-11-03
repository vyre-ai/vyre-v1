-- An agent's message to a teammate for its person (lane l-agentdm). One row per message: who it is for and from, the chat the person asked in (origin), the direct chat it goes to (dm), what it says,
-- when it may go and why it waits, and once sent the message and any card it carries (an Approve or Review task, a key request), so a reply or an answer finds its way back to the origin.
-- Statements are split on semicolons and comment lines are dropped, so comments carry no semicolons.
CREATE TABLE IF NOT EXISTS "chat_agent_dm" (
  "id" TEXT PRIMARY KEY,
  "person" TEXT NOT NULL,
  "agent" TEXT NOT NULL,
  "teammate" TEXT NOT NULL,
  "origin" TEXT,
  "dm" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "blocks" TEXT NOT NULL DEFAULT '[]',
  "timing" TEXT NOT NULL DEFAULT 'now',
  "urgent" INTEGER NOT NULL DEFAULT 0,
  "state" TEXT NOT NULL,
  "due_at" INTEGER,
  "reason" TEXT,
  "message" TEXT,
  "task" TEXT,
  "request" TEXT,
  "card" TEXT,
  "idem" TEXT,
  "created_at" INTEGER NOT NULL,
  "sent_at" INTEGER,
  "replied_at" INTEGER,
  "answered_at" INTEGER,
  "wanted_at" INTEGER
);
CREATE INDEX IF NOT EXISTS "chat_agent_dm__pair" ON "chat_agent_dm" ("person", "teammate", "sent_at");
CREATE INDEX IF NOT EXISTS "chat_agent_dm__due" ON "chat_agent_dm" ("state", "due_at");
CREATE INDEX IF NOT EXISTS "chat_agent_dm__dm" ON "chat_agent_dm" ("dm", "sent_at");
CREATE INDEX IF NOT EXISTS "chat_agent_dm__task" ON "chat_agent_dm" ("task");
CREATE TABLE IF NOT EXISTS "chat_agent_dm_mute" (
  "teammate" TEXT NOT NULL,
  "person" TEXT NOT NULL,
  "until" INTEGER NOT NULL,
  PRIMARY KEY ("teammate", "person")
);
