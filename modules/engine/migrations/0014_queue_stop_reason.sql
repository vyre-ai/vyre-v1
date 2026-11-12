-- A Stop is written on its queue row before it answers (state 'stopping'), so a restart before the turn has wound down closes it instead of running it again. The row keeps why it was stopped
-- (stop, interrupt, limit, left, moved), so the line the chat shows after the restart says the right thing.
ALTER TABLE engine_thread_queue ADD COLUMN stop_reason TEXT;
