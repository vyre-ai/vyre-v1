-- Delete for good (F77): a step that keeps failing backs off (3 seconds, 30 seconds, 5 minutes) instead of retrying every pass, and the Trash row says so.
CREATE TABLE IF NOT EXISTS "agents_erase_retry" (
  "agentId" TEXT PRIMARY KEY,
  "nextAt" INTEGER NOT NULL
);
