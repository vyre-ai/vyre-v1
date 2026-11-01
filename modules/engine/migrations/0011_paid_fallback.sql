-- A paid key that takes over from an account that ran out is a person's call (hole 7). The Need is an Unblock: paid_ref says which key it asks about, and answering it leaves one row here, so this chat and
-- this agent may use that key from then on. A key on the agent's fallback list or the person's own fallback order was chosen already and never asks.
ALTER TABLE engine_unblock ADD COLUMN paid_ref TEXT;
CREATE TABLE IF NOT EXISTS engine_paid_ok (
  thread_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  ref TEXT NOT NULL,
  by_person TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (thread_id, agent_id, ref)
);
