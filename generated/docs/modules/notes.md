# Notes (notes)

Lane L2. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (14)

- [notes.clip](../capabilities/notes.clip.md): Vyre for Chrome: clip a page into a private note with its address, title, the selected text and a screenshot
- [notes.create](../capabilities/notes.create.md): Take a note: text, an image, or a link that becomes a card. Private to the person until shared
- [notes.delete](../capabilities/notes.delete.md): Delete a note. It can come back with notes.restore (Undo). Someone it was shared with only removes it from their own notes
- [notes.get](../capabilities/notes.get.md): Read one note the asker may read. An agent reads a note only when everyone in its chat may read it
- [notes.image](../capabilities/notes.image.md): The image of a note, for someone who may read it
- [notes.label](../capabilities/notes.label.md): Add or remove labels on a note
- [notes.list](../capabilities/notes.list.md): The notes the person reads: their own and those shared with them. Pinned first, newest first, with the labels in use
- [notes.pin](../capabilities/notes.pin.md): Pin or unpin a note
- [notes.restore](../capabilities/notes.restore.md): Undo a delete
- [notes.search](../capabilities/notes.search.md): Search the notes the asker may read: title, text, labels, link and clipped page. An agent finds only notes everyone in its chat may read
- [notes.share](../capabilities/notes.share.md): Share a note with people or the Space, change a role, or take it back. Only the owner shares
- [notes.to_record](../capabilities/notes.to_record.md): Turn a note into a record of a type, with fields filled from it. The note keeps the record, so each opens the other
- [notes.to_task](../capabilities/notes.to_task.md): Turn a note into a task. The task holds the note text; the note keeps the task, so each opens the other
- [notes.update](../capabilities/notes.update.md): Change a note: title, text, colour, image or link (null removes the image or link)

## Events (7)

- [notes.clipped](../events/notes.clipped.md): A page was clipped from Vyre for Chrome into a note
- [notes.created](../events/notes.created.md): A note was made
- [notes.deleted](../events/notes.deleted.md): A note was deleted; it can come back with Undo
- [notes.linked](../events/notes.linked.md): A task or record was made from a note
- [notes.restored](../events/notes.restored.md): A deleted note came back (Undo)
- [notes.shared](../events/notes.shared.md): Who reads a note changed
- [notes.updated](../events/notes.updated.md): A note was changed: text, colour, pin, labels, image or link
