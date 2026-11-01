-- Grants (chat design, hole 1). One row is one permission for one act and one target. A grant lets an outward act go without a hold, so only a person's press writes one and any edit of what it
-- covers voids it: a standing row is bound to the hash of the automation's definition.
-- kind: standing (an automation holds it).
-- subject_id: the automation. step_id: the step of the definition the row covers. target: an address, repo or host, or * when the row covers whatever that step reaches.
-- gate_holds.step: the automation step a held call came from, so approving it can add the one target it reached.
CREATE TABLE IF NOT EXISTS "gate_grants" (
  "id" TEXT PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "person" TEXT NOT NULL,
  "act" TEXT NOT NULL,
  "target" TEXT NOT NULL,
  "def_hash" TEXT,
  "subject_id" TEXT,
  "step_id" TEXT,
  "created_at" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "gate_grants_subject" ON "gate_grants" ("subject_id", "def_hash", "step_id");
ALTER TABLE "gate_holds" ADD COLUMN "step" TEXT;
