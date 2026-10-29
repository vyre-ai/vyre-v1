# Production modern live-sync boot: bounded integration plan

## Observed blockers

1. `host/src/daemon/daemon.ts:1056–1064` supplies modern `SyncHubPort` only when callers pass the optional `o.liveSync`. Normal main.ts boot never does. `host/src/ws.ts:192–198` therefore emits legacy top-level hello; the current `client/src/connection/frames.ts:27` accepts the existing modern `{t:'hello_ok',ok:{...}}` envelope only. No protocol rewrite is needed.
2. `host/src/daemon/daemon.ts:129` uses SHA256base64 for the raw registry bytes. `scripts/lib/registry-hash.mjs` exports SHA256hex; production BUILD_REGISTRY_HASH carries that hex value. Actual HTTP `/sync/v1/hello` with the production-build hash returns `resync`. Align daemon to the same lowercase hex of identical bytes, without compatibility aliases or relaxed hash checks.
3. Security prerequisite: `sync/src/server/pull/catalog.ts:38–42,85–88` gives Space-defined types an empty `fieldLabels` map. `sync/src/server/pull/scope.ts:105–115` redacts only compiled hiddenFields and catalog field labels. Canonical Schema sensitivity lives on typed field `sensitivity` (`modules/schema/projections.ts:155`; current HTTP helper `host/src/daemon/record-sensitivity.ts`). Sync must use the same canonical classification before enabling data-bearing modern WebSockets. Snapshot and pull use the same Viewer, so fix their common boundary too. Invalid explicit classifications must fail closed. Check schema-edit invalidation and rescan/hide of previously shared values.

## Existing implementation to reuse

- `modules/sync/handlers/live.ts:33–62`: createSyncLiveHub already uses pullChanges, device epoch/revocation, registry checks and existing modern live hub.
- `modules/sync/impl.ts:96–118`: same shared SyncHandle, lazily opened typed Space store, Access ScopeCache; setLiveHub wires purge.
- `host/src/ws.ts:222–231`: authenticated upgrade passes actual person/device/deviceClass into SyncHubPort. Preserve this boundary. `publish:264` already calls modern hub.commit and excludes modern sessions from legacy raw-event fanout.
- `sync/src/server/pull/scope.ts`: existing predicate, private-owner, row label, device ceiling, hidden-field checks. Extend canonical classification, preserve those checks.

## Minimal reviewed implementation sequence

1. Fix exact build/server registry encoding, prove actual production-build hash gets HTTP live; wrong hash stays resync.
2. Add optional configureSync seam callback returning a **lazy hub factory**, not eagerly opening the Space store. Module registers factory after declaring sync.changes; daemon invokes only after all module setters have registered projections. Factory creates createSyncLiveHub from the same live().deps, existing systemClock and server registry/version; registers setLiveHub for purge. Close hub at shutdown and on module reconfiguration.
3. Add common typed-schema classification overlay at Sync Catalog/Viewer boundary, keyed to canonical definitions and refreshed on schema changes. Ensure unsupported/invalid classification cannot lower the ceiling. Preserve actual person predicates/row scopes and explicit hidden fields for pull/snapshot/live.
4. Wire factory output as normal daemon SyncHubPort. Keep test injection only as an explicit override; never substitute permissive fallback if a configured factory fails.

## Required acceptance

- Real production BUILD hash, actual claimed signed-in device: modern hello_ok.ok.mode live; unknown hash resync; revoked device refuses/purges.
- Two actual people: visible row arrives live, forbidden row never arrives; conditionally hidden and canonical Confidential/Restricted fields never appear for low-clearance actor/device; snapshot and pull match.
- Schema classification raised while connected: no newly forbidden values in later snapshots/pull/live; previously visible fields removed or resnapshot required truthfully.
- Real committed update reaches UI with polling held off; reconnect cursor replay and switch closes old sockets; no legacy raw event fanout for modern session.
- Keep native packaged acceptance distinct from browser permission fixture.
