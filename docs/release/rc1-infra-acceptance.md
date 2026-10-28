# Infrastructure completion increment

Base: f277e080. This increment owns Network, Speed and Usage. Existing Console components and server-pruned navigation remain the composition.

Network reads status, endpoints, public hostnames and servers through their normal capabilities. Domain, address mode, renewal and removal require a review step. Reconnect uses its existing capability and shows the host outcome. Compute enrollment has no consumer/connection-manager protocol in this repository; join-code creation is unavailable with an explicit explanation. A queued host command is described as requested; only observed status establishes the result. Gate-held actions retain their approval state. Speed uses server-reported budget units and direction, including lower-tail budgets, and opens retained worst traces only for callers with server.logs. Usage has independent period and person/agent/model grouping; it is not the Spend editor.

## Evidence

- Four new rendering and actual route-dispatch tests; seventeen focused Console tests pass with existing Infrastructure and AI route coverage.
- Real production browser: fresh claim, three routes, domain review and server validation, expiring join code, Speed window and Usage period/group changes. Three tests pass, no page errors. Captures: /tmp/vyre-infra-acceptance-shots.
- Export uses APFS-cloned dependencies with local @vyre/app and @vyre/ui workspace resolution. New Network marker is present in client JS, home includes external scripts.
- Focused semantic checks report no diagnostics in the new pages; existing shared UI Menu and States errors remain outside this increment.
- Host regression proves first successful domain apply updates observed network_config and a failed apply keeps the prior address. Fifteen command/probe tests pass.

## Managed driver increment

The daemon now uses the existing CaddyAdmin/CaddyRouter for own-domain ingress, targeting only its bound local gateway. A failed apply preserves the prior observed address. Relay switching requires an active endpoint for this Space. Renewal can only touch the current Space ingress and reports the actual certificate; it never overwrites another route’s authentication or upstream. The slow probe refreshes the current ingress certificate.

A new additive network.status commands array shows pending requests and bounded host outcomes. The host retains 100 sanitized outcomes and returns the latest 10. Raw driver errors stay in authorized server logs. Domain/mode changes and removal no longer mutate observed state before driver completion. Observed successful changes append their declared events with the original requester. Unsupported compute reconnect/disconnect fail; failed disconnect retains the server row.

Regression proof: 89 backend/module tests pass, including the final managed HTTP fixture proving domain apply, member denial, actual Caddy config writes, event, failure and restart persistence. The updated production browser passes three tests with actual failed reconnect readback and disabled enrollment guidance. Secrets scan reports 6,517 files with zero hits; boundaries report no new violations. Generated/frozen snapshots include network.status readback and console.speed unit/sense fields. Final combined evidence follows in the next checkpoint.

## Remaining action audit

Compute server enrollment, reconnect and disconnect still need a real server-manager protocol. The candidate exposes that limitation and does not generate an unusable join code in the Console. This is a named v1 blocker, not completed functionality. Actual public DNS/ACME production issuance was not attempted against operator infrastructure; the tests use deterministic DNS, Caddy protocol fixtures and a booted HTTP pipeline.

## Space address security increment

`spaces.switch_address` now requires server.network at manage level, matching the dedicated Network mutations. Its prior view-level requirement allowed an explicit view-only role to change the profile; the HTTP regression reproduced status 200 before the fix and requires 403 afterward. The host verifies DNS and applies the same managed network driver before the module persists the profile. Missing drivers fail explicitly. The profile reads the current host-observed address, including changes made from Network. Personal profiles keep their device-only address.

The actual HTTP fixture covers a server.network view role reading status, denial of its address mutation, failed DNS and failed Caddy application preserving the address, successful owner application, and restart persistence. The Space module and HTTP regressions pass 42 tests. Focused semantic checks find no new diagnostics in the touched seam, module, or daemon block; existing transitive kernel and UI diagnostics remain. Ingress-check copy states that it reports the server's current observation; the existing capability is not an outside-network probe.

## Restore preview selection safety

Opening another backup clears the previous destructive confirmation immediately. Only the latest preview response can become confirmable; a failure or cancellation leaves no backup selected. The confirmation names the selected backup’s timestamp, cannot run after its list entry disappears, and cannot be cancelled while its restore request is submitting.

Two forced-order model regressions and six existing Console rendering tests pass. Production browser creates two real local encrypted backups, delays one actual HTTP preview, selects the other, then releases the delayed response and verifies the selected confirmation remains unchanged. A subsequent denied preview removes the old confirmation. Three browser tests pass with zero page errors; the fixture never invokes restore. Evidence: /tmp/vyre-backup-preview-browser.log and /tmp/vyre-infra-backup-shots/console-backup-preview-failure.png.

## Reviewed update pinning and dry-run safety

The internal installer now receives the verified selected channel. The host passes that channel, exact version, reviewed artifact SHA-256 and the matching pinned feed base to `vyre-server`. Its POSIX parser validates those inputs before command work. The signed manifest must still verify with the compiled release key, match the channel/version, and match the reviewed artifact hash before tarball download. A healthy install updates the daily updater’s channel/feed; a failed install retains its previous selection. Existing signature validation remains mandatory.

`update --dry-run` now returns before unpack, image pulls or backups. Its prior control flow could continue after the unpack helper returned. Sourced CLI fixture tests cover that boundary, changed digest refusal, invalid/empty flags, and channel persistence on healthy success versus rollback. An actual HTTP beta update fixture verifies the precise installer arguments and observed version/history through the real module and gateway. It uses fake release/installer services; no production update ran. Final regression: 42 tests, 41 passed and one Docker-heavy deployment test explicitly skipped. Focused new source semantics and lint pass; boundaries have no violations.

## Server log paging and trace contents (after checkpoint)

Server now uses the existing opaque log cursors for older/newer/latest navigation. Searching clears prior page and trace selection; auto refresh pauses on older pages. Private export removes pagination fields and covers the entire selected filter. Trace detail includes its actual log rows as well as spans/events and has an explicit authenticated refresh.

The regression first failed against the prior production UI after uploading 120 actual metadata-key log entries through the authenticated capability. The updated own-source browser passes three tests: paging both directions, a private export containing records from both pages, and a trace containing rows outside the current page. No fixture free text bypasses log scrubbing. Focused rendering and new-source semantic checks pass; lint has zero findings. Evidence: /tmp/vyre-server-pagination-final-browser.log and /tmp/vyre-server-pagination-shots/console-server-paging-trace.png. This closes paging and trace-content gaps; it does not claim the full Server object/framework or visual review is complete.
