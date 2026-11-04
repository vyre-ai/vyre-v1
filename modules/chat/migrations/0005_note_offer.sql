-- An agent's offer to save something from a chat as a note (lane l-learn2, owner idea 4 Nov): one row per offer, so the same topic is never offered twice in a chat and a "Not now" is remembered.
-- Statements are split on semicolons and comment lines are dropped, so comments carry no semicolons.
CREATE TABLE IF NOT EXISTS "chat_note_offer" (
  "id" TEXT PRIMARY KEY,
  "thread" TEXT NOT NULL,
  "person" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "block" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "note" TEXT,
  "created_at" INTEGER NOT NULL,
  "answered_at" INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS "chat_note_offer_topic" ON "chat_note_offer" ("thread", "person", "topic");
