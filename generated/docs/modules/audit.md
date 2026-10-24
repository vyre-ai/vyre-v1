# Audit (audit)

Lane L7a. Kind module. Status stub. Version 0.1.0.

Requires: nothing.

## Capabilities (10)

- [audit.append](../capabilities/audit.append.md): System: add an audit row for an act a module audits by hand
- [audit.archive](../capabilities/audit.archive.md): System: move audit rows older than the retention window into the encrypted archive file (called by the governance job)
- [audit.archives.list](../capabilities/audit.archives.list.md): Archived years of audit rows
- [audit.chain_health](../capabilities/audit.chain_health.md): Health probe: the newest checkpoint verifies and is recent
- [audit.checkpoint](../capabilities/audit.checkpoint.md): System: write a signed checkpoint of the hash chain
- [audit.checkpoints.list](../capabilities/audit.checkpoints.list.md): Signed checkpoints (every 1000 events or 10 minutes)
- [audit.export](../capabilities/audit.export.md): Export audit rows as CSV into a file
- [audit.get](../capabilities/audit.get.md): One audit row with its before and after
- [audit.list](../capabilities/audit.list.md): List audit rows with filters (Console Audit log)
- [audit.verify](../capabilities/audit.verify.md): Verify the hash chain and signed checkpoints over a range of events

## Events (4)

- [audit.archived](../events/audit.archived.md): Audit rows older than the retention window moved to an encrypted archive file (never edited)
- [audit.checkpointed](../events/audit.checkpointed.md): A signed checkpoint of the event hash chain was written
- [audit.exported](../events/audit.exported.md): The audit log was exported (the export is itself audited)
- [audit.verified](../events/audit.verified.md): The chain and checkpoints were verified
