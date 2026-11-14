-- Closed chapters of a long chat, stored once (lane chat-chapters, 14 Nov 2026). A chapter that has closed is written here with the seq and id of its first message and is never worked out again, so
-- appending or deleting messages never moves it and a link to it keeps working. Only the open chapter is computed on a read. The plain words are kept for readers who can see every message of the
-- chapter, sig is the live message count and newest edit time of the range (a change drops the model's heading), tries and triedAt cap the asks of a model: once, and once more an hour later.
-- Comments carry no semicolons.
CREATE TABLE IF NOT EXISTS "chat_chapter_edge" (
  "thread" TEXT NOT NULL,
  "startSeq" INTEGER NOT NULL,
  "startMsg" TEXT NOT NULL,
  "startAt" INTEGER NOT NULL,
  "endSeq" INTEGER NOT NULL,
  "count" INTEGER NOT NULL,
  "plainTitle" TEXT NOT NULL,
  "plainSummary" TEXT NOT NULL,
  "sig" TEXT NOT NULL,
  "tries" INTEGER NOT NULL DEFAULT 0,
  "triedAt" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("thread", "startSeq")
);
