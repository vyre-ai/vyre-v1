-- Grants (chat design, holes 1, 3 and 5). One row is one permission for one act and one target. A grant lets an act go without a hold, so only a person's press or a person's own message writes one.
-- kind standing: an automation holds it. subject_id is the automation, def_hash the definition it was given for (any edit voids it), step_id the step, target an address, repo or host, or * for
--   whatever a step a person wrote reaches.
-- kind turn: the person's own message asked for it. Single use (used_at). message_id is that message, thread_id its thread; target "" means the message named none. expires_at is set, and a new message
--   from the same person in that thread ends what the last one left unused.
-- kind always: Always allow. Who it lets through: agent_id, thread_id or both. target is a capability, a recipient, or *. expires_at always set.
-- gate_taint: a thread where outside content entered the turn. Outward acts stop there even if asked until the person speaks again (cleared_at); a request that names no target stays stopped after that.
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
  "agent_id" TEXT,
  "thread_id" TEXT,
  "message_id" TEXT,
  "expires_at" INTEGER,
  "used_at" INTEGER,
  "created_at" INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "gate_grants_subject" ON "gate_grants" ("subject_id", "def_hash", "step_id");
CREATE INDEX IF NOT EXISTS "gate_grants_person" ON "gate_grants" ("kind", "person", "act");
CREATE UNIQUE INDEX IF NOT EXISTS "gate_grants_message" ON "gate_grants" ("message_id", "act", "target") WHERE "kind" = 'turn';
CREATE TABLE IF NOT EXISTS "gate_taint" (
  "thread_id" TEXT PRIMARY KEY,
  "source" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  "cleared_at" INTEGER
);
-- gate_links: links this thread may open as a read: the person gave them, or a page already read links to them. Stored as hashes.
CREATE TABLE IF NOT EXISTS "gate_links" (
  "thread_id" TEXT NOT NULL,
  "link" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  PRIMARY KEY ("thread_id", "link")
);
ALTER TABLE "gate_holds" ADD COLUMN "step" TEXT;
