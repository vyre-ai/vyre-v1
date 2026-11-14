-- shown_name: the name the item has in Files as the last pass set it (the provider's name made safe by displayName, or with "(Google Drive)" added when two items share a name). `name` stays the provider's own.
-- An edit in Vyre is told from a rename by comparing Files' name with shown_name, never with `name`. Null on older rows: the comparison then also accepts the names a pass would have given the item.
ALTER TABLE mounts_item ADD COLUMN shown_name TEXT;
