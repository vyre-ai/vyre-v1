-- A Journey as a pipeline on a record type (rc.41): the records of the type move through its stage field, no per-subject Journey record. `mode` is the state machine of the model:
-- subject (one Journey record per subject, the model before rc.41) -> migrating (journeys.to_pipeline is moving each record, a stop halfway resumes) -> pipeline.
ALTER TABLE "journeys_defs" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'subject';
ALTER TABLE "journeys_defs" ADD COLUMN "stage_field" TEXT;
ALTER TABLE "journeys_defs" ADD COLUMN "variables" TEXT;
-- The record type that held the Journey records before the move: its records, channels and folders stay, and its name stays taken.
ALTER TABLE "journeys_defs" ADD COLUMN "legacy_type" TEXT;
-- A record moved onto the pipeline keeps the id of the Journey record it replaced: that record, its channel and its folder stay where they were and can still be opened.
ALTER TABLE "journeys_records" ADD COLUMN "legacy_record_id" TEXT;

-- One row per Journey record being moved onto the pipeline: where each stands, so a migration that stopped halfway resumes and nothing is moved twice or lost.
CREATE TABLE IF NOT EXISTS "journeys_migration" (
  "journey_id" TEXT NOT NULL,
  "legacy_record_id" TEXT NOT NULL,
  "subject_record_id" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "error" TEXT,
  "at" INTEGER NOT NULL,
  PRIMARY KEY ("journey_id", "legacy_record_id")
);
