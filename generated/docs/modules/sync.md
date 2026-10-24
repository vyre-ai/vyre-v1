# Sync (sync)

Lane L1. Kind module. Status stub. Version 0.1.0.

Requires: nothing.

## Capabilities (16)

- [sync.acl.reindex](../capabilities/sync.acl.reindex.md): Emit synthetic upsert or hide changes for rows whose visibility changed after a grant, revoke or label change
- [sync.devices.lag](../capabilities/sync.devices.lag.md): Per device cursor lag for the Console (people, device class, last seen, lag in changes)
- [sync.doc.close](../capabilities/sync.doc.close.md): Close a document session: writes a named history version when the content changed since the last one
- [sync.doc.compact](../capabilities/sync.doc.compact.md): Fold updates into a snapshot with the Markdown projection (every 500 updates or 10 minutes); E2E documents are compacted by the owner device
- [sync.doc.open](../capabilities/sync.doc.open.md): Open a Yjs document: snapshot, pending updates and state vector (checked with authorize view)
- [sync.doc.update](../capabilities/sync.doc.update.md): Append an accepted Yjs update from a person or agent actor (checked with authorize edit on every update)
- [sync.endpoints](../capabilities/sync.endpoints.md): Endpoints the server advertises for this Space (direct, relay, tunnel) for the client connection manager
- [sync.entities](../capabilities/sync.entities.md): Replica entities, schema versions and the window profile per device class (drives hello and the replica DDL)
- [sync.epoch.bump](../capabilities/sync.epoch.bump.md): Raise a person sync epoch (device revoked, person suspended or removed, password reset, clearance lowered, key rotation) so old replicas purge
- [sync.health](../capabilities/sync.health.md): Sync health: log head against the slowest live cursor, snapshot readers open, epoch counters
- [sync.hello](../capabilities/sync.hello.md): Handshake: cursor, epoch, registry hash and replica schema versions; answers live, update_required, resync or purge
- [sync.pull](../capabilities/sync.pull.md): Pull changes after a cursor, already permission and label filtered for this person and device class, with hide rows for rows that left view
- [sync.push](../capabilities/sync.push.md): Push outbox ops in order; each op runs through invoke as the person; concurrent field edits merge by the field policy
- [sync.snapshot.begin](../capabilities/sync.snapshot.begin.md): Start an initial sync or resync: pins a read snapshot at asOfSeq and returns the plan of entities and row estimates
- [sync.snapshot.page](../capabilities/sync.snapshot.page.md): One page of a snapshot (up to 5000 rows, scoped to the person, rows carry field hlc and seq); sent as gzip NDJSON on the wire
- [sync.status](../capabilities/sync.status.md): Sync state of this device: head, cursor, lag, epoch and the last full snapshot

## Events (6)

- [conflict.opened](../events/conflict.opened.md): Two edits to a protected or concurrent field collided and the op was parked for the assistant
- [doc.compacted](../events/doc.compacted.md): A document was compacted into a snapshot and Markdown projection
- [doc.updated](../events/doc.updated.md): A long text document received an accepted update (id and byte size only, never content)
- [sync.epoch_bumped](../events/sync.epoch_bumped.md): A sync epoch was raised; older replicas receive purge
- [sync.op_rejected](../events/sync.op_rejected.md): An op from a device was rejected (permission, label, lock or hold) and sits in that device Rejected list
- [sync.scope_changed](../events/sync.scope_changed.md): A grant or label change affected many rows; clients refetch the entity range
