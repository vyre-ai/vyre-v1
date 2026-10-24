# Schema (schema)

Lane L3. Kind module. Status stub. Version 0.1.0.

Requires: nothing.

## Capabilities (19)

- [schema.apply](../capabilities/schema.apply.md): Apply schema changes. Additions go straight through; destructive items (delete or retype a field, drop a type) must be listed in confirm
- [schema.changes.list](../capabilities/schema.changes.list.md): History of schema changes with who and why
- [schema.describe](../capabilities/schema.describe.md): Describe one record type or all of them: fields, field types, options, labels, relations
- [schema.diff](../capabilities/schema.diff.md): Preview a set of schema changes as a diff: what is added, what is destructive, rows affected, and a preview token
- [schema.field_types](../capabilities/schema.field_types.md): Catalogue of field types with their filter operators and options
- [schema.infer](../capabilities/schema.infer.md): Propose a record type from pasted CSV text or a CSV/XLSX file: field names, types, choices and a title field
- [schema.map](../capabilities/schema.map.md): The Schema map: record types as nodes and relations as edges, two hops from a type if given
- [schema.restore_field](../capabilities/schema.restore_field.md): Bring a dropped field back from Trash with its values
- [schema.set_label](../capabilities/schema.set_label.md): Set the sensitivity label of a record type or of one field
- [schema.trash.list](../capabilities/schema.trash.list.md): Dropped fields and types still held in Trash (30 days)
- [schema.types.get](../capabilities/schema.types.get.md): Read one record type with every field
- [schema.types.list](../capabilities/schema.types.list.md): List record types in Personal, Shared with me or Space sections with folders and counts
- [schema.view_kinds](../capabilities/schema.view_kinds.md): Catalogue of view kinds and which field types each needs
- [views.delete](../capabilities/views.delete.md): Delete a saved view
- [views.get](../capabilities/views.get.md): Read one saved view
- [views.list](../capabilities/views.list.md): List saved views of a record type that the caller may see
- [views.publish](../capabilities/views.publish.md): Share a saved view with everyone who can read the type, or make it personal again
- [views.save](../capabilities/views.save.md): Create or change a saved view (personal until published)
- [views.share_external](../capabilities/views.share_external.md): Make a read-only link to a saved view for a client

## Events (7)

- [schema.changed](../events/schema.changed.md): A record type or field changed (add, edit, retype, label, drop)
- [schema.field_restored](../events/schema.field_restored.md): A dropped field came back from Trash
- [schema.label_changed](../events/schema.label_changed.md): The sensitivity label of a type or field changed
- [schema.type_dropped](../events/schema.type_dropped.md): A record type was dropped (copy kept in Trash for 30 days)
- [view.deleted](../events/view.deleted.md): A saved view was deleted
- [view.published](../events/view.published.md): A saved view became shared or personal again
- [view.saved](../events/view.saved.md): A saved view was created or changed
