# Frozen capabilities (Freeze review A, P-PR_34)

Review of the merged capability registry at the F11 freeze. `packages/contracts/tests/frozen-capabilities.test.ts` reads this file and fails when the registry, the counts or the sample drift from it. A deliberate change to the registry updates this file in the same commit, signed by the lead.

## Frozen values

Registry hash: 7c371eb2b5e3df97e07f92e72f5bb053763bca8ad9528880b65c99ce4857b065
Capabilities: 1486
Events: 598
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
| L2 | 261 | 27 |
| L3 | 151 | 16 |
| L4 | 105 | 11 |
| L5 | 343 | 35 |
| L6 | 161 | 17 |
| L7a | 217 | 22 |
| L7b | 78 | 8 |
| L8 | 133 | 14 |

L1: conflicts.assist, conflicts.resolve, search.recent.list, sync.endpoints

L2: agents.builtin_skills.list, agents.pause, agents.suggestion.accept, agents.visibility.set, channels.leave, chat.approve_plan, chat.messages.list, chat.question.ask, chat.transcript.summary, computers.chrome.net, computers.chrome.status, computers.files.write, computers.recording.process, computers.screen.type, computers.timeline_step, engine.incident.open, engine.policy.get, engine.runtime.opt_in, engine.subscription_share.set, engine.turn.start, mcp.session.open, memory.counts, memory.find_by_subject, memory.pointer, terminal.attach, terminal.read, threads.list

L3: connections.complete_auth, connections.update, connectors.outbox.list, hubspot.health, import.parse_csv, projects.file_chat, projects.overview, records.as_of, records.get, records.release_hold, schema.apply, schema.layout.set, sources.delete, sources.list, sync_types.get, sync_types.review_schema

L4: changesets.approve, changesets.review_externally, files.copy, files.folder.rename, files.move, files.revoke_external, files.write, git.pull, mounts.lag, previews.health, runbooks.set_target

L5: calendar.availability, calendar.ingest_event, contacts.address.add, contacts.preferences.set, github.app.get, github.issue.update, github.pull_request.merge, google.calendar.get_event, google.drive.copy_file, google.drive.trash_file, google.gmail.create_draft, google.gmail.send_message, google.receive_push, inbox.link_message, inbox.thread, mail.domain.remove, mail.mailbox.get, mail.route.list, mailgun.domains.get, mailgun.send_email, meetings.set_summary, ms.calendar.get_schedule, ms.consent.policy_snippet, ms.drive.list_items, ms.mail.list_messages, ms.teams.recordings.list_recordings, resend.health, stripe.health, stripe.refund.create, telephony.dial, telephony.number.import, telephony.registration.refresh, twilio.a2p.status, twilio.number.search, zoom.meetings.delete

L6: automations.alerts.get, automations.groups.delete, automations.restore_version, automations.validate, gate.acts.list, home.activity, journeys.check_limits, journeys.rules.set, notifications.delegate.resolve, notifications.push.unregister, runs.preview_undo, runs.undo, scheduler.pause, scheduler.waits.register, tasks.escalate, tasks.release, webhooks.delete

L7a: access.actors.create, access.groups.add_member, access.labels.set, access.request, access.roles.assign, access.unshare, audit.list, devices.revoke, folders.move, governance.holds.place, governance.tombstones.reapply, identity.passkey_remove, identity.totp_begin, members.invites.preview, members.sso.set, providers.subscription_start, settings.pages, spaces.matrix, vault.export_env, vault.import, vault.item.reveal, vault.requests.decline

L7b: backup.config_get, backup.verify, console.nav, health.history, logs.client_upload, logs.trace, network.server_remove, reports.send_to_vyre

L8: bookings.availability, campaigns.launch, campaigns.stop, docusign.cancel, email_builder.ask_diff, email_builder.send_test, esign.provider_set, forms.get, forms.update, kits.preview, portal.file_link, sites.deployments, sites.previews, source_rules.list

## Findings from reading the sample

Nothing blocks the freeze. The sample read cleanly: summaries match the declared effects, outward capabilities carry gates that match their risk (send, post, pay, delete, push_protected, campaign_launch), and error lists are non-empty with permission codes on guarded calls. Points for the owning lane to confirm before its first build packet, none of which change a count or the hash:

- L7a writes with level `view` and no permission (`devices.revoke`, `spaces.leave`, `stars.toggle`, `identity.totp_begin`, `identity.passkey_remove`) act on the caller's own objects. Confirm the resource binding resolves to the caller, so the grant check cannot be satisfied by another person's object.
- `access.requests.decline` has no permission and level `view`. Confirm the handler requires the request's approver, since the registry alone does not.
- `governance.tombstones.reapply` is described as a system call and has no permission. Confirm its caller restriction or keep it out of the HTTP and MCP surfaces.
- `runs.undo` has risk `high` and no gate. Undo replays inverse writes, so confirm it never reverses an outward effect (the preview capability `runs.preview_undo` says what it cannot undo).
- 39 capabilities carry a gate while their effects are `write`, for example `mail.domain.remove` and `network.server_remove` (gate `delete`). This is intended: the gate applies to destructive inward writes too.


