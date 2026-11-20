-- Loop protection and a bounded problem list (lane r42-email-in).
-- mail_auto_sender: addresses that sent us machine-made mail, so nothing automatic writes to them first.
-- mail_auto_send: when an Automation or agent sent to an address, so a loop between two auto-responders stops after a few.
-- The unrouted-address list is kept to the newest 100 by the code; the index makes its lookup cheap.

CREATE TABLE IF NOT EXISTS mail_auto_sender (
  address TEXT PRIMARY KEY,
  why TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mail_auto_send (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mail_auto_send__address ON mail_auto_send (address);
CREATE INDEX IF NOT EXISTS mail_inbound_problem__kind ON mail_inbound_problem (kind, at);
