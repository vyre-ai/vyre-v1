-- the onboarding screen (owner flowchart): one row per step a person finished or put off, per flow (personal, team, member); one row per flow the screen has already opened for them
CREATE TABLE IF NOT EXISTS "spaces_onboarding_flow" (
  "person" TEXT NOT NULL,
  "flow" TEXT NOT NULL,
  "step" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  PRIMARY KEY ("person", "flow", "step")
);
CREATE TABLE IF NOT EXISTS "spaces_onboarding_seen" (
  "person" TEXT NOT NULL,
  "flow" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  PRIMARY KEY ("person", "flow")
);
