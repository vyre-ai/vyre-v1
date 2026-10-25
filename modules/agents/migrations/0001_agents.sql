-- Agents tables (P-L2_12, spec 2.6, ARCH 6.10, 7.2). An agent is a record type (declared in the manifest), one folder in Files (Agents/<name>) and one name in Chats; this module keeps the lifecycle,
-- the last good configuration, the routines each person sets, the suggestions and the template state. The files themselves (AGENT.md, agent.toml) live in Files and are saved through files.save.

CREATE TABLE IF NOT EXISTS "agents_agent" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "nameKey" TEXT NOT NULL,
  "face" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "folderId" TEXT,
  "tomlFileId" TEXT,
  "agentMdFileId" TEXT,
  "tomlText" TEXT NOT NULL DEFAULT '',
  "config" TEXT NOT NULL DEFAULT '{}',
  "configError" TEXT,
  "lastGoodVersionId" TEXT,
  "hasComputer" INTEGER NOT NULL DEFAULT 0,
  "templateVersion" INTEGER NOT NULL DEFAULT 0,
  "paused" INTEGER NOT NULL DEFAULT 0,
  "pausedReason" TEXT,
  "pausedBy" TEXT,
  "pausedAt" INTEGER,
  "working" INTEGER NOT NULL DEFAULT 0,
  "lastActiveAt" INTEGER,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL,
  "deletedAt" INTEGER
);
CREATE INDEX IF NOT EXISTS "agents_agent__name" ON "agents_agent" ("nameKey");
CREATE INDEX IF NOT EXISTS "agents_agent__owner" ON "agents_agent" ("ownerId");

-- A routine belongs to the person who set it: only that person sees, edits or deletes it (spec 2.6, ARCH 7.2 message meta).
CREATE TABLE IF NOT EXISTS "agents_routine" (
  "id" TEXT PRIMARY KEY,
  "agentId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "cron" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "channelId" TEXT,
  "enabled" INTEGER NOT NULL DEFAULT 1,
  "lastRunAt" INTEGER,
  "nextRunAt" INTEGER,
  "createdAt" INTEGER NOT NULL,
  "updatedAt" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "agents_routine__agent" ON "agents_routine" ("agentId");
CREATE INDEX IF NOT EXISTS "agents_routine__owner" ON "agents_routine" ("ownerId");

-- The last delegation of a routine, so Undo can hand it back (P-CC_20). One row per routine; handing it back deletes the row.
CREATE TABLE IF NOT EXISTS "agents_routine_delegation" (
  "routineId" TEXT PRIMARY KEY,
  "fromOwnerId" TEXT NOT NULL,
  "fromAgentId" TEXT NOT NULL,
  "toKind" TEXT NOT NULL,
  "toId" TEXT NOT NULL,
  "at" INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS "agents_suggestion" (
  "id" TEXT PRIMARY KEY,
  "agentId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "file" TEXT NOT NULL,
  "diff" TEXT NOT NULL,
  "reason" TEXT,
  "widening" INTEGER NOT NULL DEFAULT 0,
  "state" TEXT NOT NULL DEFAULT 'open',
  "proposedBy" TEXT NOT NULL,
  "proposedAt" INTEGER NOT NULL,
  "resolvedBy" TEXT,
  "resolvedAt" INTEGER,
  "taskId" TEXT,
  "afterText" TEXT
);
CREATE INDEX IF NOT EXISTS "agents_suggestion__agent" ON "agents_suggestion" ("agentId");

-- What a run used: the files as they were when the run started (changes apply between runs).
CREATE TABLE IF NOT EXISTS "agents_snapshot" (
  "id" TEXT PRIMARY KEY,
  "agentId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "runId" TEXT,
  "tomlVersionId" TEXT,
  "agentMdVersionId" TEXT,
  "config" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "agents_snapshot__agent" ON "agents_snapshot" ("agentId", "version");

-- Space-wide values: the template fingerprint and version, the propagation mode.
CREATE TABLE IF NOT EXISTS "agents_meta" (
  "key" TEXT PRIMARY KEY,
  "value" TEXT NOT NULL
);

-- The admin toggle "All in the Space" for agent lists, per admin (logged in the audit trail by the pipeline).
CREATE TABLE IF NOT EXISTS "agents_visibility" (
  "principal" TEXT PRIMARY KEY,
  "allAgents" INTEGER NOT NULL,
  "at" INTEGER NOT NULL
);
