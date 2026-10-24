# Server updates (updates)

Lane L7b. Kind module. Status stub. Version 0.1.0.

Requires: nothing.

## Capabilities (8)

- [updates.app_compat](../capabilities/updates.app_compat.md): Which app versions this server supports (within 2 minor versions); older apps read-only
- [updates.apply](../capabilities/updates.apply.md): Update the server: backup first, apply, health check, roll back on failure
- [updates.channel_set](../capabilities/updates.channel_set.md): Choose the update channel
- [updates.check](../capabilities/updates.check.md): Check for a newer server version and the apps it supports
- [updates.health](../capabilities/updates.health.md): Update health probe: pending security update or failed last update
- [updates.history](../capabilities/updates.history.md): List past updates with result and duration
- [updates.rollback](../capabilities/updates.rollback.md): Roll back to the previous server version
- [updates.status](../capabilities/updates.status.md): Current version, channel, available version and last update result

## Events (4)

- [update.completed](../events/update.completed.md): A server update finished
- [update.failed](../events/update.failed.md): A server update failed and the server rolled back
- [update.rolled_back](../events/update.rolled_back.md): The server rolled back to a previous version
- [update.started](../events/update.started.md): A server update began (backup taken first)
