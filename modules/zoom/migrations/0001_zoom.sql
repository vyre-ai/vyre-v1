-- zoom: events Zoom sent twice are applied once (the event id), recording files already pulled into Files (so a repeat download answers the same file), and the cached S2S access token.

CREATE TABLE IF NOT EXISTS zoom_event (
  "eventId" TEXT PRIMARY KEY,
  "type" TEXT NOT NULL,
  "meetingId" TEXT,
  "at" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS zoom_download (
  "recordingFileId" TEXT PRIMARY KEY,
  "meetingId" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "at" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS zoom_state (
  "key" TEXT PRIMARY KEY,
  "value" TEXT NOT NULL
);
