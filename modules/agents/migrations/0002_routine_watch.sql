-- A watcher is a routine that fires on an event instead of a schedule (P-CC_34): when a message is posted in the channel it names, a run starts under the routine owner.
-- Kept in its own table so a Space that already applied 0001 needs no change to agents_routine. A routine with no row here is a schedule.
CREATE TABLE IF NOT EXISTS "agents_routine_watch" (
  "routineId" TEXT PRIMARY KEY,
  "channelId" TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS "agents_routine_watch__channel" ON "agents_routine_watch" ("channelId");
