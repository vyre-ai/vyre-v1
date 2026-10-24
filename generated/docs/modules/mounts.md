# Mounts (mounts)

Lane L4. Kind module. Status stub. Version 0.1.0.

Requires: files.

## Capabilities (11)

- [mounts.add](../capabilities/mounts.add.md): Mount a Google or SharePoint folder, a folder on your computer or a GitHub repository into a folder of the tree; the first sync is a Run
- [mounts.browse](../capabilities/mounts.browse.md): Browse a drive, library or repository search to pick what to mount
- [mounts.get](../capabilities/mounts.get.md): Read one mount: state, lag, pending changes and conflicts (the sync line of a folder)
- [mounts.lag](../capabilities/mounts.lag.md): Worst mount lag in seconds and the mounts that are failing
- [mounts.list](../capabilities/mounts.list.md): List mounts the caller can see
- [mounts.local_report](../capabilities/mounts.local_report.md): A device reports changes in a mounted local folder and uploads their blobs (system)
- [mounts.pause](../capabilities/mounts.pause.md): Pause syncing of a mount
- [mounts.remove](../capabilities/mounts.remove.md): Remove a mount; keep the files as a plain folder or delete the copy
- [mounts.resume](../capabilities/mounts.resume.md): Resume a paused mount
- [mounts.sync_now](../capabilities/mounts.sync_now.md): Sync a mount now (a Run); the provider change feed and the folder both move
- [mounts.update](../capabilities/mounts.update.md): Change mount options: server copy or live only, Review changes, read-only pull

## Events (7)

- [folder.mounted](../events/folder.mounted.md): A drive, library, local folder or repository was mounted as a folder
- [mount.failed](../events/mount.failed.md): A mount sync failed and needs attention
- [mount.paused](../events/mount.paused.md): A mount was paused
- [mount.removed](../events/mount.removed.md): A mount was removed
- [mount.resumed](../events/mount.resumed.md): A paused mount resumed
- [mount.synced](../events/mount.synced.md): A mount sync pass finished
- [mount.updated](../events/mount.updated.md): Mount options changed
