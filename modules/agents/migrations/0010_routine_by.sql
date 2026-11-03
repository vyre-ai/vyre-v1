-- Who set a routine when it was not its owner by hand: the agent that saved it for them (the owner asked their Assistant). Kept beside agents_routine so a Space that applied 0001 needs no change
-- to that table. A routine with no row here was set by its owner.
CREATE TABLE IF NOT EXISTS "agents_routine_by" (
  "routineId" TEXT PRIMARY KEY,
  "byKind" TEXT NOT NULL,
  "byId" TEXT NOT NULL
);
-- The last run each routine started and how it went (the runs module says when it ends), for the routine's Last run line.
CREATE TABLE IF NOT EXISTS "agents_routine_last" (
  "routineId" TEXT PRIMARY KEY,
  "runId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "at" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "agents_routine_last__run" ON "agents_routine_last" ("runId");
