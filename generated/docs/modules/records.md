# Records (records)

Lane L3. Kind module. Status stub. Version 0.1.0.

Requires: nothing.

## Capabilities (20)

- [records.as_of](../capabilities/records.as_of.md): Read a record as it was at a time
- [records.bulk_upsert](../capabilities/records.bulk_upsert.md): Create or update many records by match key, quietly (no automations unless asked)
- [records.changes](../capabilities/records.changes.md): Change feed of a record type since a sequence number (RecordStore.changes)
- [records.counts](../capabilities/records.counts.md): Cached row count for a view
- [records.create](../capabilities/records.create.md): Create a record
- [records.delete](../capabilities/records.delete.md): Move a record to Trash
- [records.export](../capabilities/records.export.md): Export rows as CSV or Excel (permissioned)
- [records.get](../capabilities/records.get.md): Read one record by id
- [records.history](../capabilities/records.history.md): Field history of a record: previous values and merge losers
- [records.hold](../capabilities/records.hold.md): Place a hold on a record
- [records.merge](../capabilities/records.merge.md): Merge records into a survivor with a value picked per field (undoable for 30 days)
- [records.query](../capabilities/records.query.md): Query rows of a record type with filter, sort, group and window
- [records.relate](../capabilities/records.relate.md): Link two records through a relation field
- [records.release_hold](../capabilities/records.release_hold.md): Release a hold on a record
- [records.restore](../capabilities/records.restore.md): Restore a record from Trash
- [records.restore_version](../capabilities/records.restore_version.md): Restore a record to an earlier version
- [records.reveal](../capabilities/records.reveal.md): Reveal a sealed field to the caller (asked once, logged per actor)
- [records.search](../capabilities/records.search.md): Search rows by text across a record type
- [records.update](../capabilities/records.update.md): Update fields of a record (per-field merge for sync, base version for API callers)
- [records.versions](../capabilities/records.versions.md): List versions of a record (One History)

## Events (8)

- [field.revealed](../events/field.revealed.md): A sealed field was revealed to one actor (audited)
- [record.created](../events/record.created.md): A record was created
- [record.deleted](../events/record.deleted.md): A record moved to Trash
- [record.held](../events/record.held.md): A hold was placed on a record
- [record.hold_released](../events/record.hold_released.md): A hold was released
- [record.merged](../events/record.merged.md): Two records were merged into a survivor
- [record.restored](../events/record.restored.md): A record came back from Trash
- [record.updated](../events/record.updated.md): Fields of a record changed (values never included for sealed fields)
