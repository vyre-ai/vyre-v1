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
