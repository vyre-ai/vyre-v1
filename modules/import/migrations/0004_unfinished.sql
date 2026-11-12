-- A Run whose end the runs module did not take (runs.finish failed when an import ended): kept until the boot-and-every-minute check (handlers/commit.ts interrupted) ends it, so its owner is
-- told. One row per Run; the status and line are what the import meant to end it with.
CREATE TABLE IF NOT EXISTS "import_unfinished" (
  "runId" TEXT PRIMARY KEY,
  "status" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "error" TEXT,
  "at" INTEGER NOT NULL
);
