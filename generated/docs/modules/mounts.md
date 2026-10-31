# Mounts (mounts)

Lane L4. Kind module. Version 0.1.0.

Requires: files.

## Capabilities (16)

- [mounts.add](../capabilities/mounts.add.md): Mount a Google or SharePoint folder, a folder on your computer or a GitHub repository into a folder of the tree; the first sync is a Run
- [mounts.browse](../capabilities/mounts.browse.md): Browse a drive, library or repository search to pick what to mount
- [mounts.editors](../capabilities/mounts.editors.md): Who last edited each file at the provider, for the rows of a file list (files outside a mount are left out)
- [mounts.get](../capabilities/mounts.get.md): Read one mount: state, lag, pending changes and conflicts (the sync line of a folder)
- [mounts.history](../capabilities/mounts.history.md): The provider's revisions of a file, newest first, with who saved each (the person or agent for edits sent from Vyre)
- [mounts.lag](../capabilities/mounts.lag.md): Worst mount lag in seconds and the mounts that are failing
- [mounts.list](../capabilities/mounts.list.md): List mounts the caller can see
- [mounts.local_report](../capabilities/mounts.local_report.md): A device reports changes in a mounted local folder and uploads their blobs (system)
- [mounts.nudge](../capabilities/mounts.nudge.md): A provider push notice (Drive channel, Graph subscription) or an app showing a mount asks for a sync pass (system)
- [mounts.open](../capabilities/mounts.open.md): Open a file of a mount: ask the provider what it holds now and fetch the content only when the copy in Vyre is not that version
- [mounts.pause](../capabilities/mounts.pause.md): Pause syncing of a mount
- [mounts.remove](../capabilities/mounts.remove.md): Remove a mount; keep the files as a plain folder or delete the copy
- [mounts.restore](../capabilities/mounts.restore.md): Put an earlier revision of a file back as the newest; it goes out like any edit
- [mounts.resume](../capabilities/mounts.resume.md): Resume a paused mount
- [mounts.sync_now](../capabilities/mounts.sync_now.md): Sync a mount now (a Run); the provider change feed and the folder both move
- [mounts.update](../capabilities/mounts.update.md): Change mount options: server copy or live only, Review changes, read-only pull

## Events (9)

- [folder.mounted](../events/folder.mounted.md): A drive, library, local folder or repository was mounted as a folder
- [mount.conflict](../events/mount.conflict.md): A file changed at the provider while an edit in Vyre waited to go out; the edit was kept beside it as a copy
- [mount.failed](../events/mount.failed.md): A mount sync failed and needs attention
- [mount.file_sent](../events/mount.file_sent.md): An edit made in Vyre went out to the provider as a new revision (who made it is in by)
- [mount.paused](../events/mount.paused.md): A mount was paused
- [mount.removed](../events/mount.removed.md): A mount was removed
- [mount.resumed](../events/mount.resumed.md): A paused mount resumed
- [mount.synced](../events/mount.synced.md): A mount sync pass finished
- [mount.updated](../events/mount.updated.md): Mount options changed
