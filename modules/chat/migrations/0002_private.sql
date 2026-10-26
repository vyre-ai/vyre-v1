-- Private chats and Ask panes (P-L2_11, spec 5 b7, ARCH 4.13 and 6.3). Statements are split on semicolons and comment lines are dropped, so comments carry no semicolons.
-- A private thread is sealed once its first message arrives as ciphertext under the owner's key. The row names the owner and the key tag (a one-way tag of the thread key, never the key),
-- so a later plain message is refused and a runtime that unwraps a different key is caught before it reads anything.
CREATE TABLE IF NOT EXISTS "chat_private" (
  "thread" TEXT PRIMARY KEY,
  "owner" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "sealedAt" INTEGER NOT NULL
);
-- Each time the Space runtime opened a private thread to run its owner's turn: which turn, for whom, when it let go, and how many messages it read and wrote. Ids and counts only.
CREATE TABLE IF NOT EXISTS "chat_private_turn" (
  "id" TEXT PRIMARY KEY,
  "thread" TEXT NOT NULL,
  "turn" TEXT NOT NULL,
  "person" TEXT NOT NULL,
  "openedAt" INTEGER NOT NULL,
  "closedAt" INTEGER,
  "reads" INTEGER NOT NULL DEFAULT 0,
  "replies" INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "chat_private_turn__thread" ON "chat_private_turn" ("thread", "openedAt");
-- Ask panes by the object they are about, newest first, for the pane history of that object.
CREATE INDEX IF NOT EXISTS "chat_thread__scope" ON "chat_thread" ("scopeType", "scopeId", "createdAt");
