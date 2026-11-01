-- A turn that started a tool has acted on the world. A queue row carries that from the first tool call, so a host that dies mid-turn leaves enough behind for the next one to tell a turn it may run again
-- from one that only a person may run again (hole 12).
ALTER TABLE engine_thread_queue ADD COLUMN touched INTEGER NOT NULL DEFAULT 0;
