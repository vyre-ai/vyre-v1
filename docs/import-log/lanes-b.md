# F12 run B: L2, L4, L5, L8

> Ruling 11: this file is a port map, not an import record. No 0.6 file was copied by this packet. Every KEEP/CLEAN source file is mapped to the build packet(s) whose `reuse_from` in `team/v1/prep/packets.json` names its path; `GAP` means no build packet names it. Matching: a directory reference covers its files; an explicit file or glob list limits a reference to those files; reuse_from entries with no path (e.g. "memory: ...") are ignored. Lines marked `port` replace the earlier `imported` marks. REWRITE and DROP rows are unchanged.

## Gaps: 64 of 842 KEEP/CLEAN source files have no build packet

- `core/ask/` (4): `ask.test.js`, `index.js`, `model.js`, `module.json`
- `core/assistant/` (9): `assistant.test.js`, `glance.js`, `handoff.js`, `index.js`, `manifest.js`, `module.json` ...
- `core/context/` (3): `context.test.js`, `index.js`, `module.json`
- `core/glass/` (9): `bytes.js`, `fs-parity.test.js`, `glass.test.js`, `guard.js`, `guard.test.js`, `index.js` ...
- `core/glass/providers/` (4): `box.js`, `browser.js`, `computer.js`, `fake.js`
- `core/pluginagent/` (6): `index.js`, `module.json`, `pluginagent-grant.test.js`, `pluginagent-scope.test.js`, `pluginagent.test.js`, `revoke-relay.test.js`
- `core/sight/` (3): `index.js`, `module.json`, `sight.test.js`
- `core/space-sessions/` (6): `budget.js`, `budget.test.js`, `continue.js`, `index.js`, `space-sessions.test.js`, `state.js`
- `core/suggest/` (4): `index.js`, `match.js`, `module.json`, `suggest.test.js`
- `core/tips/` (7): `check.js`, `check.test.js`, `index.js`, `module.json`, `pick.js`, `pick.test.js` ...
- `core/transcripts/` (6): `blocks.test.js`, `index.js`, `links.js`, `links.test.js`, `sanitize.js`, `transcripts.test.js`
- `core/transcripts/fixtures/` (3): `rich.jsonl`, `split.jsonl`, `split.stream.jsonl`


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
| 22 | port | `core/sessions` | `agent/src/drivers` | `modules/engine` | Provider adapters, accounts, models. Becomes the driver layer plus accounts. |
| 23 | port | `core/providers` | `agent/src/registry.ts` | | KEEP shape. |
| 25 | port | `core/comms`, `core/mentions` | `modules/chat` | `lib/route.ts`, `ui/Composer` | |
| 26 | port | `core/agents` | `modules/agents` | | One agent type. AGENT.md and agent.toml per spec 2.6. |
| 27 | REWRITE | `core/spawner`, `core/runner` | `sandbox` | | Docker, seatbelt and bwrap adapters. No gocryptfs or fscrypt. |
| 28 | port | `core/mcp`, `harness` | `agent/src/mcp` | `apps/chrome` | Tool list comes from manifests. Cut toward about 60 default tools. |
| 29 | REWRITE | `core/memory` | `modules/memory` | | Evals `scripts/eval-memory.js`, `eval-answer`, `eval-said`, `eval-realuse` are the 50-question seed. The row is not copied. |
| 31 | port | `core/skills`, `core/hooks`, `core/pluginagent` | `modules/agents` | `agent/src/hooks` | Skills and hooks. |
| 33 | port | `core/computers`, `core/computer`, `core/glass`, `core/sight` | `modules/computers` | `images/agent-computer`, `sandbox/computer` | agentd, CDP and profiles kept. glass and sight feed the computer popup stream. |
| 34 | port | `core/dockerproxy` | `sandbox/docker.ts` | | Engine API client. |
| 35 | port | `modules/hands-chrome` | `modules/computers` | `apps/chrome` | Chrome tools. |
| 60 | port | `core/spend`, `core/models`, `core/assistant`, `core/ask`, `core/context`, `core/suggest`, `core/tips`, `core/transcripts`, `core/space-sessions` | `modules/engine` | `modules/chat` | CLEAN or fold. |

## L4 Files

| Row | Mark | 0.6 sources | First destination | Also named | Notes |
|---|---|---|---|---|---|
| 45 | port | `core/files` | `modules/files` | | Folders, versions, shared-with-me. |
| 46 | port | `core/previews` | `modules/previews` | | CLEAN trim. 3D and app previews come out in the later clean. |
| 47 | port | `core/documents` | `modules/documents` | | docxtemplater. KEEP. |

## L5 Comms

| Row | Mark | 0.6 sources | First destination | Also named | Notes |
|---|---|---|---|---|---|
| 49 | port | `core/google`, `core/microsoft`, `core/mail`, `core/github`, `core/connectors`, `lib/connectors`, `records/connectors` | `modules/google` | `modules/microsoft`, `modules/mail`, `modules/github`, `modules/connectors` | Per section 8. All seven sources copy into `modules/google` (first destination). |

## L8 Apps

| Row | Mark | 0.6 sources | First destination | Also named | Notes |
|---|---|---|---|---|---|
| 48 | port | `core/artifacts`, `core/publish`, `lib/publish`, `lib/siteops` | `modules/sites` | | Rebuilt around Docker and Caddy during the later clean. |
| 51 | port | `records` | `kits` | `modules/records`, `modules/calendar` | Built-in record types become manifest `recordTypes`. |
| 54 | port | `core/appmods` | `modules/kits` | | |

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

## Port map (one line per 0.6 source file)

port row  22  core/sessions/account-model.js -> P-L2_02
port row  22  core/sessions/account-model.test.js -> P-L2_02
port row  22  core/sessions/accounts-service.js -> P-L2_02
port row  22  core/sessions/accounts-service.test.js -> P-L2_02
port row  22  core/sessions/accounts.js -> P-L2_02
port row  22  core/sessions/accounts.test.js -> P-L2_02
port row  22  core/sessions/agent-brief.js -> P-L2_02
port row  22  core/sessions/api-key.test.js -> P-L2_02
port row  22  core/sessions/claude.js -> P-L2_02
port row  22  core/sessions/collection-tags.live.test.js -> P-L2_02
port row  22  core/sessions/concurrent-load.test.js -> P-L2_02
port row  22  core/sessions/config.js -> P-L2_02
port row  22  core/sessions/conformance.js -> P-L2_02
port row  22  core/sessions/credential-scan.test.js -> P-L2_02
port row  22  core/sessions/door-bridge.test.js -> P-L2_02
port row  22  core/sessions/drivers/acp.js -> P-L2_02
port row  22  core/sessions/drivers/acp.test.js -> P-L2_02
port row  22  core/sessions/drivers/claude-shots.js -> P-L2_02
port row  22  core/sessions/drivers/codex-skills.test.js -> P-L2_02
port row  22  core/sessions/drivers/codex.js -> P-L2_02
port row  22  core/sessions/drivers/credential.js -> P-L2_02
port row  22  core/sessions/drivers/grok.js -> P-L2_02
port row  22  core/sessions/drivers/lent-agent.js -> P-L2_02
port row  22  core/sessions/drivers/lent-agent.test.js -> P-L2_02
port row  22  core/sessions/drivers/opencode.js -> P-L2_02
port row  22  core/sessions/drivers/opencode.test.js -> P-L2_02
port row  22  core/sessions/drivers/openrouter.js -> P-L2_02
port row  22  core/sessions/drivers/openrouter.test.js -> P-L2_02
port row  22  core/sessions/drivers/plugin-layout.js -> P-L2_02
port row  22  core/sessions/drivers/signin-door.js -> P-L2_02
port row  22  core/sessions/drivers/signin-door.test.js -> P-L2_02
port row  22  core/sessions/drivers/skill-homes.js -> P-L2_02
port row  22  core/sessions/environment.js -> P-L2_02
port row  22  core/sessions/environment.test.js -> P-L2_02
port row  22  core/sessions/harness-caps.test.js -> P-L2_02
port row  22  core/sessions/identity.js -> P-L2_02
port row  22  core/sessions/identity.test.js -> P-L2_02
port row  22  core/sessions/index.js -> P-L2_02
port row  22  core/sessions/iq-prompt.js -> P-L2_02
port row  22  core/sessions/lent-key-spawn.test.js -> P-L2_02
port row  22  core/sessions/lent-spawn.js -> P-L2_02
port row  22  core/sessions/lent-spawn.test.js -> P-L2_02
port row  22  core/sessions/login-direct.test.js -> P-L2_02
port row  22  core/sessions/member-endpoints.js -> P-L2_02
port row  22  core/sessions/member-endpoints.test.js -> P-L2_02
port row  22  core/sessions/module.json -> P-L2_02
port row  22  core/sessions/next-signed.js -> P-L2_02
port row  22  core/sessions/opencode-key.test.js -> P-L2_02
port row  22  core/sessions/prompts.js -> P-L2_02
port row  22  core/sessions/prompts.test.js -> P-L2_02
port row  22  core/sessions/providers.js -> P-L2_02
port row  22  core/sessions/readfile.js -> P-L2_02
port row  22  core/sessions/readfile.test.js -> P-L2_02
port row  22  core/sessions/residency.test.js -> P-L2_02
port row  22  core/sessions/rollover.test.js -> P-L2_02
port row  22  core/sessions/routes.js -> P-L2_02
port row  22  core/sessions/routes.test.js -> P-L2_02
port row  22  core/sessions/sdk-install.test.js -> P-L2_02
port row  22  core/sessions/sdk-pin.js -> P-L2_02
port row  22  core/sessions/sdk.js -> P-L2_02
port row  22  core/sessions/sessions-b.test.js -> P-L2_02
port row  22  core/sessions/sessions-c.test.js -> P-L2_02
port row  22  core/sessions/sessions-d.test.js -> P-L2_02
port row  22  core/sessions/sessions-e.test.js -> P-L2_02
port row  22  core/sessions/sessions-f.test.js -> P-L2_02
port row  22  core/sessions/sessions-g.test.js -> P-L2_02
port row  22  core/sessions/sessions-h.test.js -> P-L2_02
port row  22  core/sessions/sessions-turns.test.js -> P-L2_02
port row  22  core/sessions/sessions.test.js -> P-L2_02
port row  22  core/sessions/signin.js -> P-L2_02
port row  22  core/sessions/signin.test.js -> P-L2_02
port row  22  core/sessions/slots.js -> P-L2_02
port row  22  core/sessions/slots.test.js -> P-L2_02
port row  22  core/sessions/spawn-agent.test.js -> P-L2_02
port row  22  core/sessions/spawn.js -> P-L2_02
port row  22  core/sessions/testing/boot.js -> P-L2_02
port row  22  core/sessions/testing/fake-acp.js -> P-L2_02
port row  22  core/sessions/testing/fake-agent-harness.js -> P-L2_02
port row  22  core/sessions/testing/fake-login.js -> P-L2_02
port row  22  core/sessions/testing/fake-signin.js -> P-L2_02
port row  22  core/sessions/testing/fake-tini.js -> P-L2_02
port row  22  core/sessions/testing/golden-switch.json -> P-L2_02
port row  22  core/sessions/testing/golden.js -> P-L2_02
port row  22  core/sessions/testing/real/codex/00-handshake.ndjson -> P-L2_02
port row  22  core/sessions/testing/real/codex/01-turn-plain.ndjson -> P-L2_02
port row  22  core/sessions/testing/real/codex/02-turn-command-outside-workspace.ndjson -> P-L2_02
port row  22  core/sessions/testing/real/codex/03-turn-vyre-mcp-tool.ndjson -> P-L2_02
port row  22  core/sessions/testing/real/codex/04-turn-plan-and-edit.ndjson -> P-L2_02
port row  22  core/sessions/testing/real/codex/05-turn-plan-mode.ndjson -> P-L2_02
port row  22  core/sessions/testing/real/grok/00-handshake.ndjson -> P-L2_02
port row  22  core/sessions/testing/real/grok/01-turn-plain.ndjson -> P-L2_02
port row  22  core/sessions/testing/real/grok/02-turn-command-outside-workspace.ndjson -> P-L2_02
port row  22  core/sessions/testing/real/grok/03-turn-vyre-mcp-tool.ndjson -> P-L2_02
port row  22  core/sessions/testing/real/grok/04-turn-plan-and-edit.ndjson -> P-L2_02
port row  22  core/sessions/testing/real/media/codex-image/image.png -> P-L2_02
port row  22  core/sessions/testing/real/media/codex-image/stream.ndjson -> P-L2_02
port row  22  core/sessions/testing/real/media/grok-image/image.jpg -> P-L2_02
port row  22  core/sessions/testing/real/media/grok-image/stream.ndjson -> P-L2_02
port row  22  core/sessions/testing/real/media/grok-video-refused/stream.ndjson -> P-L2_02
port row  22  core/sessions/testing/real/media/grok-video/stream.ndjson -> P-L2_02
port row  22  core/sessions/testing/real/media/grok-video/video.mp4 -> P-L2_02
port row  22  core/sessions/testing/real/real.test.js -> P-L2_02
port row  22  core/sessions/testing/recall-live.js -> P-L2_02
port row  22  core/sessions/windows-no-shell.test.js -> P-L2_02
port row  23  core/providers/index.js -> P-L2_02
port row  23  core/providers/module.json -> P-L2_02
port row  25  core/comms/attachments-daemon.test.js -> P-L2_10
port row  25  core/comms/attachments.test.js -> P-L2_10
port row  25  core/comms/comms.test.js -> P-L2_10
port row  25  core/comms/index.js -> P-L2_10
port row  25  core/comms/module.json -> P-L2_10
port row  25  core/comms/sending/index.js -> P-L2_10
port row  25  core/comms/sending/sending.test.js -> P-L2_10
port row  25  core/comms/service.test.js -> P-L2_10
port row  25  core/mentions/index.js -> P-L2_10, P-L9_04
port row  25  core/mentions/mentions.test.js -> P-L2_10, P-L9_04
port row  25  core/mentions/module.json -> P-L2_10, P-L9_04
port row  26  core/agents/access.test.js -> P-L2_12
port row  26  core/agents/assistant-own.test.js -> P-L2_12
port row  26  core/agents/config.js -> P-L2_12
port row  26  core/agents/config.test.js -> P-L2_12
port row  26  core/agents/effort.test.js -> P-L2_12
port row  26  core/agents/engineer-handoff.test.js -> P-L2_12
port row  26  core/agents/fallback-model.test.js -> P-L2_12
port row  26  core/agents/flow-say-person-only.test.js -> P-L2_12
port row  26  core/agents/flow-say.test.js -> P-L2_12
port row  26  core/agents/index.js -> P-L2_12
port row  26  core/agents/job.test.js -> P-L2_12
port row  26  core/agents/look.test.js -> P-L2_12
port row  26  core/agents/member-runas.test.js -> P-L2_12
port row  26  core/agents/mirror.js -> P-L2_12
port row  26  core/agents/mirror.test.js -> P-L2_12
port row  26  core/agents/module.json -> P-L2_12
port row  26  core/agents/new-agent.test.js -> P-L2_12
port row  26  core/agents/orient.test.js -> P-L2_12
port row  26  core/agents/own-account.test.js -> P-L2_12
port row  26  core/agents/roster-member.test.js -> P-L2_12
port row  26  core/agents/space-setup.test.js -> P-L2_12
port row  26  core/agents/subagents.test.js -> P-L2_12
port row  26  core/agents/versions.test.js -> P-L2_12
port row  26  core/agents/wake.test.js -> P-L2_12
port row  26  core/agents/watcher-wake.test.js -> P-L2_12
port row  28  core/mcp/client.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L2_07
port row  28  core/mcp/client.test.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L2_07
port row  28  core/mcp/discover.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L2_07
port row  28  core/mcp/discover.test.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L2_07
port row  28  core/mcp/fuzz.test.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L2_07
port row  28  core/mcp/hub-keys.test.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L2_07
port row  28  core/mcp/hub.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L2_07
port row  28  core/mcp/hub.test.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L2_07
port row  28  core/mcp/index.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L2_07
port row  28  core/mcp/may-use-as.test.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L2_07
port row  28  core/mcp/module.json -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L2_07
port row  28  core/mcp/module.test.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L2_07
port row  28  core/mcp/testing/fake-mcp.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L2_07
port row  28  harness/.claude-plugin/plugin.json -> P-L2_07
port row  28  harness/.mcp.json -> P-L2_07
port row  28  harness/commands/vyre.md -> P-L2_07
port row  28  harness/hooks/hook.js -> P-L2_07
port row  28  harness/hooks/hooks.json -> P-L2_07
port row  28  harness/hooks/run.js -> P-L2_07
port row  28  harness/lib/vyre.js -> P-L2_07
port row  28  harness/mcp/asks.js -> P-L2_07
port row  28  harness/mcp/core-tools.js -> P-L2_07
port row  28  harness/mcp/design-serve.js -> P-L2_07
port row  28  harness/mcp/design.js -> P-L2_07
port row  28  harness/mcp/design.test.js -> P-L2_07
port row  28  harness/mcp/memory-tools.js -> P-L2_07
port row  28  harness/mcp/memory-tools.test.js -> P-L2_07
port row  28  harness/mcp/offered.js -> P-L2_07
port row  28  harness/mcp/run.js -> P-L2_07
port row  28  harness/mcp/server.js -> P-L2_07
port row  28  harness/mcp/setup-vyre.md -> P-L2_07
port row  28  harness/mcp/slash-native.test.js -> P-L2_07
port row  28  harness/member-relay-harness.js -> P-L2_07
port row  28  harness/skills/build-a-template/SKILL.md -> P-L2_07
port row  28  harness/skills/turn-this-into-a-flow/SKILL.md -> P-L2_07
port row  28  harness/skills/use-the-vault/SKILL.md -> P-L2_07
port row  28  harness/skills/work-in-a-project/SKILL.md -> P-L2_07
port row  28  harness/skills/write-a-watcher/SKILL.md -> P-L2_07
port row  28  harness/statusline/statusline.sh -> P-L2_07
port row  31  core/skills/browse-entrypoints.test.js -> P-L2_12
port row  31  core/skills/browse-lib.js -> P-L2_12
port row  31  core/skills/browse-lib.test.js -> P-L2_12
port row  31  core/skills/home-kernel.js -> P-L2_12
port row  31  core/skills/home-kernel.test.js -> P-L2_12
port row  31  core/skills/import-tool.test.js -> P-L2_12
port row  31  core/skills/import.js -> P-L2_12
port row  31  core/skills/import.test.js -> P-L2_12
port row  31  core/skills/index.js -> P-L2_12
port row  31  core/skills/learned-draft.test.js -> P-L2_12
port row  31  core/skills/library-canon.test.js -> P-L2_12
port row  31  core/skills/library.js -> P-L2_12
port row  31  core/skills/mcp-place.test.js -> P-L2_12
port row  31  core/skills/member-door-dispatch.test.js -> P-L2_12
port row  31  core/skills/member-import.test.js -> P-L2_12
port row  31  core/skills/member-ops.js -> P-L2_12
port row  31  core/skills/member-records.test.js -> P-L2_12
port row  31  core/skills/member-skills.test.js -> P-L2_12
port row  31  core/skills/member-upload.js -> P-L2_12
port row  31  core/skills/member-upload.test.js -> P-L2_12
port row  31  core/skills/module.json -> P-L2_12
port row  31  core/skills/skill-pin.test.js -> P-L2_12
port row  31  core/skills/skills.test.js -> P-L2_12
port row  31  core/hooks/README.md -> P-L2_12
port row  31  core/hooks/deliveries.js -> P-L2_12
port row  31  core/hooks/flow-address.test.js -> P-L2_12
port row  31  core/hooks/flow-body.js -> P-L2_12
port row  31  core/hooks/flow-body.test.js -> P-L2_12
port row  31  core/hooks/hooks.test.js -> P-L2_12
port row  31  core/hooks/index.js -> P-L2_12
port row  31  core/hooks/listener.js -> P-L2_12
port row  31  core/hooks/module.json -> P-L2_12
port row  31  core/hooks/open-card.test.js -> P-L2_12
port row  31  core/hooks/verify.js -> P-L2_12
port row  31  core/hooks/verify.test.js -> P-L2_12
port row  31  core/pluginagent/index.js -> GAP
port row  31  core/pluginagent/module.json -> GAP
port row  31  core/pluginagent/pluginagent-grant.test.js -> GAP
port row  31  core/pluginagent/pluginagent-scope.test.js -> GAP
port row  31  core/pluginagent/pluginagent.test.js -> GAP
port row  31  core/pluginagent/revoke-relay.test.js -> GAP
port row  33  core/computers/agent-browser.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/agent-browser.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/agent-desk.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/agent-endpoint.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/agent-endpoint.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/agent-files.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/agent-files.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/agent-run.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/agent-tools.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/agent-tools.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/agent-users.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/agent-users.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/agentd-ctl.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/agentd-ctl.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/browser-glass.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/browser-profiles.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/browser-profiles.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/cdp-adapter.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/cdp-adapter.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/chrome-prefs.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/computers.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/desk-ask.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/driver/docker.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/driver/docker.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/driver/exec-in.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/driver/fake.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/driver/fake.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/driver/index.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/driver/layout.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/driver/policy.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/driver/policy.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/exec.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/fill.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/fill.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/glass-map.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/glass-map.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/glass-relay.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/glass.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/glass.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/helper.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/Dockerfile -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/agentd-chrome.py -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/agentd-client.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/agentd-dock.py -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/agentd-fs.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/agentd-fs.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/agentd-main.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/agentd-pipe.py -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/agentd-relay.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/agentd-relay.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/agentd-run.py -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/agentd-run.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/agentd-server.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/agentd-term.py -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/agentd-vncpass.sh -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/agentd.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/agentd.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/computerd/atspi.py -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/computerd/cdpmux-profile.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/computerd/cdpmux.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/computerd/cdpmux.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/computerd/fs.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/computerd/fs.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/computerd/gate.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/computerd/gate.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/computerd/index.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/computerd/index.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/computerd/peer-file.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/computerd/peer-file.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/computerd/testing/fake-chrome.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/computerd/ws.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/desk/dock/browser-112.png -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/desk/dock/browser-56.png -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/desk/dock/browser-62.png -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/desk/dock/browser-68.png -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/desk/dock/files-112.png -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/desk/dock/files-56.png -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/desk/dock/files-62.png -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/desk/dock/files-68.png -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/desk/dock/panel.png -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/desk/dock/terminal-112.png -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/desk/dock/terminal-56.png -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/desk/dock/terminal-62.png -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/desk/dock/terminal-68.png -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/desk/fluxbox/apps -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/desk/fluxbox/init -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/desk/fluxbox/keys -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/desk/fluxbox/menu -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/desk/fluxbox/overlay -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/desk/fluxbox/windowmenu -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/desk/make-assets.sh -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/desk/newtab.html -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/desk/vyre-mark.png -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/dockerfile-files.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/entrypoint.sh -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/isolation.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/image/loopback.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/index.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/keyboard.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/keyboard.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/member-browser-handback.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/member-browser-handback.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/member-key.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/member-key.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/module-call.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/module.json -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/person-id.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/plain.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/plain.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/pool.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/pool.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/rfb.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/shared-browser.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/shared-browser.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/shield.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/shield.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/terminal.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/terminal.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/update-gate.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/update.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/update.test.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computers/ws.js -> P-L2_16, P-L2_17, P-L2_18
port row  33  core/computer/computer.test.js -> P-L2_16
port row  33  core/computer/index.js -> P-L2_16
port row  33  core/computer/module.json -> P-L2_16
port row  33  core/computer/route.js -> P-L2_16
port row  33  core/computer/route.test.js -> P-L2_16
port row  33  core/glass/bytes.js -> GAP
port row  33  core/glass/fs-parity.test.js -> GAP
port row  33  core/glass/glass.test.js -> GAP
port row  33  core/glass/guard.js -> GAP
port row  33  core/glass/guard.test.js -> GAP
port row  33  core/glass/index.js -> GAP
port row  33  core/glass/mime.js -> GAP
port row  33  core/glass/module.json -> GAP
port row  33  core/glass/providers/box.js -> GAP
port row  33  core/glass/providers/browser.js -> GAP
port row  33  core/glass/providers/computer.js -> GAP
port row  33  core/glass/providers/fake.js -> GAP
port row  33  core/glass/streams.js -> GAP
port row  33  core/sight/index.js -> GAP
port row  33  core/sight/module.json -> GAP
port row  33  core/sight/sight.test.js -> GAP
port row  34  core/dockerproxy/main.js -> P-L2_05
port row  34  core/dockerproxy/proxy.js -> P-L2_05
port row  34  core/dockerproxy/proxy.test.js -> P-L2_05
port row  35  modules/hands-chrome/act.js -> P-L10_06
port row  35  modules/hands-chrome/act.test.js -> P-L10_06
port row  35  modules/hands-chrome/api-exec.js -> P-L10_06
port row  35  modules/hands-chrome/api-exec.test.js -> P-L10_06
port row  35  modules/hands-chrome/api-tool.js -> P-L10_06
port row  35  modules/hands-chrome/api-tool.test.js -> P-L10_06
port row  35  modules/hands-chrome/cdp-prefer.test.js -> P-L10_06
port row  35  modules/hands-chrome/cdp.js -> P-L10_06
port row  35  modules/hands-chrome/chrome.test.js -> P-L10_06
port row  35  modules/hands-chrome/consequence.js -> P-L10_06
port row  35  modules/hands-chrome/consequence.test.js -> P-L10_06
port row  35  modules/hands-chrome/index.js -> P-L10_06
port row  35  modules/hands-chrome/module.json -> P-L10_06
port row  35  modules/hands-chrome/nav.js -> P-L10_06
port row  35  modules/hands-chrome/nav.test.js -> P-L10_06
port row  35  modules/hands-chrome/net-tool.js -> P-L10_06
port row  35  modules/hands-chrome/net-tool.test.js -> P-L10_06
port row  35  modules/hands-chrome/op-run.test.js -> P-L10_06
port row  35  modules/hands-chrome/rv2-consequence.test.js -> P-L10_06
port row  35  modules/hands-chrome/rv2-consequence2.test.js -> P-L10_06
port row  35  modules/hands-chrome/selector.js -> P-L10_06
port row  35  modules/hands-chrome/siteops.js -> P-L10_06
port row  35  modules/hands-chrome/siteops.test.js -> P-L10_06
port row  35  modules/hands-chrome/snapshot.js -> P-L10_06
port row  35  modules/hands-chrome/snapshot.test.js -> P-L10_06
port row  35  modules/hands-chrome/verify.js -> P-L10_06
port row  60  core/spend/index.js -> P-L2_13
port row  60  core/spend/module.json -> P-L2_13
port row  60  core/spend/spend.test.js -> P-L2_13
port row  60  core/models/index.js -> P-L2_13
port row  60  core/models/live-picker.test.js -> P-L2_13
port row  60  core/models/models.test.js -> P-L2_13
port row  60  core/models/module.json -> P-L2_13
port row  60  core/assistant/assistant.test.js -> GAP
port row  60  core/assistant/glance.js -> GAP
port row  60  core/assistant/handoff.js -> GAP
port row  60  core/assistant/index.js -> GAP
port row  60  core/assistant/manifest.js -> GAP
port row  60  core/assistant/module.json -> GAP
port row  60  core/assistant/surface.test.js -> GAP
port row  60  core/assistant/welcome.js -> GAP
port row  60  core/assistant/welcome.test.js -> GAP
port row  60  core/ask/ask.test.js -> GAP
port row  60  core/ask/index.js -> GAP
port row  60  core/ask/model.js -> GAP
port row  60  core/ask/module.json -> GAP
port row  60  core/context/context.test.js -> GAP
port row  60  core/context/index.js -> GAP
port row  60  core/context/module.json -> GAP
port row  60  core/suggest/index.js -> GAP
port row  60  core/suggest/match.js -> GAP
port row  60  core/suggest/module.json -> GAP
port row  60  core/suggest/suggest.test.js -> GAP
port row  60  core/tips/check.js -> GAP
port row  60  core/tips/check.test.js -> GAP
port row  60  core/tips/index.js -> GAP
port row  60  core/tips/module.json -> GAP
port row  60  core/tips/pick.js -> GAP
port row  60  core/tips/pick.test.js -> GAP
port row  60  core/tips/tips.test.js -> GAP
port row  60  core/transcripts/blocks.test.js -> GAP
port row  60  core/transcripts/fixtures/rich.jsonl -> GAP
port row  60  core/transcripts/fixtures/split.jsonl -> GAP
port row  60  core/transcripts/fixtures/split.stream.jsonl -> GAP
port row  60  core/transcripts/index.js -> GAP
port row  60  core/transcripts/links.js -> GAP
port row  60  core/transcripts/links.test.js -> GAP
port row  60  core/transcripts/sanitize.js -> GAP
port row  60  core/transcripts/transcripts.test.js -> GAP
port row  60  core/space-sessions/budget.js -> GAP
port row  60  core/space-sessions/budget.test.js -> GAP
port row  60  core/space-sessions/continue.js -> GAP
port row  60  core/space-sessions/index.js -> GAP
port row  60  core/space-sessions/space-sessions.test.js -> GAP
port row  60  core/space-sessions/state.js -> GAP
port row  45  core/files/access.js -> P-L4_01
port row  45  core/files/agent-folder.js -> P-L4_01
port row  45  core/files/agent-folder.test.js -> P-L4_01
port row  45  core/files/browse.js -> P-L4_01
port row  45  core/files/dirs.js -> P-L4_01
port row  45  core/files/dirs.test.js -> P-L4_01
port row  45  core/files/drive-windows.js -> P-L4_01
port row  45  core/files/drive.js -> P-L4_01
port row  45  core/files/drive.test.js -> P-L4_01
port row  45  core/files/drop-seal.js -> P-L4_01
port row  45  core/files/drop-store.js -> P-L4_01
port row  45  core/files/drop-wink.js -> P-L4_01
port row  45  core/files/drop-wink.test.js -> P-L4_01
port row  45  core/files/dropbox-seam.js -> P-L4_01
port row  45  core/files/dropbox-seam.test.js -> P-L4_01
port row  45  core/files/files-core.test.js -> P-L4_01
port row  45  core/files/files.test.js -> P-L4_01
port row  45  core/files/generated-real.test.js -> P-L4_01
port row  45  core/files/index.js -> P-L4_01
port row  45  core/files/kinds.js -> P-L4_01
port row  45  core/files/linked-dropbox-fake.js -> P-L4_01
port row  45  core/files/linked-dropbox.js -> P-L4_01
port row  45  core/files/linked-dropbox.test.js -> P-L4_01
port row  45  core/files/linked-fake.js -> P-L4_01
port row  45  core/files/linked-gdrive-fake.js -> P-L4_01
port row  45  core/files/linked-gdrive.js -> P-L4_01
port row  45  core/files/linked-gdrive.test.js -> P-L4_01
port row  45  core/files/linked-index.js -> P-L4_01
port row  45  core/files/linked-index.test.js -> P-L4_01
port row  45  core/files/linked-provider.js -> P-L4_01
port row  45  core/files/linked-read.js -> P-L4_01
port row  45  core/files/linked.js -> P-L4_01
port row  45  core/files/linked.test.js -> P-L4_01
port row  45  core/files/mentions.js -> P-L4_01
port row  45  core/files/mentions.test.js -> P-L4_01
port row  45  core/files/migrations.js -> P-L4_01
port row  45  core/files/migrations.test.js -> P-L4_01
port row  45  core/files/module.json -> P-L4_01
port row  45  core/files/picker.js -> P-L4_01
port row  45  core/files/places.js -> P-L4_01
port row  45  core/files/places.test.js -> P-L4_01
port row  45  core/files/safety.js -> P-L4_01
port row  45  core/files/search.js -> P-L4_01
port row  45  core/files/space-drive.js -> P-L4_01
port row  45  core/files/space-drive.test.js -> P-L4_01
port row  45  core/files/space-edit.js -> P-L4_01
port row  45  core/files/space-edit.test.js -> P-L4_01
port row  45  core/files/space-links.js -> P-L4_01
port row  45  core/files/space-links.test.js -> P-L4_01
port row  45  core/files/space-mentions.js -> P-L4_01
port row  45  core/files/space-mentions.test.js -> P-L4_01
port row  45  core/files/with-me.js -> P-L4_01
port row  45  core/files/write-lock.js -> P-L4_01
port row  46  core/previews/access.js -> P-L4_07
port row  46  core/previews/bridge.js -> P-L4_07
port row  46  core/previews/bridge.test.js -> P-L4_07
port row  46  core/previews/client/claude.js -> P-L4_07
port row  46  core/previews/docs.js -> P-L4_07
port row  46  core/previews/index.js -> P-L4_07
port row  46  core/previews/jsx.js -> P-L4_07
port row  46  core/previews/jsx.test.js -> P-L4_07
port row  46  core/previews/module.json -> P-L4_07
port row  46  core/previews/office.js -> P-L4_07
port row  46  core/previews/office.test.js -> P-L4_07
port row  46  core/previews/poster.js -> P-L4_07
port row  46  core/previews/poster.test.js -> P-L4_07
port row  46  core/previews/previews-project.test.js -> P-L4_07
port row  46  core/previews/previews.test.js -> P-L4_07
port row  46  core/previews/site.js -> P-L4_07
port row  46  core/previews/site.test.js -> P-L4_07
port row  46  core/previews/static.js -> P-L4_07
port row  46  core/previews/supervisor.js -> P-L4_07
port row  46  core/previews/supervisor.test.js -> P-L4_07
port row  46  core/previews/testing/artifact-dashboard.html -> P-L4_07
port row  46  core/previews/testing/artifact-react.jsx -> P-L4_07
port row  46  core/previews/thumb-stop.test.js -> P-L4_07
port row  46  core/previews/thumb.js -> P-L4_07
port row  46  core/previews/thumb.test.js -> P-L4_07
port row  46  core/previews/vendor-src/build.mjs -> P-L4_07
port row  46  core/previews/vendor-src/versions.json -> P-L4_07
port row  46  core/previews/vendor-src/xlsx-0.20.3.tgz -> P-L4_07
port row  46  core/previews/vendor/chart.js.js -> P-L4_07
port row  46  core/previews/vendor/chart.js__auto.js -> P-L4_07
port row  46  core/previews/vendor/d3.js -> P-L4_07
port row  46  core/previews/vendor/date-fns.js -> P-L4_07
port row  46  core/previews/vendor/lodash.js -> P-L4_07
port row  46  core/previews/vendor/lucide-react.js -> P-L4_07
port row  46  core/previews/vendor/manifest.json -> P-L4_07
port row  46  core/previews/vendor/mathjs.js -> P-L4_07
port row  46  core/previews/vendor/papaparse.js -> P-L4_07
port row  46  core/previews/vendor/react-dom.js -> P-L4_07
port row  46  core/previews/vendor/react-dom__client.js -> P-L4_07
port row  46  core/previews/vendor/react.js -> P-L4_07
port row  46  core/previews/vendor/react__jsx-dev-runtime.js -> P-L4_07
port row  46  core/previews/vendor/react__jsx-runtime.js -> P-L4_07
port row  46  core/previews/vendor/recharts.js -> P-L4_07
port row  46  core/previews/vendor/tailwind.js -> P-L4_07
port row  46  core/previews/vendor/three.js -> P-L4_07
port row  46  core/previews/vendor/xlsx.js -> P-L4_07
port row  47  core/documents/documents.test.js -> P-L4_08
port row  47  core/documents/fill.js -> P-L4_08
port row  47  core/documents/fill.test.js -> P-L4_08
port row  47  core/documents/index.js -> P-L4_08
port row  47  core/documents/links.test.js -> P-L4_08
port row  47  core/documents/members.test.js -> P-L4_08
port row  47  core/documents/module.json -> P-L4_08
port row  47  core/documents/pdf-live.test.js -> P-L4_08
port row  47  core/documents/pdf.js -> P-L4_08
port row  47  core/documents/record.js -> P-L4_08
port row  47  core/documents/record.test.js -> P-L4_08
port row  47  core/documents/signing.js -> P-L4_08
port row  47  core/documents/signing.test.js -> P-L4_08
port row  47  core/documents/testing/docx.js -> P-L4_08
port row  47  core/documents/timeline.test.js -> P-L4_08
port row  49  core/google/accounts.js -> P-L5_03
port row  49  core/google/api.js -> P-L5_03
port row  49  core/google/calendar.js -> P-L5_03
port row  49  core/google/connect.js -> P-L5_03
port row  49  core/google/connect.test.js -> P-L5_03
port row  49  core/google/drive-seam.js -> P-L5_03
port row  49  core/google/drive-seam.test.js -> P-L5_03
port row  49  core/google/drive.js -> P-L5_03
port row  49  core/google/drive.test.js -> P-L5_03
port row  49  core/google/find.js -> P-L5_03
port row  49  core/google/index.js -> P-L5_03
port row  49  core/google/mail.js -> P-L5_03
port row  49  core/google/member-account.js -> P-L5_03
port row  49  core/google/member-account.test.js -> P-L5_03
port row  49  core/google/member-scope.js -> P-L5_03
port row  49  core/google/member-scope.test.js -> P-L5_03
port row  49  core/google/module.json -> P-L5_03
port row  49  core/google/module.test.js -> P-L5_03
port row  49  core/google/own-send-files.test.js -> P-L5_03
port row  49  core/google/parts.test.js -> P-L5_03
port row  49  core/microsoft/accounts.js -> P-L5_04
port row  49  core/microsoft/check.js -> P-L5_04
port row  49  core/microsoft/graph.js -> P-L5_04
port row  49  core/microsoft/index.js -> P-L5_04
port row  49  core/microsoft/member-account.js -> P-L5_04
port row  49  core/microsoft/member-account.test.js -> P-L5_04
port row  49  core/microsoft/module.json -> P-L5_04
port row  49  core/microsoft/module.test.js -> P-L5_04
port row  49  core/mail/accounts.js -> P-L5_01
port row  49  core/mail/accounts.test.js -> P-L5_01
port row  49  core/mail/apps-script.gs -> P-L5_01
port row  49  core/mail/apps-script.js -> P-L5_01
port row  49  core/mail/apps-script.test.js -> P-L5_01
port row  49  core/mail/capsule.js -> P-L5_01
port row  49  core/mail/capsule.test.js -> P-L5_01
port row  49  core/mail/imap.js -> P-L5_01
port row  49  core/mail/imap.test.js -> P-L5_01
port row  49  core/mail/index.js -> P-L5_01
port row  49  core/mail/mcpmap.js -> P-L5_01
port row  49  core/mail/mcpmap.test.js -> P-L5_01
port row  49  core/mail/module.json -> P-L5_01
port row  49  core/mail/module.test.js -> P-L5_01
port row  49  core/mail/registry-outward-hold.test.js -> P-L5_01
port row  49  core/mail/testing/fake-apps-script.js -> P-L5_01
port row  49  core/mail/testing/fake-imap.js -> P-L5_01
port row  49  core/github/accounts.js -> P-L5_12
port row  49  core/github/connect.js -> P-L5_12
port row  49  core/github/connect.live.test.js -> P-L5_12
port row  49  core/github/connect.test.js -> P-L5_12
port row  49  core/github/git.js -> P-L5_12
port row  49  core/github/git.test.js -> P-L5_12
port row  49  core/github/index.js -> P-L5_12
port row  49  core/github/index.live.test.js -> P-L5_12
port row  49  core/github/index.test.js -> P-L5_12
port row  49  core/github/mentions.js -> P-L5_12
port row  49  core/github/module.json -> P-L5_12
port row  49  core/github/pr.js -> P-L5_12
port row  49  core/github/registry.test.js -> P-L5_12
port row  49  core/github/repo-create.js -> P-L5_12
port row  49  core/github/repo-create.test.js -> P-L5_12
port row  49  core/github/scan.test.js -> P-L5_12
port row  49  core/connectors/governor.js -> P-L3_06, P-L3_08
port row  49  core/connectors/governor.test.js -> P-L3_06, P-L3_08
port row  49  core/connectors/index.js -> P-L3_06, P-L3_08
port row  49  core/connectors/made-daemon.test.js -> P-L3_06, P-L3_08
port row  49  core/connectors/made.js -> P-L3_06, P-L3_08
port row  49  core/connectors/made.test.js -> P-L3_06, P-L3_08
port row  49  core/connectors/member-revoke.test.js -> P-L3_06, P-L3_08
port row  49  core/connectors/member.test.js -> P-L3_06, P-L3_08
port row  49  core/connectors/module.json -> P-L3_06, P-L3_08
port row  49  core/connectors/module.test.js -> P-L3_06, P-L3_08
port row  49  core/connectors/operation-run.test.js -> P-L3_06, P-L3_08
port row  49  core/connectors/site-daemon.test.js -> P-L3_06, P-L3_08
port row  49  core/connectors/site-runner.test.js -> P-L3_06, P-L3_08
port row  49  core/connectors/site.js -> P-L3_06, P-L3_08
port row  49  core/connectors/who.js -> P-L3_06, P-L3_08
port row  49  core/connectors/who.test.js -> P-L3_06, P-L3_08
port row  49  lib/connectors/attachments.js -> P-PR_02, P-L3_06, P-L3_07
port row  49  lib/connectors/attachments.test.js -> P-PR_02, P-L3_06, P-L3_07
port row  49  lib/connectors/auth.js -> P-PR_02, P-L3_06, P-L3_07
port row  49  lib/connectors/auth.test.js -> P-PR_02, P-L3_06, P-L3_07
port row  49  lib/connectors/behalf.js -> P-PR_02, P-L3_06, P-L3_07
port row  49  lib/connectors/calendar.js -> P-PR_02, P-L3_06, P-L3_07
port row  49  lib/connectors/calendar.test.js -> P-PR_02, P-L3_06, P-L3_07
port row  49  lib/connectors/connect.js -> P-PR_02, P-L3_06, P-L3_07
port row  49  lib/connectors/connect.test.js -> P-PR_02, P-L3_06, P-L3_07
port row  49  lib/connectors/google.js -> P-PR_02, P-L3_06, P-L3_07
port row  49  lib/connectors/imap.js -> P-PR_02, P-L3_06, P-L3_07
port row  49  lib/connectors/imap.test.js -> P-PR_02, P-L3_06, P-L3_07
port row  49  lib/connectors/message.js -> P-PR_02, P-L3_06, P-L3_07
port row  49  lib/connectors/message.test.js -> P-PR_02, P-L3_06, P-L3_07
port row  49  lib/connectors/oauth.js -> P-PR_02, P-L3_06, P-L3_07
port row  49  lib/connectors/oauth.test.js -> P-PR_02, P-L3_06, P-L3_07
port row  49  lib/connectors/push.js -> P-PR_02, P-L3_06, P-L3_07
port row  49  lib/connectors/push.test.js -> P-PR_02, P-L3_06, P-L3_07
port row  49  lib/connectors/testing/fake-google.js -> P-PR_02, P-L3_06, P-L3_07
port row  49  lib/connectors/testing/fake-graph.js -> P-PR_02, P-L3_06, P-L3_07
port row  49  lib/connectors/testing/fake-imap.js -> P-PR_02, P-L3_06, P-L3_07
port row  49  lib/connectors/testing/fake-oauth.js -> P-PR_02, P-L3_06, P-L3_07
port row  49  records/connectors/connection.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L3_07, P-L8_09
port row  49  records/connectors/connection.test.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L3_07, P-L8_09
port row  49  records/connectors/format.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L3_07, P-L8_09
port row  49  records/connectors/format.test.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L3_07, P-L8_09
port row  49  records/connectors/gmail/declaration.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L3_07, P-L8_09
port row  49  records/connectors/google-calendar/declaration.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L3_07, P-L8_09
port row  49  records/connectors/import-spec.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L3_07, P-L8_09
port row  49  records/connectors/import-spec.test.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L3_07, P-L8_09
port row  49  records/connectors/index.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L3_07, P-L8_09
port row  49  records/connectors/mapper.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L3_07, P-L8_09
port row  49  records/connectors/mapper.test.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L3_07, P-L8_09
port row  49  records/connectors/site.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L3_07, P-L8_09
port row  49  records/connectors/site.test.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L3_07, P-L8_09
port row  49  records/connectors/stripe/declaration.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L3_07, P-L8_09
port row  49  records/connectors/stripe/stripe.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L3_07, P-L8_09
port row  49  records/connectors/stripe/stripe.test.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L3_07, P-L8_09
port row  48  core/artifacts/artifacts.test.js -> P-L8_01
port row  48  core/artifacts/backup.test.js -> P-L8_01
port row  48  core/artifacts/draw.test.js -> P-L8_01
port row  48  core/artifacts/draw/chart.js -> P-L8_01
port row  48  core/artifacts/draw/deck.js -> P-L8_01
port row  48  core/artifacts/draw/diagram.js -> P-L8_01
port row  48  core/artifacts/draw/style.js -> P-L8_01
port row  48  core/artifacts/draw/svg.js -> P-L8_01
port row  48  core/artifacts/draw/theme.js -> P-L8_01
port row  48  core/artifacts/frame-csp.test.js -> P-L8_01
port row  48  core/artifacts/index.js -> P-L8_01
port row  48  core/artifacts/media.js -> P-L8_01
port row  48  core/artifacts/media.test.js -> P-L8_01
port row  48  core/artifacts/module.json -> P-L8_01
port row  48  core/artifacts/probe.js -> P-L8_01
port row  48  core/artifacts/probe.test.js -> P-L8_01
port row  48  core/artifacts/render.js -> P-L8_01
port row  48  core/artifacts/share-server.js -> P-L8_01
port row  48  core/artifacts/share-server.test.js -> P-L8_01
port row  48  core/artifacts/store.js -> P-L8_01
port row  48  core/artifacts/testing/sandbox-chrome.mjs -> P-L8_01
port row  48  core/artifacts/testing/sandbox-ios.mjs -> P-L8_01
port row  48  core/artifacts/testing/sandbox-safari.mjs -> P-L8_01
port row  48  core/artifacts/testing/sandbox-server.mjs -> P-L8_01
port row  48  core/artifacts/testing/sandbox-verify.mjs -> P-L8_01
port row  48  core/artifacts/testing/sandbox-verify.test.js -> P-L8_01
port row  48  core/publish/builder-plan.js -> P-L7b_04, P-L8_01
port row  48  core/publish/index.js -> P-L7b_04, P-L8_01
port row  48  core/publish/module.json -> P-L7b_04, P-L8_01
port row  48  core/publish/publish.test.js -> P-L7b_04, P-L8_01
port row  48  lib/publish/certs.js -> P-PR_02
port row  48  lib/publish/certs.test.js -> P-PR_02
port row  48  lib/publish/deployment.js -> P-PR_02
port row  48  lib/publish/deployment.test.js -> P-PR_02
port row  48  lib/publish/dockerfile.js -> P-PR_02
port row  48  lib/publish/domains.js -> P-PR_02
port row  48  lib/publish/domains.test.js -> P-PR_02
port row  48  lib/publish/edge.js -> P-PR_02
port row  48  lib/publish/edge.test.js -> P-PR_02
port row  48  lib/publish/flow.js -> P-PR_02
port row  48  lib/publish/flow.test.js -> P-PR_02
port row  48  lib/publish/folder-build.js -> P-PR_02
port row  48  lib/publish/folder-build.test.js -> P-PR_02
port row  48  lib/publish/grants-kernel.test.js -> P-PR_02
port row  48  lib/publish/grants.js -> P-PR_02
port row  48  lib/publish/hostname.js -> P-PR_02
port row  48  lib/publish/index.js -> P-PR_02
port row  48  lib/publish/index.test.js -> P-PR_02
port row  48  lib/publish/join.js -> P-PR_02
port row  48  lib/publish/join.test.js -> P-PR_02
port row  48  lib/publish/outputs.js -> P-PR_02
port row  48  lib/publish/outputs.test.js -> P-PR_02
port row  48  lib/publish/proxy.js -> P-PR_02
port row  48  lib/publish/repo-source.js -> P-PR_02
port row  48  lib/publish/runner.js -> P-PR_02
port row  48  lib/publish/runner.test.js -> P-PR_02
port row  48  lib/publish/secrets.js -> P-PR_02
port row  48  lib/publish/secrets.test.js -> P-PR_02
port row  48  lib/publish/server-folder.js -> P-PR_02
port row  48  lib/publish/server-folder.test.js -> P-PR_02
port row  48  lib/publish/site-write.js -> P-PR_02
port row  48  lib/publish/site-write.test.js -> P-PR_02
port row  48  lib/publish/test-kit.js -> P-PR_02
port row  48  lib/publish/tunnel.js -> P-PR_02
port row  48  lib/publish/tunnel.test.js -> P-PR_02
port row  48  lib/publish/util.js -> P-PR_02
port row  48  lib/siteops/apilearn.js -> P-PR_02, P-L8_01
port row  48  lib/siteops/build.js -> P-PR_02, P-L8_01
port row  48  lib/siteops/classify.js -> P-PR_02, P-L8_01
port row  48  lib/siteops/classify.test.js -> P-PR_02, P-L8_01
port row  48  lib/siteops/codec.js -> P-PR_02, P-L8_01
port row  48  lib/siteops/codec.test.js -> P-PR_02, P-L8_01
port row  48  lib/siteops/extract.js -> P-PR_02, P-L8_01
port row  48  lib/siteops/extract.test.js -> P-PR_02, P-L8_01
port row  48  lib/siteops/fixtures.js -> P-PR_02, P-L8_01
port row  48  lib/siteops/heal.js -> P-PR_02, P-L8_01
port row  48  lib/siteops/htmlparse.js -> P-PR_02, P-L8_01
port row  48  lib/siteops/htmlread.js -> P-PR_02, P-L8_01
port row  48  lib/siteops/htmlread.test.js -> P-PR_02, P-L8_01
port row  48  lib/siteops/kit-benchmark.test.js -> P-PR_02, P-L8_01
port row  48  lib/siteops/kits.test.js -> P-PR_02, P-L8_01
port row  48  lib/siteops/kits/linkedin.js -> P-PR_02, P-L8_01
port row  48  lib/siteops/learn.js -> P-PR_02, P-L8_01
port row  48  lib/siteops/learn.test.js -> P-PR_02, P-L8_01
port row  48  lib/siteops/outbound.js -> P-PR_02, P-L8_01
port row  48  lib/siteops/outline.js -> P-PR_02, P-L8_01
port row  48  lib/siteops/page.js -> P-PR_02, P-L8_01
port row  48  lib/siteops/page.test.js -> P-PR_02, P-L8_01
port row  48  lib/siteops/pickfields.js -> P-PR_02, P-L8_01
port row  48  lib/siteops/redact.js -> P-PR_02, P-L8_01
port row  48  lib/siteops/replica/professional-network.js -> P-PR_02, P-L8_01
port row  48  lib/siteops/run.js -> P-PR_02, P-L8_01
port row  48  lib/siteops/run.test.js -> P-PR_02, P-L8_01
port row  48  lib/siteops/spec.js -> P-PR_02, P-L8_01
port row  48  lib/siteops/store.test.js -> P-PR_02, P-L8_01
port row  51  records/README.md -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L8_09
port row  51  records/basic-types.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L8_09
port row  51  records/calendar/declared-call.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L8_09
port row  51  records/calendar/google.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L8_09
port row  51  records/calendar/sync.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L8_09
port row  51  records/calendar/sync.test.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L8_09
port row  51  records/comms/log-flow.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L8_09
port row  51  records/comms/log-flow.test.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L8_09
port row  51  records/comms/log.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L8_09
port row  51  records/comms/log.test.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L8_09
port row  51  records/comms/migrate.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L8_09
port row  51  records/comms/migrate.test.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L8_09
port row  51  records/core-types.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L8_09
port row  51  records/host.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L8_09
port row  51  records/ids.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L8_09
port row  51  records/ids.test.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L8_09
port row  51  records/kit-adapter.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L8_09
port row  51  records/kits/base.test.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L8_09
port row  51  records/kits/base/kit.json -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L8_09
port row  51  records/kits/base/kit.ts -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L8_09
port row  51  records/kits/estate-planning/kit.json -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L8_09
port row  51  records/kits/estate-planning/kit.ts -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L8_09
port row  51  records/kits/law-firm/kit.json -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L8_09
port row  51  records/kits/law-firm/kit.ts -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L8_09
port row  51  records/kits/law-firm/project-templates/estate-plan.json -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L8_09
port row  51  records/kits/library.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L8_09
port row  51  records/kits/library.test.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L8_09
port row  51  records/language/cli.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L3_05, P-L8_09
port row  51  records/language/compile.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L3_05, P-L8_09
port row  51  records/language/compile.test.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L3_05, P-L8_09
port row  51  records/language/errors.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L3_05, P-L8_09
port row  51  records/language/expr.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L3_05, P-L8_09
port row  51  records/language/fuzz.test.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L3_05, P-L8_09
port row  51  records/language/parse-worker.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L3_05, P-L8_09
port row  51  records/language/parse.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L3_05, P-L8_09
port row  51  records/language/print.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L3_05, P-L8_09
port row  51  records/language/sdk.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L3_05, P-L8_09
port row  51  records/seed-views.test.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L8_09
port row  51  records/task-upgrade.test.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L8_09
port row  51  records/testing/fake-google.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L8_09
port row  51  records/testing/fake-stripe.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L8_09
port row  51  records/testing/gateway-lite.js -> P-PR_24, P-PR_25, P-PR_26, P-PR_27, P-PR_28, P-PR_29, P-PR_30, P-PR_31, P-PR_32, P-L8_09
port row  54  core/appmods/browser-probe.cjs -> P-L8_07
port row  54  core/appmods/catalog/documents.json -> P-L8_07
port row  54  core/appmods/catalog/documents.kit.json -> P-L8_07
port row  54  core/appmods/catalog/documents.kit.ts -> P-L8_07
port row  54  core/appmods/catalog/docuseal-bootstrap.rb -> P-L8_07
port row  54  core/appmods/catalog/pdf.json -> P-L8_07
port row  54  core/appmods/docuseal-live.test.js -> P-L8_07
port row  54  core/appmods/domain-tools.js -> P-L8_07
port row  54  core/appmods/domains.js -> P-L8_07
port row  54  core/appmods/domains.test.js -> P-L8_07
port row  54  core/appmods/helper-driver.js -> P-L8_07
port row  54  core/appmods/helper-driver.test.js -> P-L8_07
port row  54  core/appmods/host-plan.js -> P-L8_07
port row  54  core/appmods/host-plan.test.js -> P-L8_07
port row  54  core/appmods/host-pub.js -> P-L8_07
port row  54  core/appmods/host-pub.test.js -> P-L8_07
port row  54  core/appmods/index.js -> P-L8_07
port row  54  core/appmods/manifest.js -> P-L8_07
port row  54  core/appmods/manifest.test.js -> P-L8_07
port row  54  core/appmods/module.json -> P-L8_07
port row  54  core/appmods/module.test.js -> P-L8_07
port row  54  core/appmods/outside-signer.live.test.js -> P-L8_07
port row  54  core/appmods/pdf-app-live.test.js -> P-L8_07
port row  54  core/appmods/presence.test.js -> P-L8_07
port row  54  core/appmods/proxy.js -> P-L8_07
port row  54  core/appmods/proxy.test.js -> P-L8_07
port row  54  core/appmods/published-live.test.js -> P-L8_07
port row  54  core/appmods/published.js -> P-L8_07
port row  54  core/appmods/published.test.js -> P-L8_07
port row  54  core/appmods/runtime.js -> P-L8_07
port row  54  core/appmods/runtime.test.js -> P-L8_07
port row  54  core/appmods/signing.js -> P-L8_07
port row  54  core/appmods/signing.test.js -> P-L8_07
