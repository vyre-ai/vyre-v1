-- Rewind: the point a rewind took of the files as they were just before it, so going back to it undoes the rewind (the messages the agents stopped reading are read again).
ALTER TABLE engine_rewind ADD COLUMN undo_sha TEXT;
