# Connectors and synced types (connectors)

Lane L3. Kind module. Status stub. Version 0.1.0.

Requires: records, schema.

## Capabilities (44)

- [connections.complete_auth](../capabilities/connections.complete_auth.md): Finish an OAuth sign-in from the callback (state and code)
- [connections.create](../capabilities/connections.create.md): Plug an account into a connector; secrets are named Vault items, never values
- [connections.delete](../capabilities/connections.delete.md): Remove a connection; synced types bound to it pause
- [connections.get](../capabilities/connections.get.md): Read one connection
- [connections.list](../capabilities/connections.list.md): List connections; mine, the Space ones or all the caller may see
- [connections.pause](../capabilities/connections.pause.md): The owner pauses a connection; syncing and actions stop
- [connections.reconnect](../capabilities/connections.reconnect.md): Start signing in again; returns the provider sign-in address when one is needed
- [connections.resume](../capabilities/connections.resume.md): The owner resumes a connection
- [connections.test](../capabilities/connections.test.md): Probe a connection with the connector health call
- [connections.update](../capabilities/connections.update.md): Rename a connection or change its scopes
- [connectors.build](../capabilities/connectors.build.md): Run the build-connector flow: read the app docs, draft the connector, ask for a key through a Vault request, run the harness
- [connectors.diff](../capabilities/connectors.diff.md): Diff a draft against the live version of a connector
- [connectors.export](../capabilities/connectors.export.md): Export a connector as a folder in Files (no public gallery in v1)
- [connectors.get](../capabilities/connectors.get.md): Read one connector: auth, egress domains, secret names, sources, synced types and actions
- [connectors.health](../capabilities/connectors.health.md): Aggregate state of connections and sync lag
- [connectors.init](../capabilities/connectors.init.md): Scaffold a connector folder: connector.toml, transforms.js, tests, README
- [connectors.list](../capabilities/connectors.list.md): List connectors: built-in, installed and drafts
- [connectors.outbox.cancel](../capabilities/connectors.outbox.cancel.md): Cancel a pending push (the local edit stays, marked not synced)
- [connectors.outbox.list](../capabilities/connectors.outbox.list.md): Pending, failed and recent pushes with their idempotency keys
- [connectors.outbox.retry](../capabilities/connectors.outbox.retry.md): Retry a failed push now
- [connectors.publish](../capabilities/connectors.publish.md): Publish a draft after a fresh test run; a failing test keeps the last good version live
- [connectors.push](../capabilities/connectors.push.md): Write one outbox item to the remote app (called by the outbox consumer only)
- [connectors.remove](../capabilities/connectors.remove.md): Remove a connector and its connections
- [connectors.rollback](../capabilities/connectors.rollback.md): Put an earlier connector version back live
- [connectors.run](../capabilities/connectors.run.md): Run one connector action against the live app, sandboxed to the connector domains, with a dry run option
- [connectors.sync_now](../capabilities/connectors.sync_now.md): Start a sync Run for a synced type or a connection; modes: incremental, reconcile, backfill, dry_run
- [connectors.test](../capabilities/connectors.test.md): Run the harness on recorded responses and report each case
- [connectors.versions](../capabilities/connectors.versions.md): List published versions of a connector
- [sync_types.confirm_deletes](../capabilities/sync_types.confirm_deletes.md): Decide what happens when many records vanished at the source: mark them removed or keep them
- [sync_types.create](../capabilities/sync_types.create.md): Bind a record type (new or existing) to a remote object with field directions, match rule and conflict rule
- [sync_types.discover](../capabilities/sync_types.discover.md): List remote objects and their fields with a proposed record type and mapping
- [sync_types.get](../capabilities/sync_types.get.md): Read the sync binding of a record type (the header line, mapping and rules)
- [sync_types.list](../capabilities/sync_types.list.md): List synced types with state, pending pushes, conflicts and schema changes
- [sync_types.log](../capabilities/sync_types.log.md): Sync log: runs, pulls and pushes under one trace id each
- [sync_types.make_native](../capabilities/sync_types.make_native.md): Detach a synced type and keep it as a native type with its ids, history and attribution
- [sync_types.pause](../capabilities/sync_types.pause.md): Pause sync of a type
- [sync_types.preview](../capabilities/sync_types.preview.md): Dry run: what a sync would do, such as will update 34 records in HubSpot, and the first-sync match counts
- [sync_types.replay_conflict](../capabilities/sync_types.replay_conflict.md): Replay a conflict on a copy to see what each rule would have produced
- [sync_types.resolve_conflict](../capabilities/sync_types.resolve_conflict.md): Settle a sync conflict: keep ours, take theirs, or enter a value
- [sync_types.resume](../capabilities/sync_types.resume.md): Resume sync of a type
- [sync_types.review_schema](../capabilities/sync_types.review_schema.md): Accept or ignore remote schema changes; accepted ones go through schema.apply
- [sync_types.schema_changes](../capabilities/sync_types.schema_changes.md): Remote schema changes waiting for review (for example 3 changes to review)
- [sync_types.undo_push](../capabilities/sync_types.undo_push.md): Reverse one push using the stored replaced value
- [sync_types.update](../capabilities/sync_types.update.md): Change field directions, transforms, match, create-at-source, deletes, conflict rule or polling

## Events (24)

- [connection.created](../events/connection.created.md): A connection was made
- [connection.deleted](../events/connection.deleted.md): A connection was removed
- [connection.needs_reconnect](../events/connection.needs_reconnect.md): The provider rejected the sign-in; the owner must reconnect
- [connection.paused](../events/connection.paused.md): The owner paused a connection
- [connection.reconnected](../events/connection.reconnected.md): A connection signed in again
- [connection.resumed](../events/connection.resumed.md): A paused connection resumed
- [connector.built](../events/connector.built.md): The build-connector flow produced a draft
- [connector.created](../events/connector.created.md): A connector folder was scaffolded
- [connector.publish_failed](../events/connector.publish_failed.md): Publish was refused because tests failed; the last good version stays live
- [connector.published](../events/connector.published.md): A connector version went live after a fresh passing test run
- [connector.removed](../events/connector.removed.md): A connector was removed
- [connector.rolled_back](../events/connector.rolled_back.md): A connector went back to an earlier version
- [sync.completed](../events/sync.completed.md): A sync run finished
- [sync.conflict](../events/sync.conflict.md): Both sides changed the same field and the rule asks a person (values are not in the payload)
- [sync.deletes_paused](../events/sync.deletes_paused.md): More than the guard allows vanished at the source; sync waits for a person
- [sync.push_failed](../events/sync.push_failed.md): A change could not be written to the remote app after retries
- [sync.push_undone](../events/sync.push_undone.md): A push was reversed with the stored replaced value
- [sync.pushed](../events/sync.pushed.md): A change was written to the remote app
- [sync.schema_changed](../events/sync.schema_changed.md): The remote schema changed and needs review
- [sync.type_bound](../events/sync.type_bound.md): A record type was bound to a remote object
- [sync.type_native](../events/sync.type_native.md): A synced type was detached and kept as a native type with its ids, history and attribution
- [sync.type_paused](../events/sync.type_paused.md): Sync of a type was paused
- [sync.type_resumed](../events/sync.type_resumed.md): Sync of a type was resumed
- [sync.type_updated](../events/sync.type_updated.md): Mapping, direction or rules of a synced type changed
