-- notifications_fanout_sent: who the fanout consumer already reached for one event. The host hands a consumer the same event again after a crash, after a stop let it go mid-run, or when it
-- throws, so each recipient is written here before it is sent to. notification_id is what the send filed once it answered: set means reached (not sent again), NULL means the send was cut off
-- (sent again). email_pending: the kind's email (a Space deletion notice) failed and is sent again on the next try. Rows older than 30 days are pruned by `at`.
CREATE TABLE IF NOT EXISTS "notifications_fanout_sent" (
  "event_id" TEXT NOT NULL,
  "target" TEXT NOT NULL,
  "notification_id" TEXT,
  "email_pending" INTEGER NOT NULL DEFAULT 0,
  "at" INTEGER NOT NULL,
  PRIMARY KEY ("event_id", "target")
);
CREATE INDEX IF NOT EXISTS "notifications_fanout_sent_at" ON "notifications_fanout_sent" ("at");
