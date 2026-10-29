# Auth worker handoff, stopped at owner’s usage-limit request

## Checkout and commits

- Checkout `/Users/irfad/Claude/Orgs/Vyre/v1-wt/rc1-auth068-completion`
- Branch `codex/rc1-multi-space-switch`, current HEAD `3c25f6d1`.
- Base before this lane: root `72dc0a998fbaccf8572e17acd30659970bb05ecf`.
- Ready commits, in order: `d1c38282` pending socket close/dial ownership; `7a938f3a` production multi-Space switch; `c605800a` advertised WebSocket origins; `e79a46e6` exact build/server SHA256hex registry encoding.
- **Unreviewed/unreleased WIP:** `3c25f6d1`. Keep separate from the ready commits. Root has already been sent all four ready commit IDs and is integrating them. Preserve root’s newer RecoveryAccount branch/imports in SessionGate when reconciling the narrow switch hunks.

## Ready work and evidence

- Two genuinely claimed Personal/Team daemons, real signed-in sessions, per-person+Space tabs, actual private Files and Graphite default.
- Desktop/phone switch restores each actual file tab. Server receives only its own bearer. Old in-document runtime sockets close. Revoking Team does not clear Personal; Back restores Personal. Add/join signs back into Team. Global Lock clears all sessions; URL cannot bypass.
- Full browser `/tmp/vyre-space-switch-full10.log`: 3/3 (two harness checks + full lifecycle), 24.97 seconds, production artifact `/tmp/vyre-multispace-web4`.
- Focused session/phone/Space 64/64 `/tmp/vyre-multispace-focused5.log`; connection count/endpoints/events 20/20 `/tmp/vyre-space-pending-green.log`; transport ownership1/1 `/tmp/vyre-space-transport-green2.log`; strict owned source0 `/tmp/vyre-multispace-semantic5.log`; lint0 `/tmp/vyre-multispace-lint2.log`.
- Actual endpoint HTTP hello and advertised real socket route: `/tmp/vyre-sync-endpoint-live2.log`3/3. Build/server exact hash now live, unknown hash resync: `/tmp/vyre-sync-buildhash-green.log`3/3. Wrong build hash red is preserved `/tmp/vyre-sync-buildhash-red.log`.
- Captures `/Users/irfad/Downloads/Vyre-v1-RC-screens/multi-space/team-restored-tabs.png`, `phone-team-restored.png`.
- Packaged-origin browser fixture grants Chrome `local-network-access` permission only for exact `https://tauri.localhost`. Its static files come from the actual export; real API/WS calls remain untouched. This is browser proof, not signed native IPC proof.
- Both new live tests are registered slow120ownerL9heavy. Root should add them to the explicit release browser evidence command if needed.

## WIP scope at stop

`3c25f6d1` changes only:
- `kernel/src/store/types.ts`: optional `typesSnapshot()` metadata port, normal async `types()` untouched.
- `kernel/src/store/records.ts`: implementation reads the same canonical typed schema projection as `types()`, synchronously.
- `sync/src/server/pull/catalog.ts`: `classifiedCatalog` overlays canonical `field.sensitivity`, never display label; explicit invalid classifications map Restricted; explicit field syncToLaptop:false maps Restricted; adds classificationStamp. Existing device ceiling2 still excludes Restricted independently of Owner clearance3.
- `modules/sync/impl.ts`: openSync wraps its catalog using the canonical metadata port; fails closed if that local port is absent. No cross-module raw SQL was added.
- `modules/sync/tests/classification.security.test.ts`: actual typed records, Owner/Guest access, Guest row filter and hidden field. Snapshot+pull Restricted/Confidential/hidden-field regression1/1green `/tmp/vyre-sync-classification-green1.log`; prior Restricted-to-Owner leak reproduced `/tmp/vyre-sync-classification-red.log`.
- Changelog explicitly marks WIP, not release approved.

**Not done:** broad regression/type check for WIP, classification/access narrowing cache invalidation, real replica purge/removal proof, live data privacy proof, lazy modern hub registration/daemon wiring, shutdown handling or actual modern WebSocket/UI acceptance. No modern hub code was started.

## Approved next steps and constraints

Parent approved the architecture plan in `modern-sync-boot-plan-2026-10-29.md`. User then requested stopping for handoff. The additive local metadata port was deemed reasonable but remains unreviewed/unreleased until actual sync tests prove it.

1. Add a deterministic classification/access-narrowing regression using an actual client replica. Existing field patch omission is not removal. Existing pull rescanChanged only revisits rows that become wholly visible/hidden; a still-visible row receives no upsert on rescan. Need reliable whole replacement semantics, or conservative existing purge/epoch/resnapshot mechanism before data return. Include schema changes, hidden-field narrowing and clearance changes. Existing row-revocation hide tests should retain their guarantees.
2. Keep Restricted off every device regardless of Owner clearance. Honor explicit syncToLaptop restriction. Snapshot, pull and live must use the same classifier and predicates.
3. Existing modern hub is `modules/sync/handlers/live.ts:createSyncLiveHub`, already scoped through pullChanges and epoch/revoke checks. Normal daemon only supplies `o.liveSync` test injection at daemon.ts~1064; no production default. Existing host/ws.ts adapter authenticates upgrade and calls sync.accept, and publish already calls sync.commit.
4. Add optional configureSync callback carrying a LAZY module hub factory. Register after declaring sync.changes; invoke only after all modules’ projections are declared. Build from the same live().deps, existing systemClock, exact registry hash/version. Register setLiveHub for purge and close on shutdown. No direct host import of module internals, no protocol rewrite, no permissive fallback.
5. Actual build hash must get modern hello_ok.ok.mode live; unknown hash resync; revoked device purge. Prove Owner/Guest row filters, hidden fields, schema-classification raise, snapshot/pull/live parity, actual committed UI update without polling, reconnect and old-socket close. Do not call the legacy Synced badge evidence of modern replication.

## Prior lane references

Auth, Comms4pages+pagination, Connectors/Connections, screenshot gates and CI fixture work were previously handed off/integrated. Reports remain in team/v1/reports. Durable automation belongs to Grok and remains outside this worker’s scope. Root owns recovery-code UI/backend work; do not overwrite it from this branch’s older SessionGate recovery content.
