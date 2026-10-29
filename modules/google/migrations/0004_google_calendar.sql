-- The Calendar calendar each included member's Google calendar was connected as, so the mailbox pass can ask Calendar to sync it without connecting anything (connecting takes an admin).
CREATE TABLE IF NOT EXISTS google_calendar (
  email TEXT PRIMARY KEY,
  "calendarId" TEXT NOT NULL
);
