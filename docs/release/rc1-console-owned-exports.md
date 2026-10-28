# Console infrastructure and private administrative exports

The Server, Diagnostics and Support pages use live capabilities. Log exports and support bundles now have actual encrypted content rather than an ID without a downloadable file. Service restart feedback says requested; the health service remains the authority for observed state.

## Authorization and retention

Only the daemon wrappers for `logs.export`, `health.support_bundle` and `audit.export` receive an export port. They accept handler-generated structured metadata (or the audit handler's fixed CSV format), with no destination, target principal or arbitrary file-write port. The daemon captures principal kind and ID, trace and acting-for person. Effective requester ownership includes both kind and ID; actor and on-behalf-of attribution remain separate.

The handler still passes normal capability authorization. A private file resource is registered through `resource.created`; normal `files.get`/`files.read` resource authorization still runs before the host wrapper resolves the artifact. The wrapper additionally requires the exact effective requester and their current source permission (`server.logs` or `audit.read`). Even another Owner cannot read it. The encrypted blob has no public resource binding. Browser downloads use authenticated `files.read` base64 and a revocable browser Blob URL.

Exports are scrubbed recursively with the existing credential sanitizer and content-key exclusions, capped at 8 MiB, and expire after 24 hours. Cleanup runs at boot, every minute, before saves and before reads. It removes encrypted bytes, private artifact metadata and the corresponding log/support cache copy. Audit resource metadata remains; artifact content does not. Expiration does not recall copies that a requester already downloaded.

## Evidence and limits

Booted HTTP tests exercise a role with only server.logs and Space view, no Files write: export, normal file metadata, base64/text/URL reads, cross-person denial, missing permission, no port on unrelated capabilities, and unchanged ordinary Files create denial. Unit tests cover same ID with a different principal kind, acting-for ownership, scrubbing, bounds and expiration cleanup. Console Chromium tests perform owner claim, standalone Console navigation, filtered log export, actual browser download, health checks, support export and JSON content verification.

The browser run exposed a shutdown race: late callbacks scheduled a LogSink flush after its database closed. Close now drains every accepted row/span once, and late append/flush/repeated close calls are harmless. A persistent-database regression verifies both accepted records survive and late records do not enter storage.

Remaining infrastructure scope for the next slice: Updates, full Backups configuration/actions and Space profile. Storage currently exposes real machine, disk and encryption probes; no contract exists for volume management. No real update, restore or service restart is performed by these browser tests. Initial production /claim and /console hydration can report React #418 before any infrastructure page mounts; action/download assertions complete, but that error must be resolved by shared SSR integration before claiming a clean release browser pass.
