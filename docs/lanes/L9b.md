# Lane L9b: Home and Chats

Brief for a Grok or Sonnet worker. Read this once at the start of the window, then run `trk brief <packet>` for each packet. Packets: 8 (540 min estimated). Tracker lane id: `L9b`.

## Goal
Home and Chats places: Home (Today, Starred, Needs you, checklist, away digest) and Chats (conversation, channels, agents, computers, terminals).

## Spec sections
From your packets: 2.1, 2.5, 2.6, 2.7, 2.8, 2.23, 3.1, 3.2, 4.2, 4.13.
Read these in `V1-SPEC.md` (spec numbers) and `ARCHITECTURE-V1.md` (b-numbers and ARCH sections) before your first packet. Lane table: ARCH 12.3.

## Files you may edit
- `apps/app/src/places/home/`
- `apps/app/src/places/chats/`

`node scripts/lanes-check.ts L9b origin/main` fails the push on any file outside this list. If the layout on main differs, comment the mapping on the packet and use the real paths. Never edit `changelog.md` (ruling 7).

## Frozen interfaces you build against
- `manifests/<module>.ts` and `generated/` (registry, types, client, stubs, validators, screens, probes.json). Read `generated/docs/lanes/<lane>.md` for your capability and event lists; never hand-edit `generated/`.
- `docs/frozen/{capabilities,events,kinds,record-types,agent-tools}.md` (hash-pinned; ruling 9).
- `packages/contracts`, `kernel/`, `manifest/`, `host/src/{invoke,gateway,loader,ws}.ts`, `sync/src/protocol.ts`, `testkit/src/api.ts`, `ui/src/*/props.ts`, `agent/src/driver.ts`: lead-only (see `scripts/lanes.json` `frozen`).
- Cross-lane calls go through generated stubs and the registry. Boundary B1: no lane imports another lane's code. A manifest change outside your lane is a `CONTRACT-CHANGE` request to the lead.

## Screens (generated registry, 25 in manifests today)
- home: `default.home-welcome`, `home.away-digest`, `home.checklist`, `home.needs-you-top3`, `home.projects-at-risk`, `home.routines-today`, `runs.my-runs`, `spaces.onboarding`, `tasks.my-work`, `tasks.page`
- chats: `chats.agent-computer`, `chats.agent-memory`, `chats.agent-page`, `chats.all-agents`, `chats.computer-popup`, `chats.connect-outside-agent`, `chats.conversation`, `chats.helper-chat`, `chats.recording-sheet`, `chats.right-pane`, `chats.sidebar`, `chats.terminal-list`, `chats.terminal-rules`, `chats.terminal-tab`, `tasks.needs-you`

## Coverage-audit screens assigned to you (add to your packet's manifests; source: MANIFEST-COVERAGE.md)
- P-L9b_02: add screen home.today-starred-ask (Today calendar day, Starred incl. live terminals, Ask box).
- P-L9b_07: add screens chats.channel-details (members, watching agents, privacy; capabilities channels.get, channels.stream_prefs.*) and chats.plan (editable plan document with tracked-change suggestions; chat.plan.*). channels.stream (collapsed run rows, People/Agents/Runs filter) was added by P-PR_33b for the conversation screen.

## Packets, in dependency order (reuse_from = the 0.6 files you port)
- **P-L9b_01** (grok, 75 min) Home place: NeedsYouTop3, MyWork, ProjectsAtRisk, AwayDigest, RoutinesToday
  - spec: 3.1, 2.8, 4.2; depends on: P-L9_02, P-L9_03; budgets: -
  - reuse_from: none (write fresh)
- **P-L9b_02** (grok, 60 min) Home place: Today, Starred (live terminal status), Checklist, AskBox, Personal Space variant
  - spec: 3.1, 2.23, 2.1; depends on: P-L9_02, P-L9_03; budgets: -
  - reuse_from: none (write fresh)
- **P-L9b_03** (grok, 60 min) Chats sidebar: assistant start icon, Needs you, Starred faces with Cmd-1..9, Recent groups with pulse, Channels, Projects group
  - spec: 3.2, 2.23; depends on: P-L9_02, P-L9_03; budgets: chat_open
  - reuse_from: none (write fresh)
- **P-L9b_04** (grok, 90 min) Chats conversation: virtual list, composer with who-will-reply line, thread header, steer/interrupt/stop
  - spec: 3.2, 2.5, 4.13; depends on: P-L9b_03, P-L9_04, P-L9_20; budgets: chat_open,send,stream_render
  - reuse_from: none (write fresh)
- **P-L9b_05** (grok, 75 min) AgentPage (tabs Chats, Memory, Files, Computer, Settings), role-line edit with Undo, routines runs
  - spec: 2.6, 3.2; depends on: P-L9b_03, P-L9_07; budgets: -
  - reuse_from: none (write fresh)
- **P-L9b_06** (grok, 60 min) HelperChat (read-only with address bar) and NeedsYou two-column
  - spec: 3.2, 2.8; depends on: P-L9b_03; budgets: -
  - reuse_from: none (write fresh)
- **P-L9b_07** (grok, 60 min) Chats right pane (Computer, Threads, Files, Memory, Routines)
  - spec: 3.2, 2.7; depends on: P-L9b_03; budgets: -
  - reuse_from: none (write fresh)
- **P-L9b_08** (grok, 60 min) ComputerPopup: 90 percent overlay, Take over, Record, Chat, Close; Record while taking over sheet
  - spec: 2.7; depends on: P-L9b_03; budgets: -
  - reuse_from: none (write fresh)

Port map and gaps: `team/v1/prep/PORT-GAPS.md` (162 files assigned, 84 not needed). Rules for every port (ruling 11): only files in your packet's reuse_from; real types, no `@ts-nocheck`/`@ts-ignore` (ruling 2); test files become your own behaviour tests; header `// from vyre 0.6.9 <path>@<sha>`. Rename 0.6 vocabulary (Flows to Automations, Words per spec section 1).

## Traps
Reuse `ui` components; never reinvent tabs, side pane, viewer, menus. No rows of pill chips for filters (use a header menu with checkmarks and counts). Every element defines click, right-click, hover and keyboard. Chat messages are virtual lists.

## Speed and CI budgets that apply
Binding for everyone (V1-SPEC Speed and smoothness): everything reads from the local copy; first paint <50 ms, complete <100 ms on tab/record/file/chat switch; 60 fps scroll through 10,000 rows (virtual lists, `ui/VirtualList`); no layout shift (reserved sizes, skeletons the size of final content); one persistent streaming connection per device; hover/focus prefetch via `prefetch(screenId,args)`. Each `KitScreenDef.perf` yields a probe in `generated/probes.json`; a packet that misses its budget is not done.

Your perf rows: `chat_open`, `scroll` (messages), `navigate`, `layout_shift`

## Golden flows you must satisfy
2 (first Home checklist); 8 (memory promotion task surface); 3 (changeset card in chat).

Flows are `golden/*.ts` on `createTestSpace` with fake providers. A flow is `pending` while any module in its `needs` is `stub`; `scripts/golden-ready.ts` shows what still blocks it.

## Tests that must turn green
place screen tests (`apps/app/src/places/*/**.test.ts`, `ui/src/__screens__/**`); perf `chat_open`.
Each packet's evidence must name the test files and show `ok` in the linked CI run (never run node or npm on the Mac; CI runs everything).

## First two hours
Hour 0 to 2: Chats list and conversation over fake data from the generated client. Do not wait for L2.

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
