-- Teams transcripts that reached Meetings. One row per online meeting and transcript, so a transcript is handed over once and a poll that finds none yet looks again later.
CREATE TABLE IF NOT EXISTS microsoft_teams_seen (
  key TEXT PRIMARY KEY,
  mailbox TEXT NOT NULL,
  "meetingId" TEXT,
  at INTEGER NOT NULL
);
-- When each member's meetings were last looked at, so the mailbox poll does not ask the calendar every two minutes.
CREATE TABLE IF NOT EXISTS microsoft_teams_pull (
  mailbox TEXT PRIMARY KEY,
  "lastAt" INTEGER NOT NULL
);
