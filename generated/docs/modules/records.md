# Records (records)

Lane L3. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (31)

- [records.as_of](../capabilities/records.as_of.md): Read a record as it was at a time
- [records.bulk_upsert](../capabilities/records.bulk_upsert.md): Create or update many records by match key, quietly (no automations unless asked)
- [records.changes](../capabilities/records.changes.md): Change feed of a record type since a sequence number (RecordStore.changes)
- [records.completeness](../capabilities/records.completeness.md): Completeness of one record (for example 8 of 11) with the missing fields; Ask for these turns the list into a short-lived form
- [records.counts](../capabilities/records.counts.md): Cached row count for a view
- [records.create](../capabilities/records.create.md): Create a record
- [records.delete](../capabilities/records.delete.md): Move a record to Trash
- [records.export](../capabilities/records.export.md): Export rows as CSV or Excel (permissioned), the whole view or only the picked recordIds
- [records.gap_check](../capabilities/records.gap_check.md): Run the gap-check rules of a type over one record or all of them: finds missing or stale fields and names the fill route (AI field, agent lookup, teammate task or collection form)
- [records.get](../capabilities/records.get.md): Read one record by id
- [records.history](../capabilities/records.history.md): Field history of a record: previous values and merge losers
- [records.hold](../capabilities/records.hold.md): Place a hold on a record
- [records.merge](../capabilities/records.merge.md): Merge records into a survivor with a value picked per field (undoable for 30 days)
- [records.page_prefs.get](../capabilities/records.page_prefs.get.md): My choices on the record page of a type: sections I folded and fields I keep visible
- [records.page_prefs.set](../capabilities/records.page_prefs.set.md): Fold sections and keep fields visible for myself; a personal display choice, not a Star
- [records.purge](../capabilities/records.purge.md): Hard-delete one record for good: its fields, history, search entries and Trash row (governance erase; not Trash)
- [records.purge_trashed](../capabilities/records.purge_trashed.md): Hard-delete records that have been in Trash since before a time (retention)
- [records.query](../capabilities/records.query.md): Query rows of a record type with filter, sort, group and window
- [records.relate](../capabilities/records.relate.md): Link two records through a relation field
- [records.relations_map](../capabilities/records.relations_map.md): Relationship map of a record: linked records out to two hops, each edge named by its relation field, limited to what the caller may see
- [records.release_hold](../capabilities/records.release_hold.md): Release a hold on a record
- [records.restore](../capabilities/records.restore.md): Restore a record from Trash
- [records.restore_version](../capabilities/records.restore_version.md): Restore a record to an earlier version
- [records.reveal](../capabilities/records.reveal.md): Reveal a sealed field to the caller (asked once, logged per actor)
- [records.search](../capabilities/records.search.md): Search rows by text across a record type
- [records.update](../capabilities/records.update.md): Update fields of a record (per-field merge for sync, base version for API callers)
- [records.value_source](../capabilities/records.value_source.md): Source popover of one value: who or what filled it, from where, when, and whether it counts yet
- [records.values.pending](../capabilities/records.values.pending.md): Needs review: agent-filled values waiting for a reviewer, each with its source and time (counts into My work for the field reviewer role)
- [records.values.review](../capabilities/records.values.review.md): Accept or reject an agent-filled value; an accepted value counts, a rejected one is dropped and stays in history
- [records.versions](../capabilities/records.versions.md): List versions of a record (One History)
- [records.view](../capabilities/records.view.md): Read a saved view of a record type resolved for the table: the view definition and its rows with the saved filter, sort and group applied, a page at a time

## Events (13)

- [field.revealed](../events/field.revealed.md): A sealed field was revealed to one actor (audited)
- [record.created](../events/record.created.md): A record was created; fields carries the initial values (sealed and Restricted values as ciphertext only)
- [record.deleted](../events/record.deleted.md): A record moved to Trash; prev carries the values it held (sealed and Restricted values as ciphertext only)
- [record.gaps_found](../events/record.gaps_found.md): A gap-check rule found missing or stale fields on a record
- [record.held](../events/record.held.md): A hold was placed on a record
- [record.hold_released](../events/record.hold_released.md): A hold was released
- [record.merged](../events/record.merged.md): Two records were merged into a survivor
- [record.purged](../events/record.purged.md): A record was hard-deleted for good (ids only)
- [record.restored](../events/record.restored.md): A record came back from Trash
- [record.updated](../events/record.updated.md): Fields of a record changed; fields carries the new values and prev the old ones (sealed and Restricted values as ciphertext only)
- [record.value_proposed](../events/record.value_proposed.md): An agent or automation filled a value; it waits for review or counts straight away, per field
- [record.value_reviewed](../events/record.value_reviewed.md): A reviewer accepted or rejected an agent-filled value
- [records.trash_purged](../events/records.trash_purged.md): Records past their Trash retention were hard-deleted (a count)
