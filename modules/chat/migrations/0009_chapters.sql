-- Chapters of a long chat (lane chat-chapters, 14 Nov 2026): the title and one-line summary a chapter was given, kept by the chat and the seq of its first message.
-- The boundaries are never stored: they are worked out from the messages on every read, so a short chat has no rows here and a chapter can move when messages are deleted.
-- writer is extract (the plain words of the chat), model (a cheap model on the account that ran the turn) or person. Comments carry no semicolons.
CREATE TABLE IF NOT EXISTS "chat_chapter" (
  "thread" TEXT NOT NULL,
  "startSeq" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "writer" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  PRIMARY KEY ("thread", "startSeq")
);
