-- A journalled call whose input had a secret taken out of it before it was kept (agent/src/turn-engine/journal.ts scrubInput): it can never be asked again after a restart.
ALTER TABLE engine_turn_journal ADD COLUMN scrubbed INTEGER NOT NULL DEFAULT 0;
