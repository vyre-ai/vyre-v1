# Lane L7b: Server and Console

Brief for a Grok or Sonnet worker. Read this once at the start of the window, then run `trk brief <packet>` for each packet. Packets: 15 (1080 min estimated). Tracker lane id: `L7b`.

## Goal
The server and the Console: daemon pieces of `host/src` outside the frozen files, `vyred` image, backup, updates, network, health, logs, reports client, Console views and assistant, and all 54 Console screens.

## Spec sections
From your packets: native, speed, 2.1, 2.2, 2.3, 2.18, 2.20, 2.26, 3.10, 3.13, 4.18, 5, 5 b9, 5 networking, 5 b13, 5 b12.
Read these in `V1-SPEC.md` (spec numbers) and `ARCHITECTURE-V1.md` (b-numbers and ARCH sections) before your first packet. Lane table: ARCH 12.3.

## Files you may edit
- `apps/console/`
- `host/src/`
- `images/vyred/`
- `modules/backup/`
- `modules/updates/`
- `modules/network/`
- `modules/health/`
- `modules/logs/`
- `modules/reports-client/`
- `modules/console-views/`
- `modules/console-assistant/`
- plus `manifests/<module>.ts` and `modules/<module>/` for: `backup`, `updates`, `network`, `health`, `logs`, `reports-client`, `console-views`, `console-assistant`
- NOT yours (frozen or another lane): `host/src/invoke.ts`, `host/src/gateway.ts`, `host/src/loader.ts`, `host/src/ws.ts`

`node scripts/lanes-check.ts L7b origin/main` fails the push on any file outside this list. If the layout on main differs, comment the mapping on the packet and use the real paths. Never edit `changelog.md` (ruling 7).

## Frozen interfaces you build against
- `manifests/<module>.ts` and `generated/` (registry, types, client, stubs, validators, screens, probes.json). Read `generated/docs/lanes/<lane>.md` for your capability and event lists; never hand-edit `generated/`.
- `docs/frozen/{capabilities,events,kinds,record-types,agent-tools}.md` (hash-pinned; ruling 9).
- `packages/contracts`, `kernel/`, `manifest/`, `host/src/{invoke,gateway,loader,ws}.ts`, `sync/src/protocol.ts`, `testkit/src/api.ts`, `ui/src/*/props.ts`, `agent/src/driver.ts`: lead-only (see `scripts/lanes.json` `frozen`).
- Cross-lane calls go through generated stubs and the registry. Boundary B1: no lane imports another lane's code. A manifest change outside your lane is a `CONTRACT-CHANGE` request to the lead.

Your modules (`generated/docs/lanes/L7b.md` lists every capability and event; counts here):
- `backup`: 10 capabilities, 5 events; contract tests `generated/tests/backup/`
- `updates`: 8 capabilities, 4 events; contract tests `generated/tests/updates/`
- `network`: 12 capabilities, 5 events; contract tests `generated/tests/network/`
- `health`: 16 capabilities, 5 events; contract tests `generated/tests/health/`
- `logs`: 10 capabilities, 4 events; contract tests `generated/tests/logs/`
- `reports-client`: 9 capabilities, 3 events; contract tests `generated/tests/reports-client/`
- `console-views`: 6 capabilities, 0 events; contract tests `generated/tests/console-views/`
- `console-assistant`: 7 capabilities, 3 events; contract tests `generated/tests/console-assistant/`
Module `status` stays `stub` until its contract tests pass against real handlers; flipping to `live` is your commit (ARCH 12.4).

## Console screens (54 in manifests today, place `console`, app `apps/console`)
`access.checker`, `access.grants`, `access.groups`, `access.people`, `access.policies`, `access.reviews`, `access.roles`, `audit.entry`, `audit.integrity`, `audit.log`, `console.agent-computers`, `console.agent-template`, `console.agents-register`, `console.ai-incidents`, `console.ai-models`, `console.ai-review`, `console.ai-spend`, `console.backups`, `console.connector-build`, `console.diagnostics`, `console.integrations`, `console.labels`, `console.logging`, `console.mcp-sessions`, `console.network`, `console.outside-actors`, `console.overview`, `console.schema`, `console.server-logs`, `console.server-updates`, `console.sources`, `console.speed`, `console.support-bundle`, `console.usage`, `contacts.suppression`, `devices.sessions`, `events.deliveries`, `events.webhooks`, `gate.rules`, `github.setup`, `google.setup`, `governance.erase`, `governance.holds`, `governance.retention`, `mail.domains`, `mail.shared-inboxes`, `members.invite_sheet`, `members.remove_wizard`, `members.sign_in_policy`, `microsoft.setup`, `spaces.console`, `telephony.numbers`, `telephony.registration`, `vault.policy`

## Packets, in dependency order (reuse_from = the 0.6 files you port)
- **P-L7b_01** (grok, 75 min) logs: sink to logs.db, search by person/agent/place/record/run/trace, trace view, retention
  - spec: 4.18, 5 b9; depends on: P-PR_G0; budgets: -
  - reuse_from: none (write fresh)
- **P-L7b_02** (grok, 60 min) health module: manifest check runner, doctor results, services restart
  - spec: 4.18; depends on: P-PR_G0; budgets: -
  - reuse_from: none (write fresh)
- **P-L7b_03** (sonnet, 90 min) host daemon: supervisor, scheduler, CLI table and hand commands, platform glue
  - spec: 5 b12, 4.18; depends on: P-PR_G0; budgets: -
  - reuse_from: core/daemon, core/cli (clean heavily), core/config/{claude-home.test.js,config.test.js,index.js}
  - port additions: 3 files from the 246-file port gap: core/config/{claude-home.test.js,config.test.js,index.js}
- **P-L7b_04** (grok, 60 min) host caddy admin API driver, disk encryption check, device role
  - spec: 3.13, 2.20; depends on: P-PR_G0; budgets: -
  - reuse_from: core/publish (caddy parts)
- **P-L7b_05** (grok, 75 min) backup: encrypted to S3 or drive, restore with tombstones, export zip without secrets
  - spec: 2.1, 2.26, 5; depends on: P-PR_G0; budgets: -
  - reuse_from: kernel/storage/{backends.js,indexbackup.js,keys.js}
  - port additions: vague reuse_from entries replaced with explicit 0.6 paths
- **P-L7b_06** (grok, 60 min) updates: channels, backup first, roll back, signed manifest verification, app-version window
  - spec: 5 b13, 3.10; depends on: P-PR_G0; budgets: -
  - reuse_from: core/update, updates/
- **P-L7b_07** (grok, 60 min) network: domain, certificate state, relay status, servers list with health, Reconnect and Remove
  - spec: 5 networking, 3.10; depends on: P-PR_G0; budgets: -
  - reuse_from: core/relay, core/network, core/link
- **P-L7b_08** (grok, 75 min) reports-client: reports.submit, offline queue, redaction by label, resolved webhook, replay sandbox capability
  - spec: 4.18, 5 b9; depends on: P-PR_G0; budgets: -
  - reuse_from: none (write fresh)
- **P-L7b_09** (grok, 60 min) console-views: overview aggregates and console.speed (spans rolled up per budget id)
  - spec: 3.10, speed; depends on: P-PR_G0; budgets: console_speed
  - reuse_from: none (write fresh)
- **P-L7b_10** (grok, 75 min) console-assistant (Cmd-J): console thread kind, Engineer MCP toolset, diff_card apply on behalf of
  - spec: 3.10, native; depends on: P-PR_G0; budgets: -
  - reuse_from: none (write fresh)
- **P-L7b_11** (grok, 75 min) apps/console shell: top bar, five nav groups, ObjectPage usage, Overview and Audit pages
  - spec: 3.10; depends on: P-PR_G0; budgets: -
  - reuse_from: none (write fresh)
- **P-L7b_12** (grok, 90 min) Console pages: Access (People, Groups, Roles matrix, Grants, Policies, Access checker, Reviews, Sessions) and Agents and actors
  - spec: 3.10, 2.3, 2.2; depends on: P-L7b_11; budgets: -
  - reuse_from: none (write fresh)
- **P-L7b_13** (grok, 90 min) Console pages: Data (schema, labels, retention, holds, erase, backup), AI (policies, gate rules, spend), Comms, Integrations
  - spec: 3.10, 2.26, 2.18; depends on: P-L7b_11; budgets: -
  - reuse_from: none (write fresh)
- **P-L7b_14** (grok, 90 min) Console pages: Infrastructure (Speed, logs live tail and trace view, network, updates, diagnostics, services, support bundle) and Space settings
  - spec: 3.10, speed, 4.18; depends on: P-L7b_11; budgets: console_speed
  - reuse_from: none (write fresh)
- **P-L7b_15** (grok, 45 min) images/vyred Dockerfile and compose units for server and device roles
  - spec: 3.13, 5 b12; depends on: P-L7b_03; budgets: -
  - reuse_from: box/

Port map and gaps: `team/v1/prep/PORT-GAPS.md` (162 files assigned, 84 not needed). Rules for every port (ruling 11): only files in your packet's reuse_from; real types, no `@ts-nocheck`/`@ts-ignore` (ruling 2); test files become your own behaviour tests; header `// from vyre 0.6.9 <path>@<sha>`. Rename 0.6 vocabulary (Flows to Automations, Words per spec section 1).

## Traps
You own `host/src/` except `invoke.ts`, `gateway.ts`, `loader.ts`, `ws.ts` (frozen, lead only). `host/modules.json` is frozen. Console screens carry `needs` permissions; Server shell needs `server.services`.

## Speed and CI budgets that apply
Binding for everyone (V1-SPEC Speed and smoothness): everything reads from the local copy; first paint <50 ms, complete <100 ms on tab/record/file/chat switch; 60 fps scroll through 10,000 rows (virtual lists, `ui/VirtualList`); no layout shift (reserved sizes, skeletons the size of final content); one persistent streaming connection per device; hover/focus prefetch via `prefetch(screenId,args)`. Each `KitScreenDef.perf` yields a probe in `generated/probes.json`; a packet that misses its budget is not done.

Your perf rows: `console.speed` rows (six: streaming 60 fps, layout shift, prefetch, one connection, no mixed data, console timing), `navigate` for Console pages

## Golden flows you must satisfy
11 backup restore with tombstones (restore side); Console screen tests, doctor and disk-check tests, health tests.

Flows are `golden/*.ts` on `createTestSpace` with fake providers. A flow is `pending` while any module in its `needs` is `stub`; `scripts/golden-ready.ts` shows what still blocks it.

## Tests that must turn green
doctor and disk-check tests; health tests; Console screen tests; contract tests for backup, updates, network, health, logs, reports-client, console-views, console-assistant.
Each packet's evidence must name the test files and show `ok` in the linked CI run (never run node or npm on the Mac; CI runs everything).

## First two hours
Hour 0 to 2: logs sink and trace view, health runner, Console shell. Console screens are listed below; the 54 Console screens are yours with `apps/console`.

## Rulings 1 to 12 (`trk show decisions` on the tracker)
1. Sync protocol and device-store changes from the sync spike are adopted (ARCH 5.3, 5.4, 5.10): seen_rows per device, Op.after link, bulk multi-row apply with hide-seq guard, replica engine sqlite-wasm-cipher 2.2.4 (wa-sqlite 1.0.0 fallback).
2. No `@ts-nocheck` and no `@ts-ignore` anywhere. Ported 0.6 code gets real types when ported. Reviews reject it.
3. Real-phone sideload and Gradle work is P-PR_47b and does not gate G0. Web encrypted OPFS is proven in a real browser on a runner.
4. Tauri desktop builds run on GitHub-hosted macos-latest and windows-latest (desktop jobs only). Everything else runs on our Linux runners.
5. On web the encrypted OPFS store costs about 28 ms per commit, so local writes batch (one transaction per frame, about 16 ms) and the UI updates optimistically from memory. The local-edit budget (under 10 ms) is measured to the in-memory apply.
6. A packet stuck in_progress with no live worker for 15 minutes is reset to ready by the lead and re-dispatched on its branch.
7. Packets never edit `changelog.md`. The lead generates it from approved packet titles and merged PRs.
8. Every capability an agent may use is a tool, but only the frozen default set (about 60 tools) loads into every turn. The rest load on demand through built-in tool search, scoped to the asker's access. Keep `agentTool` on every eligible capability.
9. The contract is frozen (1,486 capabilities, 598 events, record types, kinds, agent tools). A change needs a lead ruling and a re-record of the frozen hashes in the same PR. Tests live under `packages/contracts/tests`.
10. Grok prep success is about half. Failed Grok packets go to Sonnet finishers starting from the Grok branch `packet/<id>`. UI batch screen tests may live under `ui/src/__screens__/**`.
11. No bulk import of 0.6 code. Each build packet ports exactly the files in its `reuse_from` list, with real types, inside its own owned files. Copied files carry the header `// from vyre 0.6.9 <path>@<sha>`.
12. The 5 min push budget measures execution from the first job start. Queue wait is reported separately and alerts at 2 min. Temporary runner hosts exist for the window.

## Done means
Every checklist item has its own evidence; named tests show `ok` in the CI run; perf items give the number against the budget; required proofs attached; open a PR on `packet/<id>` and squash-merge once green and approved. Blocked or outside your files: `trk block <id> "why"`, do not improvise.
