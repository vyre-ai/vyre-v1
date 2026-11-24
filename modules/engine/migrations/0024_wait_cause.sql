-- Why the turn that parked on a held call was started (message, wake, interrupt, handoff): the wake that continues it carries the same cause, so a resumed wake is guarded like a wake and a resumed message turn is not.
ALTER TABLE engine_waits ADD COLUMN cause TEXT;
