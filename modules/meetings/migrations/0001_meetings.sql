-- meetings: a Meeting is an ordinary record (type meeting, fields in manifests/meetings.ts); these tables keep what a record cannot: the index the merge rule reads (provider id, join link, time, attendee
-- emails), the calendar events folded into the meeting, the recording file and length, the transcript segments, and which Run is working on which meeting.

CREATE TABLE IF NOT EXISTS meetings_link (
  "recordId" TEXT PRIMARY KEY,
  "providerRef" TEXT,
  "joinUrl" TEXT,
  "startsAt" INTEGER NOT NULL,
  "endsAt" INTEGER,
  "emails" TEXT NOT NULL,
  "eventIds" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "recordingFileId" TEXT,
  "recordingDurationSec" INTEGER,
  "folderId" TEXT,
  "mergedBy" TEXT,
  "createdAt" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meetings_segment (
  "id" TEXT PRIMARY KEY,
  "recordId" TEXT NOT NULL,
  "idx" INTEGER NOT NULL,
  "startMs" INTEGER NOT NULL,
  "endMs" INTEGER NOT NULL,
  "speaker" TEXT,
  "text" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meetings_run (
  "runId" TEXT PRIMARY KEY,
  "recordId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "at" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meetings_state (
  "key" TEXT PRIMARY KEY,
  "value" TEXT NOT NULL
);
