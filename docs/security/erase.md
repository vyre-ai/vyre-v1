# Erase and the event log

Erasing a person has to reach the append-only event log, the sync replicas and the backups. This is what each does, and what is left.

## The log

Every event commits to its payload as `commit = sha256(salt || payload)`. The hash chain covers the envelope with that commit. Erasing replaces the payload with `{"erased":true}` and deletes the salt, so the chain still verifies (`LogStore.verify`), the payload can no longer be proved (`proves`), and nobody can test a guess against the commitment.

`events.compact` (`kernel/src/events/compact.ts`) chooses the events:

- every event about an erased entity (entity and entity id), and every event whose payload carries that id;
- every event a person wrote or that was written for them, and events about them as an entity;
- every event whose payload text contains the person's name, email or phone, read from their records before the records are deleted.

After the erase it scrubs the file: `PRAGMA secure_delete` while it runs, then a WAL checkpoint and a `VACUUM`, so freed pages do not keep the text. One row goes in the `tombstones` table of events.db (kind `events`); it holds ids and short hashes, never the text.

What stays in the log: envelopes (ids, event type, actor, times, the names of changed fields). They are needed by the chain and are not personal text.

## Projections

A projection rebuild reads an erased event as a no-op (`isErased`, applied in `ProjectionHost.fold` and in the host's consumers). The erased subject's rows are purged and do not come back. A row of someone else that an erased event touched keeps its last written values until it is next rebuilt, then loses only what the erased event wrote.

Projection tables keep their own copies of values until they are rebuilt or purged: for example `sync_changes.fields` holds field values of past changes. `records.purge` and `governance.erase` remove the rows; a rebuild clears history.

## Sync

A device that pulled the record receives a `delete` change for it with no field values on its next pull. The client turns every delete into the same cleanup as a `hide`: the row, its field clocks, the search entry, saved documents and cached files. A device that never held the row hears nothing. Whole devices are wiped by the purge path (`sync.epoch.bump`) when a person is removed. Test: `modules/sync/tests/erase.devices.test.ts`.

## Backups

`governance.erase.apply` keeps one tombstone of kind `events` with the seqs it erased (numbers, not text). After a restore, `governance.tombstones.reapply` erases the same events again before the Space opens, so a restored backup cannot bring the payloads back into use.

**Accepted limit:** a backup made before the erase still contains the payloads, in the backup file itself, until the retention rotation removes it. Erase does not rewrite old backups. Restoring one re-applies the erase, but the file at rest holds the data until it rotates out.
