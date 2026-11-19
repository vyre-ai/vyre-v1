-- Where an agent's webhook secret is kept: the Vault folder and item made for this site alone ({folderId, itemId, handle}), found by these ids and never by a name another member could have taken first.
ALTER TABLE sites_site ADD COLUMN hook_vault TEXT;
