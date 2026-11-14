-- A routine's clock is a wake in the scheduler (scheduler-api, P1 step 4): this row says which one. The routine row keeps enabled, nextRunAt and lastRunAt, mirrored from the wake, so a build that does not know the
-- table still sees the same times. A routine with no row here has no wake yet (the backfill and the reconcile make it).
CREATE TABLE IF NOT EXISTS "agents_routine_wake" (
  "routineId" TEXT PRIMARY KEY,
  "scheduleId" TEXT NOT NULL,
  "createdAt" INTEGER NOT NULL
);
