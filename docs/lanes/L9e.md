# Lane L9e: Files and Apps

Brief for a Grok or Sonnet worker. Read this once at the start of the window, then run `trk brief <packet>` for each packet. Packets: 9 (675 min estimated). Tracker lane id: `L9e`.

## Goal
Files and Apps places: tree, viewer, diff, history, mounts, memory graph; Sites, Forms, Campaigns, Templates, Kit builder, email builder, booking pages.

## Spec sections
From your packets: 2.4, 2.11, 2.14, 2.15, 2.16, 2.19, 2.20, 2.21, 3.5, 3.6, 4.15.
Read these in `V1-SPEC.md` (spec numbers) and `ARCHITECTURE-V1.md` (b-numbers and ARCH sections) before your first packet. Lane table: ARCH 12.3.

## Files you may edit
- `apps/app/src/places/files/`
- `apps/app/src/places/apps/`

`node scripts/lanes-check.ts L9e origin/main` fails the push on any file outside this list. If the layout on main differs, comment the mapping on the packet and use the real paths. Never edit `changelog.md` (ruling 7).

## Frozen interfaces you build against
- `manifests/<module>.ts` and `generated/` (registry, types, client, stubs, validators, screens, probes.json). Read `generated/docs/lanes/<lane>.md` for your capability and event lists; never hand-edit `generated/`.
- `docs/frozen/{capabilities,events,kinds,record-types,agent-tools}.md` (hash-pinned; ruling 9).
- `packages/contracts`, `kernel/`, `manifest/`, `host/src/{invoke,gateway,loader,ws}.ts`, `sync/src/protocol.ts`, `testkit/src/api.ts`, `ui/src/*/props.ts`, `agent/src/driver.ts`: lead-only (see `scripts/lanes.json` `frozen`).
- Cross-lane calls go through generated stubs and the registry. Boundary B1: no lane imports another lane's code. A manifest change outside your lane is a `CONTRACT-CHANGE` request to the lead.

## Screens (generated registry, 27 in manifests today)
- files: `files.changeset-header`, `files.commit-diff`, `files.diff`, `files.fill-sheet`, `files.git-row`, `files.history`, `files.lint-bar`, `files.list`, `files.memory-graph`, `files.memory-proposed`, `files.mount-sheet`, `files.runbook-viewer`, `files.sync-line`, `files.thumbnails`, `files.trash`, `files.tree`, `files.viewer`
- apps: `apps.campaign-builder`, `apps.campaigns`, `apps.form-settings`, `apps.forms`, `apps.kit-builder`, `apps.sending-domains`, `apps.site-editor`, `apps.site-settings`, `apps.sites`, `apps.templates`

## Coverage-audit screens assigned to you (add to your packet's manifests; source: MANIFEST-COVERAGE.md)
- P-L9e_07: add screen apps.email-builder (blocks, HTML, plain text, focus mode, preview, checks, Ask; email_builder.* plus new email_builder.snippets.* from P-PR_33b).
- P-L9e_08: add screen apps.booking-pages (list and settings; bookings.* capabilities exist).

## Packets, in dependency order (reuse_from = the 0.6 files you port)
- **P-L9e_01** (grok, 90 min) Files Tree (Recent, Shared with me, Trash, Knowledge) and List (Finder-grade select, drag, spring-load, Quick Look)
  - spec: 3.5, 2.4; depends on: P-L9_02, P-L9_06; budgets: scroll
  - reuse_from: none (write fresh)
- **P-L9e_02** (grok, 60 min) Files Viewer wiring and markup (Draw, Comment pins, plans and documents inline edit)
  - spec: 3.5, 2.16; depends on: P-L9e_01, P-L9_10; budgets: -
  - reuse_from: none (write fresh)
- **P-L9e_03** (grok, 90 min) Files review surfaces: DiffTab wiring, ChangesetHeader, GitRow, GateRow, History, LintBar
  - spec: 3.5, 2.16, 2.14; depends on: P-L9e_01, P-L9_07; budgets: -
  - reuse_from: none (write fresh)
- **P-L9e_04** (grok, 60 min) MountSheet and RunbookViewer (Run buttons, Runs on bar, Run all)
  - spec: 3.5, 2.16; depends on: P-L9e_01; budgets: -
  - reuse_from: none (write fresh)
- **P-L9e_05** (grok, 60 min) Knowledge: MemoryGraph (sigma WebGL) and MemoryProposed (Accept and Reject)
  - spec: 3.5, 2.15, 4.15; depends on: P-L9e_01; budgets: -
  - reuse_from: none (write fresh)
- **P-L9e_06** (grok, 90 min) Apps: Sites list, Previews, deployment cards, SiteEditor (Build, Code, Preview, Ask Vyre pane), SiteSettings (Domains, Env, Access)
  - spec: 3.6, 2.20; depends on: P-L9_03, P-L9_07; budgets: -
  - reuse_from: none (write fresh)
- **P-L9e_07** (grok, 60 min) Apps: Templates gallery, KitBuilder (agent-driven with preview), settings Kit chooser
  - spec: 3.6, 2.21; depends on: P-L9e_06; budgets: -
  - reuse_from: none (write fresh)
- **P-L9e_08** (grok, 75 min, tier 2) Apps: Forms list with settings pane and builder (tier 2)
  - spec: 3.6, 2.11; depends on: P-L9e_06; budgets: -
  - reuse_from: none (write fresh)
- **P-L9e_09** (grok, 90 min, tier 2) Apps: Campaigns, CampaignBuilder, SendingDomains (tier 2)
  - spec: 3.6, 2.19; depends on: P-L9e_06, P-L9_09; budgets: -
  - reuse_from: none (write fresh)

Port map and gaps: `team/v1/prep/PORT-GAPS.md` (162 files assigned, 84 not needed). Rules for every port (ruling 11): only files in your packet's reuse_from; real types, no `@ts-nocheck`/`@ts-ignore` (ruling 2); test files become your own behaviour tests; header `// from vyre 0.6.9 <path>@<sha>`. Rename 0.6 vocabulary (Flows to Automations, Words per spec section 1).

## Traps
Reuse `ui/FolderTree`, `ui/Viewer`, `ui/DiffTab`, `ui/HistoryTab`, `ui/EmailBuilder`. Viewer first paint <50 ms. No decorative gradients or splits (native patterns).

## Speed and CI budgets that apply
Binding for everyone (V1-SPEC Speed and smoothness): everything reads from the local copy; first paint <50 ms, complete <100 ms on tab/record/file/chat switch; 60 fps scroll through 10,000 rows (virtual lists, `ui/VirtualList`); no layout shift (reserved sizes, skeletons the size of final content); one persistent streaming connection per device; hover/focus prefetch via `prefetch(screenId,args)`. Each `KitScreenDef.perf` yields a probe in `generated/probes.json`; a packet that misses its budget is not done.

Your perf rows: `scroll` (10,000 files), `navigate` (viewer first paint <50 ms), `layout_shift`

## Golden flows you must satisfy
3 (diff tab, changeset header); 6 (deploy card, preview links).

Flows are `golden/*.ts` on `createTestSpace` with fake providers. A flow is `pending` while any module in its `needs` is `stub`; `scripts/golden-ready.ts` shows what still blocks it.

## Tests that must turn green
place screen tests for each assigned screen.
Each packet's evidence must name the test files and show `ok` in the linked CI run (never run node or npm on the Mac; CI runs everything).

## First two hours
Hour 0 to 2: files tree, list, viewer over fake data.

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
