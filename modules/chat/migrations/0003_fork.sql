-- Forks (chat UX). A fork is a copy of what was said up to a message. When the chat it came from had other people in it, the copy is private to whoever forked: it never turns into a channel with
-- someone else, so a fork cannot carry other people's words to a person who was never meant to read them. Statements are split on semicolons and comment lines are dropped, so comments carry no semicolons.
CREATE TABLE IF NOT EXISTS "chat_fork" (
  "thread" TEXT PRIMARY KEY,
  "source" TEXT NOT NULL,
  "withOthers" INTEGER NOT NULL,
  "at" INTEGER NOT NULL
);
