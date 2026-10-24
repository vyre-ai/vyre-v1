# Frozen: agent tools (Freeze review D)

ARCH 3.7 output 6 and 6.7. Source of truth: `generated/tool-index.json` and `generated/mcp-tools.json`, written by `tools/gen` from `manifests/`. Test: `packages/contracts/tests/frozen-agent-tools.test.ts`.

## Rules frozen

- A tool exists for every capability with `surfaces.mcp`, plus the 10 `agentTools` that wrap no single capability. Names are snake_case and unique. 14 toolsets: records, files, memory, vault, automations, chats, inbox, sites, terminal, computer, agents, tasks, meta, engineer.
- Agent parity: every capability a principal screen query or action reaches is agent-visible or wrapped by an `agentTools` entry. The generator rejects a manifest that breaks this; the test re-checks it from the manifests (all principal screens, more than 500 references).
- Pre-auth capabilities (anonymous and pending callers, 11 in all) are never agent-visible.
- No capability sets `surfaces.agent: false` today, so there is no opt-out list and `contracts/agent-optout.json` is not needed. 256 principal capabilities have no MCP surface; none is reached by a screen.
- A tool with `deferred: true` is found with `tool_search` and called after its schema is returned. The default listed toolset is the 59 tools below (about 60, plus or minus 5). The `engineer` toolset is never in the default list; it needs `engineer.mcp`.

## Default listed toolset (59 tools)

| Tool | Toolset | Summary |
|---|---|---|
| `schema_describe` | records | Describe one record type or all of them: fields, field types, options, labels, relations |
| `records_query` | records | Query rows of a record type with filter, sort, group and window |
| `records_get` | records | Read one record by id |
| `records_create` | records | Create a record |
| `records_update` | records | Update fields of a record (per-field merge for sync, base version for API callers) |
| `records_bulk_upsert` | records | Create or update many records by match key, quietly (no automations unless asked) |
| `records_history` | records | Field history of a record: previous values and merge losers |
| `records_as_of` | records | Read a record as it was at a time |
| `records_relate` | records | Link two records through a relation field |
| `files_list` | files | List files and folders in a folder or a section (Personal, Shared with me, Space) |
| `files_read` | files | Read the content of a file or one of its versions as text, base64 or a short-lived download address |
| `files_write` | files | Replace the content of a file. In a Review changes folder an agent write lands in a changeset and syncs only on Approve |
| `mounts_add` | files | Mount a Google or SharePoint folder, a folder on your computer or a GitHub repository into a folder of the tree; the first sync is a Run |
| `git_status` | files | Branch, ahead and behind counts, changed files, remotes and whether the branch is protected |
| `git_diff` | files | Working-copy changes against HEAD, or between two commits or branches |
| `git_commit` | files | Commit working-copy changes (all or the given paths); authored by the first editor, person or agent |
| `changesets_get` | files | Read a changeset with its file list and counts |
| `changesets_diff` | files | Hunks of one file inside a changeset, against its recorded base version |
| `memory_search` | memory | Search notes and current facts the asker may read; BM25, vectors and recency; snippets carry the source link |
| `read_note` | memory | Read one memory note as Markdown |
| `facts_as_of` | memory | Facts that were true on a date (valid_from and valid_to), for "what did it believe on 3 March" |
| `memory_propose` | memory | Propose a fact for the asker layer of the agent memory, with its source; low-risk kinds merge on their own |
| `vault_use` | vault | Ask for an item by name: returns a handle like #Dana_Lawmatics and the field names, never values |
| `vault_request` | vault | Ask for a missing key: creates a request task for the managers of the folder (or the Space vault managers) and tells the requester its status |
| `automations_list` | automations | List Automations by section (Personal, Shared with me, Space), folder and Group |
| `automations_create` | automations | Create an Automation; it starts Personal |
| `automations_run` | automations | Run an Automation now with a payload (the manual trigger or a button) |
| `journeys_start` | automations | Start a Journey on a subject record: creates the Journey record with its channel and folder and enters the first stage |
| `chat_post` | chats | Post a message in a thread or channel; routes to the lead agent or @mentioned agents and records mentions |
| `chat_thread` | chats | Open or create the inline thread under a message; an @mentioned agent works inside it |
| `handoff` | chats | Hand work to another agent: opens that agent thread linked from this one, counted against the hop limit |
| `ask_question` | chats | Ask the person a structured question (single, multi or free text); the turn parks until it is answered |
| `plan_propose` | chats | Propose a plan with steps as a plan block; used when plan mode is on |
| `open_tab` | chats | Open a side tab beside the chat for the person (a file, record, diff, terminal); respects the person tab setting and posts a line |
| `mail_message_search` | inbox | Search mail by text, sender, date and mailbox |
| `mail_draft` | inbox | Create or update a draft (an agent draft waits for Send, Edit or Discard with a Gate line) |
| `mail_send` | inbox | Send an email through the single send API: caps per sender, send windows, throttling, suppression, consent, trace id header, agent footer line |
| `calendar_list_events` | inbox | Events in a time range for chosen calendars (Day, Week and Month views) |
| `calendar_create_event` | inbox | Create an event (drag in 15 minute steps); the provider invites attendees |
| `sites_build` | sites | Build the site from its repo (the site agent runs in the repo); test and verify |
| `sites_tables` | sites | List site tables of a site |
| `sites_deploy` | sites | Deploy a build to the always-password-protected staging URL |
| `sites_previews` | sites | List previews (one per branch and pull request, on their own staging address) |
| `sites_promote` | sites | Promote a staging build to production (merges the pull request first when there is one) |
| `terminal_run` | terminal | Run a command in a session and wait for it (the terminal_run tool); secrets only as #Handle.field; output is scrubbed before it returns |
| `terminal_open` | terminal | Open a terminal session on an agent computer or on your own computer (the device daemon) |
| `screen_screenshot` | computer | Screenshot of the whole desktop |
| `screen_click` | computer | Click at screen coordinates |
| `chrome_snapshot` | computer | Read the page as an accessibility tree with element refs; prefer this over screenshots |
| `chrome_act` | computer | Act on an element or key: click, hover, press, select, scroll, check; a send, post or payment is held and returns an id |
| `agents_list` | agents | List agents you are in or that are shared with you (admins may toggle All in the Space) |
| `agents_get` | agents | Read one agent: record, status, limits and the effective configuration |
| `tasks_create` | tasks | Create a task of any kind (Work by default); Approve, Review, Answer and Unblock requests come from the Gate, agents and Journeys |
| `tasks_list` | tasks | List tasks by scope (mine, assigned by me, following, a record, a run) and filters |
| `tasks_update` | tasks | Edit the title, summary, why, due, effort or content blocks of a task (status goes through tasks.transition) |
| `tasks_transition` | tasks | Move a task to a new status (the only writer of status); checks the 4.7 state table and the reviewer/approver rules |
| `tool_search` | meta | Find tools by what you want to do; returns names, summaries and schemas, then the tools are callable |
| `wait_for` | automations | Wait in the background for an event, another Run or a time; ends the turn and wakes the thread on a match (default timeout 30 days) |
| `switch_model` | meta | Switch engine mid-chat: the new engine starts from the rolling summary, the last turns and a pointer to the transcript |

Note: ARCH 6.7 lists `wait_for` under meta; the manifests put it in the automations toolset, and the table follows the manifests.

## Open finding for the lead

The manifests do not yet enforce the default list. In the generated index 1,193 tools exist, 112 are `deferred: true` and 1,081 are listed. ARCH 6.7 wants about 60 listed. Closing the gap means setting `surfaces.mcp.deferred: true` on every tool not in the table above, in each owning lane's manifest (about 1,020 flags), or having the MCP server list only this table and send the rest through `tool_search`. This freeze fixes the list; it does not change any manifest. The second route needs no manifest edits.
