-- What an Assistant proposed for an Automation and a person has not yet accepted (AUTOMATIONS-BUILD-RC29 phase 2). One per Automation.
-- It sits apart from the definition and from the person's own draft: nothing proposed is saved, live or turned on until a person accepts it.
CREATE TABLE IF NOT EXISTS "automations_proposals" (
  "automation_id" TEXT PRIMARY KEY,
  "definition" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "by_who" TEXT NOT NULL,
  "for_who" TEXT NOT NULL,
  "base_version" INTEGER NOT NULL,
  "base_rev" INTEGER NOT NULL,
  "made_shell" INTEGER NOT NULL DEFAULT 0,
  "at" INTEGER NOT NULL
);
