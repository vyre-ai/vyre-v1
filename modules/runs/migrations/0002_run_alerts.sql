-- Run alerts (P-L6_11, spec 3.7 and 2.13, ARCH 7.7): one row per failed Run that the alert rules looked at, so a Run is alerted once however many times its failure event is seen.
-- `chain` is the escalation chain as it stood when the Run failed (people or roles and the hours after the failure at which each takes over); `stage` is the next link to use.

CREATE TABLE IF NOT EXISTS "runs_alerts" (
  "run_id" TEXT PRIMARY KEY,
  "automation_id" TEXT,
  "state" TEXT NOT NULL,
  "chain" TEXT NOT NULL DEFAULT '[]',
  "stage" INTEGER NOT NULL DEFAULT 0,
  "next_at" INTEGER,
  "failed_at" INTEGER NOT NULL,
  "notified" TEXT NOT NULL DEFAULT '[]',
  "created_at" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "runs_alerts_due" ON "runs_alerts" ("state", "next_at");
