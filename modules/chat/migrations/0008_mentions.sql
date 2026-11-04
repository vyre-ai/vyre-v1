-- Who a message mentioned (lane l-share2, owner ruling 4 Nov): one row per person a message names with a mention chip, kept by person id. The reply-time read of a teammate's profile matches on these,
-- never on a name in the words. The row goes with its message (a deleted message, an erased chat, a purge past retention) and with the person (removed from the Space).
-- Statements are split on semicolons and comment lines are dropped, so comments carry no semicolons.
CREATE TABLE IF NOT EXISTS "chat_mention" (
  "message" TEXT NOT NULL,
  "thread" TEXT NOT NULL,
  "person" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  PRIMARY KEY ("message", "person")
);
CREATE INDEX IF NOT EXISTS "chat_mention__person" ON "chat_mention" ("person", "thread");
CREATE INDEX IF NOT EXISTS "chat_mention__thread" ON "chat_mention" ("thread");
