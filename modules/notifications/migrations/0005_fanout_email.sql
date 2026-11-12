-- notifications_fanout_email: a recipient the fanout reached whose email (a Space deletion notice) failed every try; the next delivery of the same event sends that email alone, and a send
-- deletes the row. Its own table, made with IF NOT EXISTS, because 0004 was shipped to test servers in two shapes (with and without an email_pending column, which nothing reads any more).
-- The index on notifications_fanout_sent.at is for the 30-day prune.
CREATE TABLE IF NOT EXISTS "notifications_fanout_email" (
  "event_id" TEXT NOT NULL,
  "target" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  PRIMARY KEY ("event_id", "target")
);
CREATE INDEX IF NOT EXISTS "notifications_fanout_sent_at" ON "notifications_fanout_sent" ("at");
CREATE INDEX IF NOT EXISTS "notifications_fanout_email_at" ON "notifications_fanout_email" ("at");
