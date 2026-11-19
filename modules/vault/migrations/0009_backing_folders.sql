-- vault: folders the server keeps for values it stores on behalf of something else (the "Sealed fields" folder: one item per sealed record value). Their items are the Space's plumbing, not people's
-- items, so they stay out of every list and search of the Vault; each is read only through the field that holds its reference (records.reveal, the person's own right on the field). The folders already there are marked once, when the table is made (projections.ts markBackingFolders). No value lives here.
CREATE TABLE IF NOT EXISTS vault_backing_folder (
  "folderId" TEXT PRIMARY KEY
);
