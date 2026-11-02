-- An outside agent: an app that signed in from outside Vyre (Claude Code, Cursor). It is a normal agent, with a face, a folder and a profile, that runs elsewhere: `runtime` says so. Work waits for it in agents_outside_jobs,
-- because it is not running all the time: it reads this queue with the agents_next tool.
ALTER TABLE "agents_agent" ADD COLUMN "runtime" TEXT NOT NULL DEFAULT 'vyre';
CREATE TABLE IF NOT EXISTS "agents_outside_jobs" (
  "id" TEXT PRIMARY KEY,
  "agentId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "threadId" TEXT,
  "taskId" TEXT,
  "messageId" TEXT,
  "from" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "dedupe" TEXT,
  "queuedAt" INTEGER NOT NULL,
  "takenAt" INTEGER
);
CREATE INDEX IF NOT EXISTS "agents_outside_jobs__agent" ON "agents_outside_jobs" ("agentId", "takenAt", "queuedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "agents_outside_jobs__dedupe" ON "agents_outside_jobs" ("agentId", "dedupe");
