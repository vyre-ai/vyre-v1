# Frozen capabilities (Freeze review A, P-PR_34)

Review of the merged capability registry at the F11 freeze. `packages/contracts/tests/frozen-capabilities.test.ts` reads this file and fails when the registry, the counts or the sample drift from it. A deliberate change to the registry updates this file in the same commit, signed by the lead.

## Frozen values

Registry hash: 99c0aacd0adb6c6bca96edeace16ba29bfae02988d24f3ee94d340ed3fc5c465
Capabilities: 1460
Events: 592
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
| L2 | 256 | 26 |
| L3 | 138 | 14 |
| L4 | 105 | 11 |
| L5 | 343 | 35 |
| L6 | 161 | 17 |
| L7a | 213 | 22 |
| L7b | 78 | 8 |
| L8 | 129 | 13 |

L1: conflicts.assist, conflicts.resolve, search.recent.list, sync.endpoints

L2: agents.config.get, agents.restore_version, agents.suggestion.propose, channels.agents.add, channels.members.remove, chat.handoff, chat.plan.reject, chat.transcript.get, computers.chrome.console, computers.chrome.snapshot, computers.files.list, computers.record_stop, computers.screen.screenshot, computers.take_over, engine.incident.assign, engine.models.list, engine.review.mark, engine.stop, engine.turn.retry, mcp.session.mint, mcp.toolsets.list, memory.facts_as_of, memory.notes.list, memory.versions, terminal.read, threads.list

L3: connections.complete_auth, connections.update, connectors.outbox.retry, hubspot.list_objects, import.parse_google_sheets, projects.get, projects.post_update, records.counts, records.relate, schema.describe, schema.view_kinds, sources.link.resolve, sync_types.discover, sync_types.review_schema

L4: changesets.approve, changesets.review_externally, files.copy, files.folder.rename, files.move, files.revoke_external, files.write, git.pull, mounts.lag, previews.health, runbooks.set_target

L5: calendar.availability, calendar.ingest_event, contacts.address.add, contacts.preferences.set, github.app.get, github.issue.update, github.pull_request.merge, google.calendar.get_event, google.drive.copy_file, google.drive.trash_file, google.gmail.create_draft, google.gmail.send_message, google.receive_push, inbox.link_message, inbox.thread, mail.domain.remove, mail.mailbox.get, mail.route.list, mailgun.domains.get, mailgun.send_email, meetings.set_summary, ms.calendar.get_schedule, ms.consent.policy_snippet, ms.drive.list_items, ms.mail.list_messages, ms.teams.recordings.list_recordings, resend.health, stripe.health, stripe.refund.create, telephony.dial, telephony.number.import, telephony.registration.refresh, twilio.a2p.status, twilio.number.search, zoom.meetings.delete

L6: automations.alerts.get, automations.groups.delete, automations.restore_version, automations.validate, gate.acts.list, home.activity, journeys.check_limits, journeys.rules.set, notifications.delegate.resolve, notifications.push.unregister, runs.preview_undo, runs.undo, scheduler.pause, scheduler.waits.register, tasks.escalate, tasks.release, webhooks.delete

L7a: access.actors.create, access.groups.add_member, access.policies.list, access.requests.decline, access.roles.create, access.view_as, audit.verify, devices.revoke, folders.place, governance.holds.release, governance.tombstones.reapply, identity.passkey_remove, identity.totp_begin, members.invites.list, members.sso.remove, providers.subscription_start, settings.list, spaces.leave, stars.toggle, vault.generate, vault.item.put, vault.request

L7b: backup.config_get, backup.verify, console.nav, health.history, logs.client_upload, logs.trace, network.server_remove, reports.send_to_vyre

L8: bookings.availability, campaigns.launch, campaigns.stop, docusign.create, email_builder.create, esign.cancel, forms.create, forms.submit, kits.install_sheet, portal.account_disable, sites.deploy, sites.preview_remove, source_rules.list

## Findings from reading the sample

Nothing blocks the freeze. The sample read cleanly: summaries match the declared effects, outward capabilities carry gates that match their risk (send, post, pay, delete, push_protected, campaign_launch), and error lists are non-empty with permission codes on guarded calls. Points for the owning lane to confirm before its first build packet, none of which change a count or the hash:

- L7a writes with level `view` and no permission (`devices.revoke`, `spaces.leave`, `stars.toggle`, `identity.totp_begin`, `identity.passkey_remove`) act on the caller's own objects. Confirm the resource binding resolves to the caller, so the grant check cannot be satisfied by another person's object.
- `access.requests.decline` has no permission and level `view`. Confirm the handler requires the request's approver, since the registry alone does not.
- `governance.tombstones.reapply` is described as a system call and has no permission. Confirm its caller restriction or keep it out of the HTTP and MCP surfaces.
- `runs.undo` has risk `high` and no gate. Undo replays inverse writes, so confirm it never reverses an outward effect (the preview capability `runs.preview_undo` says what it cannot undo).
- 39 capabilities carry a gate while their effects are `write`, for example `mail.domain.remove` and `network.server_remove` (gate `delete`). This is intended: the gate applies to destructive inward writes too.

