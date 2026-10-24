# Backups (backup)

Lane L7b. Kind module. Status stub. Version 0.1.0.

Requires: nothing.

## Capabilities (10)

- [backup.config_get](../capabilities/backup.config_get.md): Read the backup target, schedule and encryption status
- [backup.config_set](../capabilities/backup.config_set.md): Set the backup target and schedule (one switch)
- [backup.delete](../capabilities/backup.delete.md): Delete a backup file from the target
- [backup.export_start](../capabilities/backup.export_start.md): Start the owner full export as a zip (never secret values, never other people private chats or personal memory)
- [backup.health](../capabilities/backup.health.md): Backup health probe: age of the last good backup
- [backup.list](../capabilities/backup.list.md): List backups with size, sequence number and verification state
- [backup.restore](../capabilities/backup.restore.md): Restore from a backup (takes a fresh backup first, replays tombstones before opening for traffic)
- [backup.restore_preview](../capabilities/backup.restore_preview.md): Show what a restore would change: sequence range, tombstones to replay, members affected
- [backup.run](../capabilities/backup.run.md): Run a backup now
- [backup.verify](../capabilities/backup.verify.md): Restore a backup into a scratch directory and check the hash chain

## Events (5)

- [backup.completed](../events/backup.completed.md): A backup finished and was written to the target
- [backup.config_changed](../events/backup.config_changed.md): Backup target or schedule changed
- [backup.failed](../events/backup.failed.md): A backup failed
- [backup.restored](../events/backup.restored.md): A backup was restored; tombstones were replayed before the Space opened
- [backup.verified](../events/backup.verified.md): A backup restored cleanly into a scratch directory
