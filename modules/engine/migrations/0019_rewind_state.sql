-- Rewind (review of 15 Nov): a rewind is written BEFORE the folder is put back, as "going back", and finished after; an Undo is a row of its own (kind "undo") so what was done between a rewind and its Undo
-- can itself be gone back to. `kind` is "rewind" (the range is hidden from the agents) or "undo" (the range is read again); `state` is "going back" until the files and the chat both agree.
ALTER TABLE engine_rewind ADD COLUMN kind TEXT NOT NULL DEFAULT 'rewind';
ALTER TABLE engine_rewind ADD COLUMN state TEXT NOT NULL DEFAULT 'done';
