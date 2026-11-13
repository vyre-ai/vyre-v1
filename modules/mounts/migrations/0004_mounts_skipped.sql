-- Items of a provider's tree that a pass could not bring in (JSON list of { remoteId, name, reason }), so Files can say "3 items could not be shown" and list them. One such item never fails the mount:
-- a mount is failing only when the provider cannot be reached or does not allow it. Null when nothing was skipped.
ALTER TABLE mounts_mount ADD COLUMN skipped TEXT;
