-- A link card's picture, fetched on the server at unfurl time (automations.read_link with preview) and kept as a notes blob, so no browser asks the other site for it.
ALTER TABLE notes_notes ADD COLUMN link_blob TEXT;
ALTER TABLE notes_notes ADD COLUMN link_blob_type TEXT;
