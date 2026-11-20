-- How many ticks in a row the automatic move onto a pipeline failed for a reason that may pass (the records module was busy): after five the reason is kept and the Journey waits for Retry.
ALTER TABLE "journeys_defs" ADD COLUMN "migrate_tries" INTEGER NOT NULL DEFAULT 0;
