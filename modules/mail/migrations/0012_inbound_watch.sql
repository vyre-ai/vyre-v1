-- What watching an inbox needs to remember (lane r42-email-in). Which received messages are machine-made (an auto-reply, a delivery report, a list), so nothing
-- answers them automatically and starts a loop, and the last few things that went wrong on the way in, so an inbox can say what failed and what to do.

CREATE TABLE IF NOT EXISTS mail_inbound_ext (
  "messageId" TEXT PRIMARY KEY,
  auto INTEGER NOT NULL DEFAULT 0,
  why TEXT
);

CREATE TABLE IF NOT EXISTS mail_inbound_problem (
  id TEXT PRIMARY KEY,
  "mailboxId" TEXT,
  address TEXT,
  kind TEXT NOT NULL,
  reason TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mail_inbound_problem__box ON mail_inbound_problem ("mailboxId");
