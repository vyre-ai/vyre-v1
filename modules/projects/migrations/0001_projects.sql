-- Projects tables (P-L3_09, spec 3.4, 2.12, ARCH 7.4). The project and task record types are declared in the manifest and live in the records module (rt_project, rt_task);
-- the tasks themselves are owned by module tasks. These tables hold what only the project knows: where its channel and folder are, who has which role, its stages,
-- the plan facts a task does not carry (stage, start), dependency arrows, cascade proposals, the status update and the pinned files.

CREATE TABLE IF NOT EXISTS "projects_project" (
  "projectId" TEXT PRIMARY KEY,
  "recordId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "channelId" TEXT,
  "folderId" TEXT,
  "threadId" TEXT,
  "source" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "projects_project_record" ON "projects_project" ("recordId");
CREATE INDEX IF NOT EXISTS "projects_project_channel" ON "projects_project" ("channelId");

CREATE TABLE IF NOT EXISTS "projects_member" (
  "projectId" TEXT NOT NULL,
  "principal" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "since" INTEGER NOT NULL,
  PRIMARY KEY ("projectId", "principal")
);
CREATE INDEX IF NOT EXISTS "projects_member_principal" ON "projects_member" ("principal");

CREATE TABLE IF NOT EXISTS "projects_stage" (
  "projectId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "ord" INTEGER NOT NULL,
  PRIMARY KEY ("projectId", "key")
);

-- The plan facts of one task: its stage, its start (the due date lives on the task), and the thread opened for it in the project channel.
CREATE TABLE IF NOT EXISTS "projects_plan" (
  "projectId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "stage" TEXT,
  "start" INTEGER,
  "ord" REAL,
  "threadId" TEXT,
  PRIMARY KEY ("projectId", "taskId")
);

-- A dependency arrow: "toTask" cannot start before "fromTask" is due.
CREATE TABLE IF NOT EXISTS "projects_link" (
  "projectId" TEXT NOT NULL,
  "fromTask" TEXT NOT NULL,
  "toTask" TEXT NOT NULL,
  PRIMARY KEY ("projectId", "fromTask", "toTask")
);

CREATE TABLE IF NOT EXISTS "projects_proposal" (
  "proposalId" TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "byWho" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL,
  "state" TEXT NOT NULL,
  "moves" TEXT NOT NULL,
  "holds" TEXT NOT NULL,
  "summary" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "projects_proposal_project" ON "projects_proposal" ("projectId", "state");

CREATE TABLE IF NOT EXISTS "projects_update" (
  "projectId" TEXT PRIMARY KEY,
  "text" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  "byWho" TEXT NOT NULL,
  "drafted" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "projects_pin" (
  "projectId" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  PRIMARY KEY ("projectId", "fileId")
);

CREATE TABLE IF NOT EXISTS "projects_filed" (
  "projectId" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  PRIMARY KEY ("projectId", "threadId")
);

-- Results of calls that carry an idempotency key, so the same key returns the same answer.
CREATE TABLE IF NOT EXISTS "projects_key" (
  "key" TEXT PRIMARY KEY,
  "cap" TEXT NOT NULL,
  "result" TEXT NOT NULL
);

-- Read-only links to the Overview made for a client.
CREATE TABLE IF NOT EXISTS "projects_share" (
  "token" TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "expiresAt" INTEGER,
  "createdBy" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL
);
