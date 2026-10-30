-- Tool calls of an imported Claude Code or Codex session (chat UX). A tool call belongs to the assistant message it ran in; it keeps what a person reads (a one-line summary), whether it worked,
-- and the start of what it returned with credentials removed. Statements are split on semicolons and comment lines are dropped, so comments carry no semicolons.
CREATE TABLE IF NOT EXISTS "import_message_tool" (
  "messageId" TEXT NOT NULL,
  "ord" INTEGER NOT NULL,
  "toolId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "ok" INTEGER,
  "output" TEXT,
  PRIMARY KEY("messageId", "ord")
);
