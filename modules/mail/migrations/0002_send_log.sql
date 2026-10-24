-- The single send API's own counters (P-L5_02). One row per recipient per send: caps per sender count rows by mailbox, throttling
-- counts rows by throttleKey (the sending domain for Space sending, the mailbox for a member mailbox). Rows older than a day are
-- pruned by the sender, so the table stays the size of one day of sending.

CREATE TABLE IF NOT EXISTS mail_send_log (
  id TEXT PRIMARY KEY,
  "mailboxId" TEXT NOT NULL,
  "throttleKey" TEXT NOT NULL,
  address TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mail_send_log__mailbox ON mail_send_log ("mailboxId");
CREATE INDEX IF NOT EXISTS mail_send_log__key ON mail_send_log ("throttleKey");
