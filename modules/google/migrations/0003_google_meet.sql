-- Meet transcripts that reached Meetings. One row per conference record, so a record is handed over once and a poll that finds no transcript yet looks again later.
CREATE TABLE IF NOT EXISTS google_meet_seen (
  record TEXT PRIMARY KEY,
  mailbox TEXT NOT NULL,
  "meetingId" TEXT,
  at INTEGER NOT NULL
);
-- When each member's conferences were last looked at, so the mailbox poll does not ask Meet every two minutes.
CREATE TABLE IF NOT EXISTS google_meet_pull (
  mailbox TEXT PRIMARY KEY,
  "lastAt" INTEGER NOT NULL
);
