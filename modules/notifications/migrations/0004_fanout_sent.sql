-- notifications_fanout_sent: who the fanout consumer already reached for one event. The host hands a consumer the same event again after a crash or after a stop let it go mid-run, so each
-- recipient is written here before it is sent to, and a second delivery of the event skips it (no second row, push or email). notification_id is what the first delivery filed.
CREATE TABLE IF NOT EXISTS "notifications_fanout_sent" (
  "event_id" TEXT NOT NULL,
  "target" TEXT NOT NULL,
  "notification_id" TEXT,
  "at" INTEGER NOT NULL,
  PRIMARY KEY ("event_id", "target")
);
