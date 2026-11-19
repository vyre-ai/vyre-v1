-- Plain lines a step leaves in the Run log (an Automation saved before the variable check ran with a name that was not there: it read empty, and the log says so). One row per line.
CREATE TABLE IF NOT EXISTS "runs_step_notes" (
  "run_id" TEXT NOT NULL,
  "step" TEXT NOT NULL,
  "attempt" INTEGER NOT NULL,
  "note" TEXT NOT NULL,
  PRIMARY KEY ("run_id", "step", "attempt", "note")
);
