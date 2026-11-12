-- notifications_email_log: what became of each email the module meant to send (sent, or why not: no_transport, no_mailbox, no_address, suppressed, held, off, failed). A record only; nothing reads it
-- to decide a send. notifications_email_tries: how many times the periodic pass tried a pending email (notifications_fanout_email) before it gives up and the host says so to admins.
CREATE TABLE IF NOT EXISTS "notifications_email_log" (
  "person" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "ref" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "at" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "notifications_email_log_at" ON "notifications_email_log" ("at");
CREATE TABLE IF NOT EXISTS "notifications_email_tries" (
  "event_id" TEXT NOT NULL,
  "target" TEXT NOT NULL,
  "tries" INTEGER NOT NULL,
  "at" INTEGER NOT NULL,
  PRIMARY KEY ("event_id", "target")
);
