-- Who set a routine when it was not its owner by hand: the agent that saved it for them (the owner asked their Assistant). Kept beside agents_routine so a Space that applied 0001 needs no change
-- to that table. A routine with no row here was set by its owner.
CREATE TABLE IF NOT EXISTS "agents_routine_by" (
  "routineId" TEXT PRIMARY KEY,
  "byKind" TEXT NOT NULL,
  "byId" TEXT NOT NULL
);
