-- Delete for good (F77, 15 Nov 2026). One row per agent erased or being erased: the job's progress (the stores already cleared, as JSON) so a restart picks up where it stopped, and, once it is done, the
-- tombstone: the agent's id is never reused, and anything that still points at it reads "Deleted agent". The agent's name at the time stays here and in the audit log, nowhere else.
CREATE TABLE IF NOT EXISTS "agents_erase" (
  "agentId" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "folderId" TEXT,
  "requestedBy" TEXT NOT NULL,
  "requestedAt" INTEGER NOT NULL,
  "state" TEXT NOT NULL,
  "doneJson" TEXT NOT NULL,
  "tries" INTEGER NOT NULL,
  "lastError" TEXT,
  "finishedAt" INTEGER
);
