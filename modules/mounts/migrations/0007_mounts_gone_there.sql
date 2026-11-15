-- gone_there: the file was deleted or trashed at the provider while an edit made in Vyre was waiting to go out. The edit is not sent anywhere (the provider no longer has the file) and not lost: the row says so and the
-- person picks Keep it here (it goes back to the provider as a new file) or Discard. 1 while it waits for that choice.
ALTER TABLE mounts_item ADD COLUMN gone_there INTEGER NOT NULL DEFAULT 0;
