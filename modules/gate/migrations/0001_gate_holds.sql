-- Gate tables (P-L6_02, ARCH 4.6).
-- gate_holds: one row per held call. state is held, approved, denied or expired. sending_at is set while the approved call runs (held -> sending is one guarded UPDATE, so two taps send once);
-- a row found with sending_at set at boot was interrupted mid-send: recover() puts it back to held and marks it possibly_sent.
-- gate_rules: one row per act and scope (space, floor, agent); agent_id is '' for space and floor.
-- gate_policy: the gate.* settings of the Space; a missing row means the manifest default.

CREATE TABLE IF NOT EXISTS "gate_holds" (
  "id" TEXT PRIMARY KEY,
  "act" TEXT NOT NULL,
  "cap_name" TEXT NOT NULL,
  "cap_version" INTEGER NOT NULL,
  "input" TEXT NOT NULL,
  "input_hash" TEXT NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "principal_kind" TEXT NOT NULL,
  "principal_id" TEXT NOT NULL,
  "acting_for" TEXT,
  "decision_id" TEXT NOT NULL,
  "run_id" TEXT,
  "thread_id" TEXT,
  "task_id" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "approver" TEXT NOT NULL,
  "rule" TEXT NOT NULL,
  "created_at" INTEGER NOT NULL,
  "expires_at" INTEGER NOT NULL,
  "backstop_at" INTEGER,
  "backstop_schedule" TEXT,
  "expire_schedule" TEXT,
  "escalated_at" INTEGER,
  "sending_at" INTEGER,
  "decided_at" INTEGER,
  "decided_by" TEXT,
  "possibly_sent" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT
);
CREATE INDEX IF NOT EXISTS "gate_holds_state" ON "gate_holds" ("state", "expires_at");
CREATE INDEX IF NOT EXISTS "gate_holds_requester" ON "gate_holds" ("principal_id");
CREATE INDEX IF NOT EXISTS "gate_holds_task" ON "gate_holds" ("task_id");
CREATE INDEX IF NOT EXISTS "gate_holds_run" ON "gate_holds" ("run_id");
CREATE UNIQUE INDEX IF NOT EXISTS "gate_holds_decision" ON "gate_holds" ("decision_id");

CREATE TABLE IF NOT EXISTS "gate_rules" (
  "act" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL DEFAULT '',
  "mode" TEXT NOT NULL,
  "approvers" TEXT,
  "agent_ok_for" TEXT,
  "after_hours" INTEGER,
  "on_timeout" TEXT,
  "escalate_to" TEXT,
  "updated_at" INTEGER NOT NULL,
  PRIMARY KEY ("act", "scope", "agent_id")
);

CREATE TABLE IF NOT EXISTS "gate_policy" (
  "policy_key" TEXT PRIMARY KEY,
  "policy_value" TEXT NOT NULL
);
