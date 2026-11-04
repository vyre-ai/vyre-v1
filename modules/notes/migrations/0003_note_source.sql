-- Where a note was saved from: a chat message (its chat, the message, the chat's title and the time then), for the "From: <chat>, <time>" link.
ALTER TABLE notes_notes ADD COLUMN from_json TEXT;
