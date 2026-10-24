# F12 run B: L2, L4, L5, L8

Packet P-PR_41. Source root `Orgs/Vyre/wt-train067` (vyre 0.6.9), ARCHITECTURE-V1 section 11. Spec base is V1-SPEC section 5 b12: TypeScript end to end, and reuse the 0.6 code where it still works. This run covers the agent, file, connector and site rows. F12 copies KEEP and CLEAN rows and does no cleaning and no ports (ARCHITECTURE-V1 12.2).

Marks follow `scripts/import-0.6.ts`:

- **imported**: verdict starts with KEEP or CLEAN (KEEP shape, KEEP core, CLEAN trim, CLEAN or fold, CLEAN heavily). The tool copies every named source into the first destination only, and writes `// from vyre 0.6.9 <path>@<sha>` on JS and TS (`#` on shell and Python).
- **REWRITE**: verdict starts with REWRITE. The row is logged and nothing is copied.
- **DROP**: verdict starts with DROP. The row is logged and nothing is copied.

The lane is the longest `scripts/lanes.json` owns prefix of the first destination (`laneOf`). KEEP idea and "port selectively" are idea rows. None of those have a first destination in L2, L4, L5 or L8.

20 section 11 rows land in these lanes: 17 imported, 3 REWRITE, 0 DROP.

DROP rows 20, 30, 38, 42 and 68 name no destination folder, so they stay unowned and are outside this run.

## L2 Agents

| Row | Mark | 0.6 sources | First destination | Also named | Notes |
|---|---|---|---|---|---|
| 21 | REWRITE | `core/switchboard` | `agent/src/turn-engine` | `modules/chat`, `modules/engine` | Tests are a behaviour spec. `rollover.js` and `translate.js` stay ideas for the rewrite. |
| 22 | imported | `core/sessions` | `agent/src/drivers` | `modules/engine` | Provider adapters, accounts, models. Becomes the driver layer plus accounts. |
| 23 | imported | `core/providers` | `agent/src/registry.ts` | | KEEP shape. |
| 25 | imported | `core/comms`, `core/mentions` | `modules/chat` | `lib/route.ts`, `ui/Composer` | |
| 26 | imported | `core/agents` | `modules/agents` | | One agent type. AGENT.md and agent.toml per spec 2.6. |
| 27 | REWRITE | `core/spawner`, `core/runner` | `sandbox` | | Docker, seatbelt and bwrap adapters. No gocryptfs or fscrypt. |
| 28 | imported | `core/mcp`, `harness` | `agent/src/mcp` | `apps/chrome` | Tool list comes from manifests. Cut toward about 60 default tools. |
| 29 | REWRITE | `core/memory` | `modules/memory` | | Evals `scripts/eval-memory.js`, `eval-answer`, `eval-said`, `eval-realuse` are the 50-question seed. The row is not copied. |
| 31 | imported | `core/skills`, `core/hooks`, `core/pluginagent` | `modules/agents` | `agent/src/hooks` | Skills and hooks. |
| 33 | imported | `core/computers`, `core/computer`, `core/glass`, `core/sight` | `modules/computers` | `images/agent-computer`, `sandbox/computer` | agentd, CDP and profiles kept. glass and sight feed the computer popup stream. |
| 34 | imported | `core/dockerproxy` | `sandbox/docker.ts` | | Engine API client. |
| 35 | imported | `modules/hands-chrome` | `modules/computers` | `apps/chrome` | Chrome tools. |
| 60 | imported | `core/spend`, `core/models`, `core/assistant`, `core/ask`, `core/context`, `core/suggest`, `core/tips`, `core/transcripts`, `core/space-sessions` | `modules/engine` | `modules/chat` | CLEAN or fold. |

## L4 Files

| Row | Mark | 0.6 sources | First destination | Also named | Notes |
|---|---|---|---|---|---|
| 45 | imported | `core/files` | `modules/files` | | Folders, versions, shared-with-me. |
| 46 | imported | `core/previews` | `modules/previews` | | CLEAN trim. 3D and app previews come out in the later clean. |
| 47 | imported | `core/documents` | `modules/documents` | | docxtemplater. KEEP. |

## L5 Comms

| Row | Mark | 0.6 sources | First destination | Also named | Notes |
|---|---|---|---|---|---|
| 49 | imported | `core/google`, `core/microsoft`, `core/mail`, `core/github`, `core/connectors`, `lib/connectors`, `records/connectors` | `modules/google` | `modules/microsoft`, `modules/mail`, `modules/github`, `modules/connectors` | Per section 8. All seven sources copy into `modules/google` (first destination). |

## L8 Apps

| Row | Mark | 0.6 sources | First destination | Also named | Notes |
|---|---|---|---|---|---|
| 48 | imported | `core/artifacts`, `core/publish`, `lib/publish`, `lib/siteops` | `modules/sites` | | Rebuilt around Docker and Caddy during the later clean. |
| 51 | imported | `records` | `kits` | `modules/records`, `modules/calendar` | Built-in record types become manifest `recordTypes`. |
| 54 | imported | `core/appmods` | `modules/kits` | | |

## Log

```
rewrite    row  21  REWRITE: core/switchboard -> agent/src/turn-engine [L2]
imported   row  22  core/sessions -> agent/src/drivers [L2]
imported   row  23  core/providers -> agent/src/registry.ts [L2]
imported   row  25  core/comms -> modules/chat [L2]
imported   row  25  core/mentions -> modules/chat [L2]
imported   row  26  core/agents -> modules/agents [L2]
rewrite    row  27  REWRITE: core/spawner -> sandbox [L2]
rewrite    row  27  REWRITE: core/runner -> sandbox [L2]
imported   row  28  core/mcp -> agent/src/mcp [L2]
imported   row  28  harness -> agent/src/mcp [L2]
rewrite    row  29  REWRITE: core/memory -> modules/memory [L2]
imported   row  31  core/skills -> modules/agents [L2]
imported   row  31  core/hooks -> modules/agents [L2]
imported   row  31  core/pluginagent -> modules/agents [L2]
imported   row  33  core/computers -> modules/computers [L2]
imported   row  33  core/computer -> modules/computers [L2]
imported   row  33  core/glass -> modules/computers [L2]
imported   row  33  core/sight -> modules/computers [L2]
imported   row  34  core/dockerproxy -> sandbox/docker.ts [L2]
imported   row  35  modules/hands-chrome -> modules/computers [L2]
imported   row  45  core/files -> modules/files [L4]
imported   row  46  core/previews -> modules/previews [L4]
imported   row  47  core/documents -> modules/documents [L4]
imported   row  48  core/artifacts -> modules/sites [L8]
imported   row  48  core/publish -> modules/sites [L8]
imported   row  48  lib/publish -> modules/sites [L8]
imported   row  48  lib/siteops -> modules/sites [L8]
imported   row  49  core/google -> modules/google [L5]
imported   row  49  core/microsoft -> modules/google [L5]
imported   row  49  core/mail -> modules/google [L5]
imported   row  49  core/github -> modules/google [L5]
imported   row  49  core/connectors -> modules/google [L5]
imported   row  49  lib/connectors -> modules/google [L5]
imported   row  49  records/connectors -> modules/google [L5]
imported   row  51  records -> kits [L8]
imported   row  54  core/appmods -> modules/kits [L8]
imported   row  60  core/spend -> modules/engine [L2]
imported   row  60  core/models -> modules/engine [L2]
imported   row  60  core/assistant -> modules/engine [L2]
imported   row  60  core/ask -> modules/engine [L2]
imported   row  60  core/context -> modules/engine [L2]
imported   row  60  core/suggest -> modules/engine [L2]
imported   row  60  core/tips -> modules/engine [L2]
imported   row  60  core/transcripts -> modules/engine [L2]
imported   row  60  core/space-sessions -> modules/engine [L2]
```

import-0.6 run B: 17 imported rows, 3 REWRITE rows, 0 DROP rows. Rows 21, 27 and 29 are REWRITE.
