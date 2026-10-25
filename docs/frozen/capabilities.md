# Frozen capabilities (Freeze review A, P-PR_34)

Review of the merged capability registry at the F11 freeze. `packages/contracts/tests/frozen-capabilities.test.ts` reads this file and fails when the registry, the counts or the sample drift from it. A deliberate change to the registry updates this file in the same commit, signed by the lead.

## Frozen values

Registry hash: 389d3f5f0ad52a18d746be37a1dcf4fb92d7cd400c07c8105675b2598e3edcfb
Capabilities: 1500
Events: 602
Registry modules: 80
Host modules: 72

The hash is the sha256 of `generated/registry.json` and equals `generated/hash.txt`. The registry merges 80 manifests (64 module, 12 connector, 4 kit); `host/modules.json` lists 72 of them as host modules.

## Completeness (all capabilities, checked by the test)

- Every capability has an input schema, an output schema, at least one example, at least one declared error, an effects value (read, write or outward) and a level.
- Permission is a catalogue key or null (grant-only); both are valid, null means the grant level alone decides.
- Every outward capability has a gate; 47 of them use `gate.act = none` and each of those carries a written reason.
- Every capability with idempotency `key` has an `idempotencyKey` in its input (through `$ref` where the schema is shared).
- Every capability has exactly one example, so no capability is unexemplified.

## Sample (10 percent of each lane, read)

Selection rule: capabilities of the lane (owner of the module) sorted by name, n = ceil(count / 10), take index floor(i * count / n) for i in 0..n-1. The test recomputes this and compares it with the lists below.

| Lane | Capabilities | Sampled |
|---|---|---|
| L1 | 37 | 4 |
| L2 | 264 | 27 |
| L3 | 152 | 16 |
| L4 | 108 | 11 |
| L5 | 344 | 35 |
| L6 | 163 | 17 |
| L7a | 218 | 22 |
| L7b | 79 | 8 |
| L8 | 120 | 12 |
| L10 | 15 | 2 |

L1: conflicts.assist, conflicts.resolve, search.recent.list, sync.endpoints

L2: agents.builtin_skills.list, agents.pause, agents.snapshot.take, agents.update, channels.join, channels.update, chat.helpers.list, chat.post, chat.transcript.summarize, computers.chrome.inspect, computers.chrome.state, computers.files.read, computers.recording.get, computers.screen.type, computers.timeline, engine.incident.note, engine.policy.get, engine.runtime.opt_in, engine.subscription_share.set, engine.turn.start, mcp.session.open, memory.counts, memory.graph, memory.notes.list, memory.versions, terminal.read, threads.list

L3: connections.complete_auth, connections.update, connectors.outbox.retry, hubspot.health, import.parse_excel, projects.file_chat, projects.pin_file, records.as_of, records.history, records.restore, schema.apply, schema.layout.set, sources.delete, sources.list, sync_types.get, sync_types.review_schema

L4: changesets.approve, changesets.revert_change, files.comments.resolve, files.folder.rename, files.markup.save, files.revoke_external, files.versions, git.protect, mounts.get, previews.health, runbooks.set_target

L5: calendar.availability, calendar.ingest_event, contacts.address.add, contacts.preferences.set, github.app.get, github.issue.update, github.pull_request.merge, google.calendar.get_event, google.drive.changes_start_token, google.drive.stop_watch, google.dwd.status, google.gmail.send_message, google.meet.subscribe, inbox.following, inbox.send_options, mail.domain.list, mail.mailbox.get, mail.route.list, mailgun.domains.delete, mailgun.routes.list, meetings.set_state, ms.calendar.get_schedule, ms.consent.policy_snippet, ms.drive.list_items, ms.mail.list_folders, ms.teams.recordings.get_transcript, resend.health, stripe.health, stripe.refund.create, telephony.dial, telephony.number.get, telephony.registration.refresh, twilio.a2p.status, twilio.number.search, zoom.meetings.delete

L6: automations.alerts.get, automations.groups.delete, automations.retry, automations.validate, gate.deny, home.activity, journeys.create, journeys.stage_counts, notifications.delegate.resolve, notifications.push.register, runs.mark_waiting, runs.stop, scheduler.pause, scheduler.waits.match, tasks.escalate, tasks.needs_you, webhooks.delete

L7a: access.actors.create, access.groups.add_member, access.labels.set, access.request, access.roles.assign, access.unshare, audit.list, devices.revoke, folders.place, governance.holds.release, identity.change_password, identity.passkey_remove, identity.totp_begin, members.invites.list, members.sso.remove, providers.subscription_start, settings.pages, spaces.matrix, vault.export_env, vault.import, vault.item.reveal, vault.requests.decline

L7b: backup.config_get, backup.verify, console.nav, health.history, health.time_skew, logs.trace, network.server_remove, reports.send_to_vyre

L8: bookings.availability, campaigns.link_build, campaigns.unsubscribe, docusign.fetch_signed, email_builder.get, email_builder.snippets.delete, esign.providers, forms.link_revoke, portal.account_disable, sites.deploy, sites.preview_remove, source_rules.list

L10: kits.builder_open, kits.list

## Findings from reading the sample

Nothing blocks the freeze. The sample read cleanly: summaries match the declared effects, outward capabilities carry gates that match their risk (send, post, pay, delete, push_protected, campaign_launch), and error lists are non-empty with permission codes on guarded calls. Points for the owning lane to confirm before its first build packet, none of which change a count or the hash:

- L7a writes with level `view` and no permission (`devices.revoke`, `spaces.leave`, `stars.toggle`, `identity.totp_begin`, `identity.passkey_remove`) act on the caller's own objects. Confirm the resource binding resolves to the caller, so the grant check cannot be satisfied by another person's object.
- `access.requests.decline` has no permission and level `view`. Confirm the handler requires the request's approver, since the registry alone does not.
- `governance.tombstones.reapply` is described as a system call and has no permission. Confirm its caller restriction or keep it out of the HTTP and MCP surfaces.
- `runs.undo` has risk `high` and no gate. Undo replays inverse writes, so confirm it never reverses an outward effect (the preview capability `runs.preview_undo` says what it cannot undo).
- 39 capabilities carry a gate while their effects are `write`, for example `mail.domain.remove` and `network.server_remove` (gate `delete`). This is intended: the gate applies to destructive inward writes too.


