-- The name a tool call went to the server under, kept so a call asked again after a restart carries the same idempotency key (agent/src/turn-engine/journal.ts).
ALTER TABLE engine_turn_journal ADD COLUMN call_key TEXT;
