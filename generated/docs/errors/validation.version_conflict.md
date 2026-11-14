# validation.version_conflict

The row changed since it was read (base version mismatch).

HTTP 409. Retryable: yes.

## Raised by

- automations.update
- calendar.update_event
- dropbox.files.create_folder
- dropbox.files.delete
- dropbox.files.upload
- files.save
- files.write
- goals.update
- google.docs.insert_text
- journeys.design
- mounts.doc_insert_text
- notes.update
- records.update
- sheets.update_row
- sheets.upsert_row
- sites.update
- sync.push
- vault.item.update
