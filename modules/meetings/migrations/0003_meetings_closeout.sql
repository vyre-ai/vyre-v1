-- The close-out of a meeting (lane l-meetings): one package per meeting, prepared by its owner's Assistant from the transcript. The package row keeps its state and the summary, decisions and open
-- questions; each proposed task, record update, follow-up email and calendar hold is an item with its own status and what approving it made. A meeting shared to a project or channel is
-- listed for everyone who can read that project or channel.
CREATE TABLE IF NOT EXISTS meetings_closeout (
  "recordId" TEXT PRIMARY KEY,
  "owner" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "gen" INTEGER NOT NULL,
  "taskId" TEXT,
  "agentId" TEXT,
  "summary" TEXT,
  "decisions" TEXT NOT NULL,
  "questions" TEXT NOT NULL,
  "people" TEXT NOT NULL,
  "preparedAt" INTEGER,
  "updatedAt" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meetings_item (
  "id" TEXT PRIMARY KEY,
  "recordId" TEXT NOT NULL,
  "gen" INTEGER NOT NULL,
  "idx" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "dedupe" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "made" TEXT,
  "error" TEXT,
  "by" TEXT,
  "at" INTEGER
);

CREATE TABLE IF NOT EXISTS meetings_share (
  "recordId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  PRIMARY KEY ("recordId", "kind", "targetId")
);
