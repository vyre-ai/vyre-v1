# Frozen capabilities (Freeze review A, P-PR_34)

Review of the merged capability registry at the F11 freeze. `packages/contracts/tests/frozen-capabilities.test.ts` checks the rules in this file and the snapshots it describes. A deliberate change to the registry updates this file in the same commit, signed by the lead.

## Frozen values

The contract of every capability is frozen in `docs/frozen/snapshots/<manifest>.json`: one small file per manifest, one line per capability (`name@version`) holding the sha256 of its canonical definition with shared schemas resolved (`lib/snapshot.ts`). The regen bot writes the files with `node tools/gen/src/cli.ts --snapshots`; the test fails on a missing, changed or stray file and names the capability. There is no registry-wide hash, count or per-lane table here on purpose: each of those changed with every contract change, so every contract PR conflicted with every other. Two PRs that change different manifests now merge in either order with nothing to re-record.

## Completeness (all capabilities, checked by the test)

- Every capability has an input schema, an output schema, at least one example, at least one declared error, an effects value (read, write or outward) and a level.
- Permission is a catalogue key or null (grant-only); both are valid, null means the grant level alone decides.
- Every outward capability has a gate; 47 of them use `gate.act = none` and each of those carries a written reason.
- Every capability with idempotency `key` has an `idempotencyKey` in its input (through `$ref` where the schema is shared).
- Every capability has exactly one example, so no capability is unexemplified.

## Sample read at the freeze

At the F11 freeze the lead read 10 percent of each lane's capabilities (sorted by name, every n-th). The findings below come from that read. The sample lists are not kept: they went stale with the first contract change and the completeness rules above are what the test enforces.

## Findings from reading the sample

Nothing blocks the freeze. The sample read cleanly: summaries match the declared effects, outward capabilities carry gates that match their risk (send, post, pay, delete, push_protected), and error lists are non-empty with permission codes on guarded calls. Points for the owning lane to confirm before its first build packet, none of which change a count or the hash:

- L7a writes with level `view` and no permission (`devices.revoke`, `spaces.leave`, `stars.toggle`, `identity.totp_begin`, `identity.passkey_remove`) act on the caller's own objects. Confirm the resource binding resolves to the caller, so the grant check cannot be satisfied by another person's object.
- `access.requests.decline` has no permission and level `view`. Confirm the handler requires the request's approver, since the registry alone does not.
- `governance.tombstones.reapply` is described as a system call and has no permission. Confirm its caller restriction or keep it out of the HTTP and MCP surfaces.
- `runs.undo` has risk `high` and no gate. Undo replays inverse writes, so confirm it never reverses an outward effect (the preview capability `runs.preview_undo` says what it cannot undo).
- 39 capabilities carry a gate while their effects are `write`, for example `mail.domain.remove` and `network.server_remove` (gate `delete`). This is intended: the gate applies to destructive inward writes too.



## 12 Nov 2026: threads.remove_agent is audited always (lane f-revoke)

`threads.remove_agent@1` now has `audit: 'always'`, as `threads.outside_agent.remove` has. Nothing else in its contract changed: same input, output, level, permission, events and errors. Why: since the f-revoke round, taking an agent out of a chat also takes back, as the host, every grant that chat gave it, whoever gave it; the Console's audit log must show who took that access away, as it already does for an outside agent. Snapshot: docs/frozen/snapshots/chat.json, regenerated with `node tools/gen/src/cli.ts --snapshots`.

## 12 Nov 2026: the computer tools bind to the calling agent when the id is left out

- What changed: the resource binding of the 22 `computers.chrome.*` tools, the 8 `computers.screen.*` tools and the 5 `computers.files.*` tools on an agent's computer gains `self: 'agent'` (`local()` in `manifests/computers.ts`, `orSelf: true`). An agent that leaves `computerId` out is bound to its own computer or Space browser. No input, output, permission, level or error changed; only `docs/frozen/snapshots/computers.json` moved.
- Why: every real agent call that left the optional id out was refused before its handler ("/computerId: the id is missing") in rc.24 and rc.25, so an agent could not use its own browser or computer without naming it.
- What the gateway does with such a call (`host/src/routes/resource.ts`): the chat answer check and the audit row name what it reaches (the asker's own Chrome, the agent's browser profile, or the agent's own computer), the handler asks `computers.use` on the agent's computer, and a person who leaves the id out is told to pass it.

Signed: lead, 12 Nov 2026

## 12 Nov 2026: Vault keys go only to approved hosts (lane f-auto)

- 12 Nov 2026, lane f-auto: `automations.try_read` is now held (gate `send`, when `automations.key_host_unapproved(input)`, risk medium, error `permission.needs_approval`): an agent's test read that would send a Vault key to a host nobody approved for that item waits for a person (Allow, Always allow, Deny). New `automations.key_hosts.list`, `automations.key_hosts.allow` and `automations.key_hosts.remove`: the hosts approved per Vault item (table `automations_key_hosts`, migration 0013). Signed: lead, 12 Nov 2026.
- 12 Nov 2026, lane f-auto, second look: `automations.key_hosts.pending` and `automations.key_hosts.pending_bind` (what a held read or binding would send, read by the server for the card); `connections.create` and `connections.set_secret` are held (gate `send`, when `automations.bind_hosts_unapproved(input)`, error `permission.needs_approval`) when an agent binds a key to hosts not approved for it. `automations.vault_usage` gains an optional `hidden` count. Signed: lead, 12 Nov 2026.
- 13 Nov 2026, lane f-auto: `automations.vault_usage` steps gain an optional `blocked` line (the step's key may no longer go to its host); `automations.key_hosts.list` hosts gain `usedBy` and an optional `hidden` count; the schedule trigger's payload gains an optional `previousScheduledFor`; the web request trigger's title is "A web request arrives". Signed: lead, 12 Nov 2026.

## 12 Nov 2026: access.grants.update may emit grant.revoked, and access.unshare may emit grant.updated (lane f-revoke)

12 Nov 2026: access.grants.update may emit grant.revoked and access.unshare may emit grant.updated, because a record share's folder copy follows in the same call (lane f-revoke). Lowering a share on a record drops its copy on the record's folder when the person keeps no level there (`grant.revoked`), and taking one of several record shares away lowers the copy to what is left (`grant.updated`). Nothing else in either contract changed: same input, output, level, permission and errors; the events carry their own declared payloads.

Signed: lead, 12 Nov 2026

## 12 Nov 2026: the Space browser's slots, reopen notice and member takeover (lane f-sbrowser)

Changed contracts, all in `manifests/computers.ts`; no capability was added or removed, and no version moved, because every change is an optional output field or a looser permission the handler still checks:

- `computers.browser.profiles@1`: the output gains an optional `slots { running, limit, waiting }`, for one quiet line in Console > Computers (how many browsers run on this server, how many it runs at once, how many calls wait for one). A tool refusal from the Space browser may now carry the reason `browser_full` (every browser on the server is in use; the call waited its turn and was not served within 5 minutes).
- Every `computers.chrome.*` tool except `batch`: the output gains optional `reopened` and `note`, set once on the first answer after the agent's browser was reopened (closed to make room, or stopped when idle) and its pages reloaded. An act on refs from a snapshot taken before is refused with the reason `browser_reopened` until a new snapshot.
- `computers.chrome.type@1` and `computers.chrome.send@1` gain the optional `downloads` output the other acting tools already had. In `downloads`, `fileId` is now optional and a `note` says why a download too large to move is not in Files.
- `computers.browser.take_over@1`, `give_back@1` and `sign_out@1` ask for `computers.watch` instead of `computers.take_over`. The Space browser's own rule still decides who may (sbrowser/policy.ts: a personal agent's browser is its owner's, a team agent's its owner's and the admins'), so a plain member can take over their own Assistant's browser. This was decided in the review round of 12 Nov (audit B6).

One consequence, called out by the reviewer: the `computers.take_over` role toggle no longer governs taking over an agent's Space browser. The browser's own policy does: its owner, and the admins for a team agent. The toggle still governs agent computers (the app's Computer tab gates Take over on it, and the catalogue calls it "Take over an agent computer"); no screen shows it as governing browsers.

Signed: lead, 12 Nov 2026 (all of the above: slots, browser_full, reopened and note on chrome outputs, downloads on type and send with fileId optional and a note, take_over, give_back and sign_out on computers.watch with the browser's policy deciding)

Added on the reviewer's seventh look and signed below: `computers.browser.take_over@1` gains an optional output `note`, one line for the pane when the browser was reopened since the person last saw it and its page was reloaded; and acts on the page (`click`, `act`, `type`, `fill`, `send`, `api`, `eval`) may now be refused with the reason `browser_reopened` until the agent has seen the reloaded page.

Signed: lead, 12 Nov 2026 (the optional note on computers.browser.take_over, and the browser_reopened refusal on acts)

## 12 Nov 2026: notifications.send narrows the agent tool's kinds (lane f-notify, paragraph added by lane f-trust)

The hash of `notifications.send@1` changed from 4274fa4300adf0432f0d36182549c6e83f4df16f52880bc20ca874d66fd9f1d0 to 7e92d4bebba03ae2536cbd528ddb29d7d150d12ba8cd75ed70ae70df6a62490d in commit 9bc1392c8. The manifest gained `surfaces.agent.only`, a generator option that cuts one enum on the agent's tool only: an agent may send only the kinds about it talking to someone (dm, mention, item.shared, agent.task_finished). The capability itself is unchanged: the same input, output, level, permission, events and errors, and module code still sends every kind. Why: the other kinds come from Vyre and its modules, so the agent's tool should not offer them; the server refuses them anyway (SENDABLE_KINDS in modules/notifications/handlers/rules.ts). The lane f-trust change that makes a forwarded call (a stored schedule, a template step, a Kit step) count as its caller's own call touches no manifest and no snapshot. Snapshot: docs/frozen/snapshots/notifications.json, regenerated with `node tools/gen/src/cli.ts --snapshots`.

## 12 Nov 2026: an Automation's runs-as person, and its read (lane f-vaultuse)

Changed contracts, all in `manifests/automations.ts`; no version moved, because every change is an optional output field, a new read, a new event, or an event a write may now also emit:

- The automation row (every capability that returns one: `automations.get@1`, `list`, `create`, `update`, `set_enabled`, `promote`, `restore_version`, `move`, `make_personal_copy`, `undelete`, `set_owner`, `templates.use`, `packages.import`) gains an optional `runsAs`: for a Space automation, the person whose yes its agent work runs on (who last turned it on, published a change to it while on, restored a version while on, or put it on the Space, by their own press); absent when nobody has.
- New read `automations.runs_as.get@1` `{ automationId, agentId?, runId? }` -> `{ kind, runsAs?, name?, trigger?, ok, reason?: nobody | not_active | assistant, line? }`, level view on the automation: whose yes the automation's agent work runs on now, and why not when it cannot.
- New event `automation.runs_as_changed` `{ automationId, from, to, by, why: on | save | restore | promote | cleared }`, retention audit.
- `automations.update@1`, `automations.set_enabled@1`, `automations.restore_version@1` and `automations.promote@1` may now also emit `automation.runs_as_changed`, when the call moves the runs-as person.

The fix that lets an outside-started Run finish (an agent's own reports on its own task in Ask first) changed no contract: it is a host rule in the invoke pipeline.

Holds from an Automation's outside-started Run (no capability contract changed): the host holds, with Gate act `approve`, the capabilities in `lib/automation-content.ts` `HELD_FROM_AUTOMATION_CONTENT` (giving someone access: shares, grants, groups, roles, invites, join links, adding people or agents to a chat or channel, outside reviewers, portal, webhooks, publishing; keeping words for later: automations, starting another Automation's Run, agents and their instructions, Routines, watches, goals, hooks, skills, plugins, installs from a link) when an agent calls one at the top of a call in a thread whose chain carries an uncleared Automation-origin mark (`automation:<id>:<trigger>:<person>`, written on an outside-started Run's task thread and carried only to a thread its agent makes from there with a call in `CARRIES_MARK` (a task, helper, crew job, chat or channel), never to a thread a read names). A Run is from outside unless its trigger is schedule, manual or button (`INTERNAL_TRIGGERS`), and a manual or button Run an agent starts (`automations.run` by an agent: origin `agent:<id>`) is from outside too. A read never replaces an uncleared Automation mark. Ordinary chats, marked by a page the agent read or not, and every person's own call, behave as in rc.25; the holds apply only in a thread carrying an Automation-origin mark. test/automation-content.test.ts checks each listed name is a capability with its own hold words.

Signed: lead, 12 Nov 2026

## 12 Nov 2026: the computers.chrome.* snapshot after two signed changes met (lead, at the merge)

The hashes of the twenty-two `computers.chrome.*@1` capabilities in `docs/frozen/snapshots/computers.json` were written again at the merge of lanes f-desktop and f-wire into int/rc25. Each lane's own change is described and signed in its paragraph above (the browser tools an agent may call without naming its computer, and the reopen refusal with the optional note on take_over); neither changed after review. The two changes touch the same capabilities, so the hash of the merged manifest is new and neither lane's snapshot matched it. No field, version or behaviour beyond those two signed changes is in this snapshot; it was regenerated on the build box with `node tools/gen/src/cli.ts --snapshots`.

## 12 Nov 2026: the "Maya is not in this chat." line and one name for an Assistant (lane f-ownerwalk)

What changed:
- `threads.members.add@1` gains an optional `mentionedIn` (a message id) and may emit `message.mentioned`. Nothing else in it changes. With `mentionedIn`, the message must be in that thread and must mention the person with a chip (`chat_mention`); the person reads from that message on and is told about it like any mention.
- `channels.members.add@1` gains the same optional `mentionedIn` (review M3). The message must be in the channel or a reply thread under it and must mention each person added. It emits nothing new: a channel is not private, so `chat.post` already told the people its chips name, member or not, and Add does not tell them twice.
- The chat message row gains an optional `mentions` (review M4): the message's own chips as `chat.post` kept them, each `{ kind, id }` of a person or agent named in it. It holds ids only, no names or other display data, and only on a message the caller may already read; `chat.messages.list` fills it. Every capability that answers that row changes its hash for this field alone.
- The access principal row gains an optional `assistant`: a flag (`true`), never a person. It is set only on someone else's private agent that is their Assistant, a row whose `owner` the caller already gets, so it names nobody the caller cannot see. With it the agent is named "Maya’s Assistant" everywhere, never "Maya Lin (Agent)" (lead, 12 Nov). Every capability that answers that row changes its hash for this field alone.

All four changes are additive and optional; nothing existing changes shape.

Why: the owner's line "Maya is not in this chat." with Add under the sender's message (owner, 12 Nov 2026), its review (M2 to M4), and the lead's rule of one name for a person's Assistant.

Signed: lead, 12 Nov 2026

## 12 Nov 2026: the automations snapshot after two signed changes met (lead, at the merge)

The hashes in `docs/frozen/snapshots/automations.json` were written again at the merge of lane f-auto into int/rc25, which already held lane f-vaultuse. Each lane's own contract change is described and signed in its paragraph in this file (f-vaultuse: the runs-as field, `automations.runs_as.get@1`, `automation.runs_as_changed`; f-auto: the key-host capabilities `automations.key_hosts.*` and the held test read). Both touch `manifests/automations.ts`, so the merged manifest's hashes are new and neither lane's snapshot matched. Nothing beyond those two reviewed changes is in this snapshot; it was regenerated on the build box with `node tools/gen/src/cli.ts --snapshots`.

## 12 Nov 2026: previews.get, previews.pages and previews.text may emit preview.ready and preview.failed (lane f-revoke)

`previews.get@1`, `previews.pages@1` and `previews.text@1` now declare `emits: ['preview.ready', 'preview.failed']`. The first read of a file version whose preview was never made renders it inline and announces the result, as `previews.render` does; an undeclared event was refused at run time, so that first read answered 500 "event not declared in emits". Nothing else in their contracts changed: same input, output, level, permission and errors; the events carry their own declared payloads.

Signed: lead, 12 Nov 2026

## 12 Nov 2026: read_link and read_docs say an agent may open any public link (lane f-wire)

- What changed: the summaries of `automations.read_link@1` and `automations.read_docs@1`, the words the model reads (r-wire's Pass 11 wording, fitted to the 300-character summary limit). They say what the fetch is (https, GET, no key or cookies, public hosts), that the agent may open any link it needs, even one it puts together, that in work an Automation started from outside such a link waits for the person's OK, and that a page's text is data: never followed, and chat content never put into a link. Input, output, gate (`act: send`, `when: links.is_composed(input.url)`), level, permission and errors are unchanged; only `docs/frozen/snapshots/automations.json` moved.
- Why: the gate's rule changed for rc.26 (modules/gate/handlers/grants.ts linksKnown: a composed link is held only under an uncleared Automation mark). The old words, "a link you put together yourself waits for the person", told the model to avoid composing links or to ask first, the opposite of the owner's rule that agents may open any link.

Signed: lead, 12 Nov 2026

12 Nov 2026, lane f-term (eighth look Y1): `engine.turn.record@1` gains an optional input `reason`, why a cancelled turn was stopped, as the turn engine says it (stop, interrupt, limit, left, moved; closing when a daemon stops or updates and the turn is run again after the restart; lease when its host was lost); `modules/engine/runtime.ts` report() passes it. The event `turn.cancelled` gains two optional fields: `reason` (on the turn's end record, the same value) and `pressed` (true when written at the press: Stop, Interrupt, a released parked turn, an agent paused, removed or leaving). The terminal module interrupts a turn's running command only for `pressed`, or for a stop reason on the end record; never for closing or lease, and never for an event with neither. Optional additions only: older readers and writers are unchanged.

Signed: lead, 12 Nov 2026 (the optional reason on engine.turn.record and on turn.cancelled, and pressed on turn.cancelled)

12 Nov 2026, lane f-term (ninth look Z2): `engine.stop_all@1` gains an optional input `reason`, the one value `update`, which the desktop app passes when it stops its turns to update itself (host/src/daemon/daemon.ts engineSource.stopTurns). Its turns end with reason update and their `turn.cancelled` events carry `reason: "update"` instead of `pressed`, so the terminal leaves what they run in an agent's workspace running (the workspace outlives the app; the kept message runs again after). A person's Stop all is unchanged. Optional addition only.

Signed: lead, 12 Nov 2026 (the optional reason update on engine.stop_all)

## 12 Nov 2026: engine.step_turn may fail with validation.precondition_failed when the account needs a model and the step has none (lane f-auto)

`engine.step_turn@1` now lists `validation.precondition_failed` among its errors, with reason `no_model`. When the API driver refuses a turn for a missing model (`engine.no_model`, on open or mid-turn), the step fails with "This AI step has no model. Give it an agent that has a model, or set a model on its agent." It used to fail as `provider.unavailable`, "The AI provider could not answer this step." Nothing else changes: no new check at save or turn-on, and no new model source. A subscription keeps running on its CLI's own default. Additive: one more declared error.

Signed: lead, 12 Nov 2026

## 12 Nov 2026: automations.vault_usage `blocked` description reworded (lane f-auto)

The description of the optional `blocked` line on `automations.vault_usage` steps now reads "a host not allowed for it" instead of "a host no longer allowed for it". The line itself (key-run.ts) is now one neutral sentence for a host that was removed and one never approved: "#Key is not allowed to go to <host>. Allow it on the key's page, or change this step." Description only: no field, type or error changes.

Signed: lead, 12 Nov 2026

## 13 Nov 2026: computers.chrome.screenshot answers pageWidth, pageHeight and scale (lane f-computer)

`computers.chrome.screenshot@1` gains three optional answer fields, added to the output only (no input and no existing field changes): `pageWidth` and `pageHeight` (integers, the page's size in page pixels) and `scale` (a number, picture pixels per page pixel). `pageHeight` is the whole page's height even when the picture shows only its top part. They are present only when the picture is not the page as it is: a screenshot over the 256 KB limit for a picture kept in Files is scaled down to fit, and a page taller than 4096 px comes back as its top part. `width` and `height` stay the picture's own size, and the existing optional `note` now says in one sentence that `chrome_click`'s x and y are in page pixels (a point on the picture is multiplied by 1 / scale). Before this, such a screenshot failed with `validation.too_large`.

Signed: the lead, 13 Nov 2026

## 13 Nov 2026: notifications.unseen_by_thread is added (lane b-side), for the lead to sign

- What changed: one new read, `notifications.unseen_by_thread@1` (module notifications, level member, tool meta). Input `{ threadIds?: thread[] (at most 200) }`; output `{ counts: [{ threadId, mentions >= 1 }], capped: bool }`. Additive: no existing capability, event or kind changed. Snapshot: `docs/frozen/snapshots/notifications.json`, regenerated with `node tools/gen/src/cli.ts --snapshots`.
- Why: the Chats sidebar shows a mention count on a row, and no read carried it (a mention reached only the rail). The read answers the caller's OWN unseen mention notifications (kinds mention and mention.thread) grouped by thread, newest first, at most 500 threads (`capped` true when there were more; the oldest are left out); it never answers for another person, and it names only threads a notification was filed for the caller about. The sidebar's read joins it onto the chats it already lists, so a thread the caller cannot open is never shown.
- Signed: ______ (lead)

## 13 Nov 2026: chats.presence is added (lane b-side), for the lead to sign

- What changed: one new read, `chats.presence@1` (module chat, tool chats, `team: true` like `devices.presence`). Input `{}`; output `{ people: [{ personId, state: online | away }], working: [{ agentId, threadId?, since }] }`. Additive: no existing capability, event or kind changed. Snapshot: `docs/frozen/snapshots/chat.json`, regenerated with `node tools/gen/src/cli.ts --snapshots`.
- Why: the Chats sidebar draws a presence dot on people and a moving ring on agents that work. Presence changes often, so it is a separate small read and stays out of the sidebar's own answer, which then stays quiet. It composes `devices.presence` and `engine.now`, which already answer as the caller: offline people are left out, a chat is named only when the asker may read it, no title leaves it, and a guest (no team) gets nobody.
- Signed: ______ (lead)

## 14 Nov 2026: chats.sidebar is added (lane b-side), for the lead to sign

- What changed: one new read, `chats.sidebar@1` (module chat, level member, tool chats), also a live query (`side`) of the `chats.sidebar` screen. Input `{ filter?: str (everything, or unread, mentions, working, needs, failed, muted, goals, asks, archived; anything else is refused in plain words), more?: { section, after?, limit? (at most 100) } }`; output `{ needs: { total, items }, goals | pinned | chats | channels | team: { total, rows (first 50), next? }, rail, nextUnread? }`. Additive: no existing capability, event or kind changed. Snapshot: `docs/frozen/snapshots/chat.json`.
- Why: the sidebar made 11 reads on open and drew marks no read carried. This is the one watched answer: per row unread, mentions, working, muted, the caller's pin order, and `failed` plus `failedLine` in words (a code or trace id never). It answers as the caller: pinned and muted are the caller's own; a caller who may not start chats (a guest) gets only the chats and channels they are in, no goals, team or agents. Presence is only in `chats.presence`; a draft is the device's own and never in it.
- The SOURCE of pins and mutes is an internal detail: today the caller's stars (newest first is the order) and the chat module's own mutes behind one port; the per-person state module replaces it with no change of shape. `failed` is false until the engine offers one bulk read of the latest turn per thread (not asked per row).
- Proof: modules/chat/tests/sidebar.read.test.ts pages 5,000 chats by cursor (one read per page; each read asks every neighbour the same number of times; the chat module reads only the page it carries). Speed: modules/chat/tests/sidebar.read.perf.test.ts holds the first page and a later page of a person with 5,000 chats and 200 channels under the `navigate` budget (p95 100 ms) over 50 runs: one read per page, each asking every neighbour the same number of times, none per row.
- Signed: ______ (lead)

## 14 Nov 2026: engine.thread_states is added (lane b-side), for the lead to sign

- What changed: one new read, `engine.thread_states@1` (module engine, tool chats). Input `{ threadIds: thread[] (at most 200) }`; output `{ states: [{ threadId, state: running | waiting | failed | done, failedLine? }] }`. Additive: no existing capability, event or kind changed, and nothing about how turns run. Snapshot: `docs/frozen/snapshots/engine.json`.
- Why: the Chats sidebar marks a chat whose last run stopped. No read gave the latest turn of many chats at once, and one call per row would break the sidebar's "nothing per row" rule. This reads the engine's own table with one grouped query (the turn with the highest queue number per chat). queued counts as running, completed and cancelled as done. `failedLine` is the plain message the turn failed with (or "Something went wrong."), never a code, a trace id or a next-step list.
- Asker rule: a chat has a state only when its latest turn was asked by the caller and the caller may view it; any other chat is absent, the same answer as a chat with no turn, so the read never says a chat exists. (The kernel's view of a chat is wider than who may open it: a private chat's membership is the chat module's own rule, found on a real daemon where a member was told the state of the owner's private chat before this was narrowed.) Tested with two askers and on a booted daemon.
- Signed: ______ (lead)
## 13 Nov 2026: the state module, per-person state on a thing (lane b-state, contract P2 step 0)

- What changed: a new manifest `manifests/state.ts` and snapshot `docs/frozen/snapshots/state.json`. Thirteen capabilities, all new at `@1`: six public (`state.get`, `state.list`, `state.counts`, `state.read`, `state.read_scope`, `state.set`) and seven the host makes itself (`state.arrive`, `state.retract`, `state.merge`, `state.gain`, `state.lose`, `state.forget`, `state.verify`; the handler refuses everyone but `svc_host`). One event, `state.changed` (`vis: owner`; payload person, thing, changed, now and `by`, so an agent's change names the agent). One person setting, `state.agents_may_triage`, default off. The six public capabilities have agent tools `state_get`, `state_list`, `state_counts`, `state_read`, `state_read_scope`, `state_set` in the `meta` toolset, all `deferred` so the default listed toolset stays at 65.
- What did not change: no existing capability, event or entity is touched, and nothing calls the new ones yet. The 18 capabilities and 10 events the contract lists as going are removed in later steps, each with its own dated note. The synced entities `state_person` and `state_count` are declared at the replica step (7), not here.
- Why: P2 (docs: `team/v1/CONTRACTS-2026-11-13/P2-person-state.md`). Read, done, star, follow and mute become one row per person and thing, so one person's read can never clear another's.
- One difference from the contract text: a thing is `{ type, id }` with an open `type`, not a `resourceRef`, because the things that carry state (an Inbox conversation, a notice) are not access resources; each kind of thing says who can see it. A refused agent write answers `permission.no_grant` (the contract's "permission.denied" is not an error code).

- Amended 13 Nov 2026 after the review (lead's ruling 13 Nov 2026; contract P2 section 9), still before signing: the three events are `vis: private` (the Space owner does not read them, and a mute that ended reaches the person it belongs to through a host-only `EmitOpts.onBehalf`); `state.changed` carries the new `state` and `count`; new event `state.scope_read` (one event for a whole badge) and `state.layout_changed`; two new deferred tools `state.layout.get` and `state.layout.set`; `state.set` gains `pin`; `state.list` gains the flags `pinned` and `any` and its rows carry the whole `state`; the stored value gains `pin`. The seven host calls declare `permission.no_grant`. Writes need the person's own press, or their switch `state.agents_may_triage`, on every other door (MCP, engine, service, actor, agent).

Signed: (awaiting the lead)

## 13 Nov 2026: access.connector_builder.status can be asked about one Vault item (lane f-auto2)

- What changed: `access.connector_builder.status@1` takes an optional `itemId` and, when it is given, answers an optional `reaches` (true or false) beside `allowed` and `canGrant`. `reaches` is the access check's own answer for "may this assistant, acting for the caller, use that Vault item": false for an item labelled above the clearance of the assistant or of the person it acts for (a company key, anything Restricted): a grant does not lift a clearance (it is per subject), only a role with a higher one does, which an admin may give an agent. True also when only a share to the assistant is missing and the caller may use the item (one approval away). Nothing else in its contract changed. Snapshot: docs/frozen/snapshots/access.json, regenerated with `node tools/gen/src/cli.ts --snapshots`.
- Why: on rc.26 the Automations first page suggested setting up Google_DWD, and the assistant could not do it (above its clearance, and without the Connector builder role). A suggestion is now shown only when the assistant can finish it, and the Vault row, the first page and the setup press all ask this one question.
- Also moved, not a contract: `modules/automations/tests/golden-replay/golden.json` holds the new words for a step that is missing an input ("Update a record: choose the record."), and `automations.steps.list` lists Google, Microsoft and GitHub steps only for apps connected on the Space that the caller may use (same input and output, fewer rows).

Signed: the lead (Simba), 14 Nov 2026 02:34 PKT, after reading the manifest diff: optional, additive fields only; no input, output or error removed.

## 13 Nov 2026: what a model reads when a tool fails, and `automations.steps.list` gains `all` (lane f-auto2)

- Model-facing error (not a capability contract, but what agents and MCP clients receive): `error.code` is now `error.supportCode`; the object now starts with `say` (a plain sentence and what to do) and `reply` (the rule: tell the person in plain words, no codes unless asked). `message`, `retryable`, `next`, `details` stay. In MCP `structuredContent.error` a `code` twin (the same value as `supportCode`) is kept for machine clients; the text a model reads has only `supportCode`.
- `automations.steps.list@1` takes an optional `all` (boolean): every step the server can run, including apps not connected for the caller, for the editor of an Automation that already holds such a step. Without it the list is filtered to connected apps (the picker and the Assistant). Additive.
- `automations.steps.list@1` also answers an optional `checked` (false only when the Space's connected apps could not be read, so an app missing from the list is unknown rather than unconnected; absent otherwise). Additive.

Signed: the lead (Simba), 14 Nov 2026 02:34 PKT, after reading the manifest diff: optional, additive fields only; no input, output or error removed.

## 14 Nov 2026: a person can take the keyboard of a terminal (lane b-pc)

- What changed: two new capabilities, `terminal.take_over` and `terminal.give_back` (level use, on the terminal; people only, never an agent tool), two new events, `terminal.taken` and `terminal.given_back`, and an optional `heldBy` (the person at the keyboard) on the terminal row that `terminal.list`, `terminal.get`, `terminal.open`, `terminal.open_server`, `terminal.rename` and the new calls answer. While a person holds a terminal, `terminal.run`, `terminal.input` and `terminal.interrupt` from anyone else (the agent included) are refused with one plain sentence (`validation.precondition_failed`, reason `keyboard_held`); the holder's own keys keep the hold in use, and a hold nobody uses for 15 minutes ends by itself. Taking it from another person needs the owner of the terminal or a manager of the agent. A terminal nobody holds takes input as before.
- Why: the owner's drawing of an agent's computer (13 Nov, AGENT-COMPUTER-2026-11-13.md B2, B3, section 11 rules 1 and 4): a person takes the keyboard with one deliberate press, the agent is told and waits, and gives it back. The Space browser already worked this way (`computers.browser.take_over`).
- Snapshots: `docs/frozen/snapshots/terminal.json`, regenerated with `node tools/gen/src/cli.ts --snapshots`. New table `terminal_hold` (`modules/terminal/migrations/0004_hold.sql`, created on first use like the earlier ones).

Signed: pending the lead (lane b-pc did not sign it).

## 14 Nov 2026: three new reads are open to every member, a guest included (lane b-side), for the lead to sign

- What changed: `chats.presence`, `notifications.unseen_by_thread` and `engine.thread_states` were first added at level `view` (the Space's View grant) and are now level `member`, like `chat.recent`, `chats.sidebar` and `channels.list`. They were never released at `view`: no caller outside this branch could have used the old level. Nothing else about the three changed.
- Who gains: a guest, who holds no View on the Space, is no longer refused (before: 403 permission.no_grant, which the sidebar would have shown as a failed section). Who loses: nobody; a principal that held `view` is a member.
- What a guest gets from each, proved with a real guest on a booted daemon (test/chats.sidebar.asker.live.test.ts): `chats.presence` answers no people and no agents at work (it composes `devices.presence` and `engine.now`, which refuse a guest, so each half is empty); `notifications.unseen_by_thread` answers only the guest's own unseen mentions, none when they have none, and never a thread they cannot open (the query is scoped to the asker and names only threads a notification was filed for them about); `engine.thread_states` answers only chats whose latest turn the guest asked and may view, and nothing for the owner's private chat.
- Why refusing was wrong: the sidebar is the first thing a guest sees, and it reads these three on every open; a refusal drew a failed section for the one person who has the fewest things to show.
- Signed: ______ (lead)

## 14 Nov 2026: a note counts its saves, and notes.update can refuse a stale one (lane f-writes, finding F50), for the lead to sign

- What changed: the note row (the output of `notes.create`, `notes.get`, `notes.list`, `notes.update`, `notes.pin`, `notes.label`, `notes.share`, `notes.set_owner`, `notes.restore`, `notes.clip`, `notes.to_task`, `notes.to_record`) gains a required `version` (a whole number from 1, counting the saves of the note, as a task's does). `notes.update` takes an optional `expectedVersion` and lists `validation.version_conflict` among its errors. Snapshot: docs/frozen/snapshots/notes.json. Migration: modules/notes/migrations/0004_note_version.sql adds the column with default 1, so every existing note starts at 1.
- Behaviour: with `expectedVersion` on an older number the update is refused (`validation.version_conflict`, "This note changed after it was read, so this change was not saved. Read the note again and redo the change.") and nothing is written. Without it the update saves, as before, and counts a version. Every save of a note is written only if the note is still on the version it was read at, so a save that waited (for a picture or a link) can no longer write its old copy over a save that landed meanwhile; pin and label, which say what they want and not what the note was, are made again on the newer note instead of being refused.
- Who gains: a caller that sends the version it read is never silently overwritten. Who loses: nobody; no input was removed or made required, and a person's own edit in the app sends no version, so it saves as it did.
- Not changed: agents have no tool that writes a note (`notes_create`, `notes_get` and `notes_search` only), so no agent can lose a note's text this way today; the version is ready for the day one does.
- Signed: ______ (lead)

## 14 Nov 2026: engine.round.get added (lane chat-agents)

- What changed: one new read, `engine.round.get@1` (input: threadId, up to 50 messageIds; output: per message, each agent asked with its state working, waiting (with the agent in front), replied or stopped). Read from the engine's queue, never stored. Thread scope like `engine.live_turns`: only people who may read the chat reach it. Snapshot: docs/frozen/snapshots/engine.json, regenerated with `node tools/gen/src/cli.ts --snapshots`.
- Why: the row under a message that asked more than one agent (who is working, who waits on whom) needs one read that survives a restart; the prototype's round row and the Threads tab (G56, G61) draw from it.

## 14 Nov 2026: chat.round.decide added (lane chat-agents)

- What changed: one new write, `chat.round.decide@1` (input: threadId, messageId, agentId, idempotencyKey; output: the id of the line it leaves). After a message asked several agents and each answered, the person who asked goes with one answer: one quiet "Decided: going with Nova's answer" line (a link card authored by the person), no agent woken. Refused unless the caller is the author of the message and the agent answered after it. Snapshot: docs/frozen/snapshots/chat.json, regenerated with `node tools/gen/src/cli.ts --snapshots`.
- Why: the round table card's "Go with Nova" (G57); the answer line is the record that the round ended.

## 14 Nov 2026: chat.round.discuss added (lane chat-agents)

- What changed: one new write, `chat.round.discuss@1` (input: threadId, messageId, idempotencyKey; output: the thread). After a message asked several agents and at least two answered, the person who asked lets them talk it over: the inline thread under the message gets one message from the person with the answers and a request for one short turn each, ending on a "Decided:" line; the first agent is tagged and tags the next, so the engine's hand-off limits cap it at four turns. It emits `agent.engaged` for agents it brings into the thread. Snapshot: docs/frozen/snapshots/chat.json.
- Why: the round table's "Let them discuss" (G57). It adds no new engine rule: the talk is ordinary turns on the asker's account, bounded by the hand-off limits of 4 Nov.
