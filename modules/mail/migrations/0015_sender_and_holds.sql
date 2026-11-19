-- Who asked, held replies, and retries that could not run (lane r42-email-in).
-- mail_sent_by: the person, agent or Automation behind a sent message, kept as data so the trail names them whoever later runs a retry of it.
-- mail_held: an automatic reply the loop guard held as a draft; capped per sender and mailbox so nobody can pile them up.
-- mail_retry_giveback: how often a retry was handed back unsent for lack of a right; at the limit the retry is held for a person.

CREATE TABLE IF NOT EXISTS mail_sent_by (
  "messageId" TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  principal TEXT NOT NULL,
  "actingFor" TEXT,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mail_held (
  "messageId" TEXT PRIMARY KEY,
  "mailboxId" TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mail_held__box ON mail_held ("mailboxId", actor);
CREATE TABLE IF NOT EXISTS mail_retry_giveback (
  "messageId" TEXT NOT NULL,
  address TEXT NOT NULL,
  n INTEGER NOT NULL,
  "lastReason" TEXT,
  PRIMARY KEY ("messageId", address)
);
