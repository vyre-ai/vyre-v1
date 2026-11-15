-- A draft per Automation, saved as the person edits (AUTOMATIONS-BUILD-RC29 phase 1c). rev counts writes, so a write that read an older rev is refused.
CREATE TABLE IF NOT EXISTS "automations_drafts" (
  "automation_id" TEXT PRIMARY KEY,
  "definition" TEXT NOT NULL,
  "base_version" INTEGER NOT NULL,
  "rev" INTEGER NOT NULL,
  "by_who" TEXT NOT NULL,
  "at" INTEGER NOT NULL
);
-- A test of a draft keeps the draft it ran, so the run reads what the person was looking at.
ALTER TABLE "automations_runs" ADD COLUMN "draft_definition" TEXT;
