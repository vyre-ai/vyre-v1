# Export audit (P-SEC_07)

Found in P-CC_35: `records.export` wrote every row of a view into the file. The read filter runs on a handler's output; it cannot reach the contents of a file the handler builds. So a capability that packs several items into a file, blob, archive or attachment must decide per item, inside the handler.

## Rule

- An item goes into the file only when `ctx.authorize({ perm: null, level: "view" }, { type, id })` answers `allow` for that item.
- No `ctx.authorize` in the context: refuse the whole call (fail closed). Never fall back to "no check".
- `hold` is a deny. `deny` leaves the item out and counts it in a `skipped` number the caller sees; it never names the item.
- Each capability that packs gets one test with a restricted item that proves it is absent from the file.

## Capabilities that pack several items (fixed in this packet)

| Capability | Today | Change | Files to change |
|---|---|---|---|
| records.export | fixed fail-closed by the steward in P-CC_35 (PR 454): per-row authorize at view level, refused without ctx.authorize | none here | (P-CC_35) |
| files.copy | pipeline authorizes the destination folder only; the source file is copied without a view check on it | authorize view on the source file before copying; fail closed | modules/files/handlers/tree.ts, modules/files/tests/copy.restricted.test.ts |
| backup.export_start | authorize runs only `if (ctx.authorize)` (fails open); any holder of the backups permission could take every item | not filtered (a partial backup is its own harm): refused unless the caller is the Space owner (`SpaceSource.owner()`), the permission allows, and ctx.authorize exists; every refusal is permission.no_grant | modules/backup/handlers/run.ts, modules/backup/fixtures/world.ts, modules/backup/tests/restore.test.ts, modules/backup/tests/export.restricted.test.ts |
| audit.export | audit.read permission; rows that name a resource are written without a check on that resource | per-row authorize view on the row's resource when it has one; fail closed | modules/audit/handlers/log.ts, modules/audit/tests/export.restricted.test.ts |

## Capabilities that pack several items (already safe, test to add where missing)

| Capability | Why it is safe | Test |
|---|---|---|
| memory.graph_export | `build(..., forViewer: true)` authorizes view on every node's resource (graph.ts) | modules/memory/tests/graph.export.restricted.test.ts if none names a restricted node |
| mail.attachment.save | `Viewer.door(row)` refuses a message the person cannot see before any attachment is read | existing refusal tests; add one for a restricted message if missing |
| esign.send | pipeline authorizes `use` on the file, then `files.read` through the capability API (checked again) | existing |
| documents.fill / preview_fill | template read through `files.read`; `mayView` is checked first; the values come from the caller | existing |
| zoom.recordings.download, twilio.recording.download, google/ms drive and attachment downloads | one item, authorized by the pipeline on its resource, token of the caller's own account | none |

## Packs data, but not per-item content (permission-gated, no change)

| Capability | Gate | Note |
|---|---|---|
| logs.export | `server.logs` view | log lines are not items with owners; no per-item grant exists to check |
| health.support_bundle | `server.logs` edit | same |
| engine.use_policy.export | `policy.manage` manage | policy rows only |
| connectors.export | `connectors.manage` on the connector | one connector, secrets excluded by the connector module |
| agents.snapshot.take | agent edit | stores file version ids, not file contents |
| sync.snapshot.begin / page | view on the Space; the sync filter labels each row per device | rows are labelled by the log, outside this audit |

## Not built yet (add the rule when the handler lands)

vault.export_env, vault.items.export_mine, vault.exports.*: stubs. When they are built, every item needs `use` (export_env) or `view` (export_mine) from ctx.authorize and a refusal without it. spaces.export is a stub ("later packet"): same rule for every resource it packs.

## Handler files to add to owns_files

modules/files/handlers/tree.ts, modules/files/tests/copy.restricted.test.ts
modules/backup/handlers/run.ts, modules/backup/tests/export.restricted.test.ts
modules/audit/handlers/log.ts, modules/audit/tests/export.restricted.test.ts
modules/memory/tests/graph.export.restricted.test.ts

Done in this packet: files.copy (tree.ts), backup.export_start (run.ts), audit.export (log.ts, projections.ts; log.test.ts passes an allow-all authorize), memory.graph_export test. Each has a restricted-item test and a no-authorize refusal test.
