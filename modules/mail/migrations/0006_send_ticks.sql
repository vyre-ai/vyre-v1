-- The send times behind the Space sending limits (Console > Messaging > Rules): one row per message, at the time it leaves (a message held for a window or the speed limit keeps the slot it was given).
-- The daily limit counts rows from the last 24 hours and the speed limit counts rows in a minute. The sender prunes rows older than two days.

CREATE TABLE IF NOT EXISTS mail_send_tick (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS mail_send_tick__at ON mail_send_tick (at);
