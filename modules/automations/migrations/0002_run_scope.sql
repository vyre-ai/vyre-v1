-- Child Runs of a Parallel lane or a Loop iteration keep their place on the parent link.
-- Scope is containerNodeId plus laneId, or iterationIndex and iterationKey. Null on every other Run.
ALTER TABLE "automations_runs" ADD COLUMN "scope" TEXT;
CREATE INDEX IF NOT EXISTS "automations_runs_parent" ON "automations_runs" ("parent_run");
