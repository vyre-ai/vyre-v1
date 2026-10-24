# Lane L9f: Automations, Vault, Settings, Join

Brief for a Grok or Sonnet worker. Read this once at the start of the window, then run `trk brief <packet>` for each packet. Packets: 8 (600 min estimated). Tracker lane id: `L9f`.

## Goal
Automations, Vault, Settings and Join places: canvas and Journeys designer, runs, Vault layout and items, Settings pages, anonymous join screens.

## Spec sections
From your packets: 1, 2.1, 2.12, 2.13, 2.17, 2.24, 3.0, 3.7, 3.8, 3.9, 3.13.
Read these in `V1-SPEC.md` (spec numbers) and `ARCHITECTURE-V1.md` (b-numbers and ARCH sections) before your first packet. Lane table: ARCH 12.3.

## Files you may edit
- `apps/app/src/places/automations/`
- `apps/app/src/places/vault/`
- `apps/app/src/places/settings/`
- `apps/app/src/join/`

`node scripts/lanes-check.ts L9f origin/main` fails the push on any file outside this list. If the layout on main differs, comment the mapping on the packet and use the real paths. Never edit `changelog.md` (ruling 7).

## Frozen interfaces you build against
- `manifests/<module>.ts` and `generated/` (registry, types, client, stubs, validators, screens, probes.json). Read `generated/docs/lanes/<lane>.md` for your capability and event lists; never hand-edit `generated/`.
- `docs/frozen/{capabilities,events,kinds,record-types,agent-tools}.md` (hash-pinned; ruling 9).
- `packages/contracts`, `kernel/`, `manifest/`, `host/src/{invoke,gateway,loader,ws}.ts`, `sync/src/protocol.ts`, `testkit/src/api.ts`, `ui/src/*/props.ts`, `agent/src/driver.ts`: lead-only (see `scripts/lanes.json` `frozen`).
- Cross-lane calls go through generated stubs and the registry. Boundary B1: no lane imports another lane's code. A manifest change outside your lane is a `CONTRACT-CHANGE` request to the lead.

## Screens (generated registry, 31 in manifests today)
- automations: `automations.canvas`, `automations.config`, `automations.promote`, `automations.sidebar`, `journeys.designer`, `journeys.new`, `runs.chat`, `runs.failed`, `runs.history`
- vault: `vault.add`, `vault.export`, `vault.health`, `vault.import`, `vault.item`, `vault.layout`, `vault.providers`, `vault_requests.list`
- settings: `devices.mine`, `mail.connections`, `notifications.settings`, `settings.copy_profile`, `settings.kit`, `settings.kit-choice`, `settings.models-usage`, `settings.page`, `settings.search`, `spaces.settings_index`
- join: `join.accept`, `join.checklist`, `join.reset`, `join.sign-in`

## Packets, in dependency order (reuse_from = the 0.6 files you port)
- **P-L9f_01** (grok, 90 min) Automations Sidebar (Groups, Automations and Journeys tabs) and Canvas (triggers, Paths, Parallel, Wait, Loop, Approval, Stop)
  - spec: 3.7, 2.12; depends on: P-L9_02, P-L9_03; budgets: -
  - reuse_from: kernel/flows/{canvas.js,canvas.test.js}
  - port additions: vague reuse_from entries replaced with explicit 0.6 paths
- **P-L9f_02** (grok, 75 min) RunHistory, RunChat (one chat per run), FailedRuns
  - spec: 3.7, 2.13; depends on: P-L9f_01; budgets: -
  - reuse_from: none (write fresh)
- **P-L9f_03** (grok, 90 min) Automations Config (Settings, Alerts with escalation chain, Runs), JourneyDesigner, PromoteSheet
  - spec: 3.7, 2.12; depends on: P-L9f_01; budgets: -
  - reuse_from: none (write fresh)
- **P-L9f_04** (grok, 75 min) Vault place: Layout (Apple-Passwords style), ItemEnv (item as .env block), AddAnything (paste understanding)
  - spec: 3.8, 2.17; depends on: P-L9_02, P-L9_03; budgets: -
  - reuse_from: none (write fresh)
- **P-L9f_05** (grok, 75 min) Vault: Providers (top; logo, how connected, Mine/Shared, agents using it, usage), ShareSheet use, Health, Import
  - spec: 3.8, 2.17; depends on: P-L9f_04; budgets: -
  - reuse_from: none (write fresh)
- **P-L9f_06** (grok, 75 min) Settings place: Profile, Notifications, Models and usage, Connections, Memory and privacy, Sign-in and devices, Appearance, Keyboard, This computer, Spaces
  - spec: 3.9, 2.24; depends on: P-L9_02, P-L9_03, P-L9_01; budgets: -
  - reuse_from: none (write fresh)
- **P-L9f_07** (grok, 75 min) Join and setup pages: AcceptInvite, SignIn, ConnectAI, Checklist in native-pattern layout
  - spec: 3.13; depends on: P-L9_02, P-L9_01; budgets: -
  - reuse_from: none (write fresh)
- **P-L9f_08** (grok, 45 min) Personal Space behaviours across places: Needs a Team Space lines, hidden sections, owner points sweep (arrow-out marks, templates, helper chats)
  - spec: 2.1, 3.0, 1; depends on: P-L9b_02, P-L9e_06, P-L9f_06; budgets: -
  - reuse_from: none (write fresh)

Port map and gaps: `team/v1/prep/PORT-GAPS.md` (162 files assigned, 84 not needed). Rules for every port (ruling 11): only files in your packet's reuse_from; real types, no `@ts-nocheck`/`@ts-ignore` (ruling 2); test files become your own behaviour tests; header `// from vyre 0.6.9 <path>@<sha>`. Rename 0.6 vocabulary (Flows to Automations, Words per spec section 1).

## Traps
Join screens are anonymous callers (`KitScreenDef.caller`). Vault shows names, never values, except in explicit reveal flows. Settings rows follow grouped-list native patterns. No passkey UI (not in v1).

## Speed and CI budgets that apply
Binding for everyone (V1-SPEC Speed and smoothness): everything reads from the local copy; first paint <50 ms, complete <100 ms on tab/record/file/chat switch; 60 fps scroll through 10,000 rows (virtual lists, `ui/VirtualList`); no layout shift (reserved sizes, skeletons the size of final content); one persistent streaming connection per device; hover/focus prefetch via `prefetch(screenId,args)`. Each `KitScreenDef.perf` yields a probe in `generated/probes.json`; a packet that misses its budget is not done.

Your perf rows: `navigate`, `layout_shift`, `scroll` (long Vault and Settings lists)

## Golden flows you must satisfy
2 (join pages, accept, checklist); 7 (Gate approval); 9 (remove wizard entry points in Settings); 10 (key failure state).

Flows are `golden/*.ts` on `createTestSpace` with fake providers. A flow is `pending` while any module in its `needs` is `stub`; `scripts/golden-ready.ts` shows what still blocks it.

## Tests that must turn green
place screen tests for each assigned screen; join page tests.
Each packet's evidence must name the test files and show `ok` in the linked CI run (never run node or npm on the Mac; CI runs everything).

## First two hours
Hour 0 to 2: automations canvas, vault layout, settings rows, join pages (join pages are anonymous-caller screens: sign-in, reset, accept).

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
