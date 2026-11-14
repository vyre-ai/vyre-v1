-- A note counts its saves, as a task does: an agent or a person who read version N can say so, and a save made on an older one is refused instead of replacing a later change.
ALTER TABLE notes_notes ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
