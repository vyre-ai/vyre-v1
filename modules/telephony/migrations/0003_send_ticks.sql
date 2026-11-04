-- The send times behind the Space sending limits (Console > Messaging > Rules): one row per text, at the time it leaves (a text held for a window or the speed limit keeps the slot it was given).
-- Separate from telephony_send_log, which counts per number for the number caps. The sender prunes rows older than two days.

CREATE TABLE IF NOT EXISTS telephony_send_tick (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS telephony_send_tick__at ON telephony_send_tick (at);
