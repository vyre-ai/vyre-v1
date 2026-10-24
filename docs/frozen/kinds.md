# Frozen extension kinds

Freeze review E (P-PR_38). This records the extension kind tables and one example of each kind.

The source is the committed registry `generated/registry.json` (hash `99c0aacd0adb6c6bca96edeace16ba29bfae02988d24f3ee94d340ed3fc5c465`). `generated/kinds.ts` re-exports gate acts, task kinds, notification kinds, health checks, retention, settings, import sources, blocks and lists. Steps, triggers and connectors sit on the same registry (ARCH 3.4). The review reads those three from `generated/registry.ts`.

Spec 2.14 is the gate act table. Spec 2.24 is the three notification levels. Spec 4.18 is the health checks (each has a next step) and the logs retention window. Spec 5 names backups and report-a-problem, which show up here as the `backups` retention class and the `problem.report` notification. Spec b9 (one API, toolsets, and the replay sandbox) shows up as step samples, which a replay can show, and as each connector naming a health check. ARCH 3.5 covers blocks, health checks, gate acts, task kinds and notification kinds.

`contracts/tests/frozen-kinds.test.ts` fails when a table is empty, when a kind has no declaring module, or when a kind has no example.

## What the example is

| Table | Example |
|---|---|
| Gate act | First preview block, the exact preview an approver sees |
| Task kind | First action |
| Notification kind | Title template |
| Health check | Next step shown when the check is not healthy |
| Retention class | Default duration |
| Setting | Default value. null, an empty string, [] and {} are real defaults |
| Import source | First accepted input |
| Block | Fallback text |
| List | Capability that lists the items |
| Step | Sample output, used by test mode |
| Trigger | Sample payload, the value the run receives as $trigger |
| Connector | First egress domain |

## Counts

| Table | Export | Count | Declaring modules |
|---|---|---|---|
| Gate acts | gateActs | 10 | gate |
| Task kinds | taskKinds | 6 | tasks |
| Notification kinds | notificationKinds | 22 | notifications |
| Health checks | healthChecks | 47 | one module each |
| Retention classes | retention | 10 | governance |
| Settings | settings | 83 | the module that owns the row |
| Import sources | importSources | 9 | import, vault |
| Blocks | blocks | 22 | the module that renders the block |
| Lists | lists | 10 | the module that owns the list |
| Steps | registry.steps | 25 | steps-core |
| Triggers | registry.triggers | 13 | automations |
| Connectors | registry.connectors | 13 | the connector module |

## Rules the test locks

1. Each table in Counts is non-empty, and the `generated/kinds.ts` exports are the registry arrays.
2. Each kind's `module` is a module id in the registry.
3. Each kind has the example named above. A setting default may be null or empty. Every other text example is non-blank, and every array example has at least one entry.
4. Gate acts are the ten keys below, all from module `gate`. Each sends on `gate.release`. The timeout is 24 hours, then escalate to the delegate, with an email backstop at 4 hours. Approvers are people. `humanToo` is set on campaign launch, protected push, secret export and site promote.
5. Notification levels are `interrupt`, `badge` or `digest`, all declared by module `notifications`. An interrupt carries a push title and does not wait for working hours. `approval.requested` and `agent.blocked` use place `chats`. `approval.requested` emails once after 4 hours.
6. Each health check names a capability, a positive interval and timeout, and a next step. The logs retention default is `30d`, declared by `governance`.
7. Task kinds are the six keys below, all from module `tasks`. Retention classes are the ten keys below, all from module `governance`.
8. A step `gateAct`, when set, is one of the ten gate acts. A connector's `health` key is one of the health checks. The `webhook` trigger has `personalOk` false. Every list has `newItemStartsPersonal` true.

## Gate acts

Spec 2.14. Module `gate` declares the ten acts. Approving any of them re-invokes `gate.release`. The preview block is the example the approver sees.

Example: `send`.

```json
{
  "appliesTo": {
    "actors": [
      "agent",
      "automation",
      "campaign"
    ],
    "humanToo": false
  },
  "approvers": {
    "agentOkFor": "low",
    "default": "asker",
    "peopleOnly": true
  },
  "key": "send",
  "module": "gate",
  "preview": {
    "blocks": [
      {
        "from": "$input",
        "type": "doc_excerpt"
      }
    ]
  },
  "risk": "medium",
  "sendsOnApprove": "gate.release",
  "timeout": {
    "afterHours": 24,
    "emailBackstopHours": 4,
    "escalateTo": "delegate",
    "onTimeout": "escalate"
  },
  "title": "Send a message"
}
```

| Key | Title | Risk | Human too | Example preview |
|---|---|---|---|---|
| campaign_launch | Launch a campaign | high | yes | table |
| delete | Delete | high | no | record_card |
| pay | Send money or submit a card | high | no | table |
| post | Post publicly | medium | no | doc_excerpt |
| push_protected | Push to a protected branch | high | yes | diff |
| secret_export | Export secrets | high | yes | table |
| send | Send a message | medium | no | doc_excerpt |
| signature_send | Send a document for signature | high | no | file |
| site_promote | Promote a site to production | high | yes | deploy |
| spend_raise | Raise a spend cap | medium | no | table |

## Task kinds

Module `tasks` declares the six kinds. The first action is the example.

Example: `approve`.

```json
{
  "actions": [
    {
      "key": "approve",
      "label": "Approve",
      "note": "optional",
      "to": "done"
    },
    {
      "key": "reject",
      "label": "Send back",
      "note": "required",
      "to": "doing"
    },
    {
      "cap": "tasks.delegate",
      "key": "delegate",
      "label": "Hand over",
      "note": "optional"
    },
    {
      "cap": "tasks.snooze",
      "key": "snooze",
      "label": "Snooze"
    }
  ],
  "blocks": [
    "table",
    "doc_excerpt",
    "diff",
    "file",
    "record_card",
    "deploy",
    "form_fields"
  ],
  "closeOn": "act",
  "initial": "awaiting_approval",
  "key": "approve",
  "module": "tasks",
  "needsYou": true,
  "slots": [
    "approver"
  ],
  "title": "Approve"
}
```

| Key | Title | Needs you | Initial | Closes on | Example action |
|---|---|---|---|---|---|
| answer | Answer | yes | todo | act | answer |
| approve | Approve | yes | awaiting_approval | act | approve |
| review | Review | yes | in_review | act | approve |
| signature | Signature | no | doing | complete | cancel |
| unblock | Unblock | yes | todo | act | resolved |
| work | Work | no | todo | complete | start |

## Notification kinds

Spec 2.24. Three levels, and nothing to set up. Module `notifications` declares every kind. The title template is the example. Needs you lives in Chats, so approvals and agent blocks use place `chats`.

Example: `approval.requested`.

```json
{
  "actions": [
    {
      "cap": "tasks.act",
      "label": "Approve"
    },
    {
      "cap": "tasks.act",
      "label": "Send back"
    }
  ],
  "agentRateKey": "agent_interrupt",
  "backstopEmailAfterHours": 4,
  "collapseKey": "approval.requested:{{subject}}",
  "key": "approval.requested",
  "level": "interrupt",
  "module": "notifications",
  "place": "chats",
  "pushTitle": "{{space}} needs you",
  "respectHours": false,
  "title": "Approval needed: {{title}}"
}
```

| Key | Level | Place | Example title |
|---|---|---|---|
| access.decided | badge | home | Your access request for {{title}} was {{decision}} |
| access.requested | badge | console | {{from}} asks for {{level}} access to {{title}} |
| agent.blocked | interrupt | chats | {{agent}} is blocked: {{reason}} |
| agent.task_finished | badge | chats | {{agent}} finished: {{title}} |
| approval.backstop | interrupt | chats | Still waiting on you: {{title}} |
| approval.requested | interrupt | chats | Approval needed: {{title}} |
| call.incoming | interrupt | inbox | Incoming call from {{from}} |
| campaign.reply | badge | apps | Reply from {{from}} to {{campaign}} |
| conflict.needs_you | badge | records | Two edits conflict on {{title}} |
| digest.away | digest | home | While you were away |
| dm | interrupt | chats | Message from {{from}} |
| health.degraded | badge | console | {{service}} is {{state}} |
| incident.owned | interrupt | console | Incident you own: {{title}} |
| limit.hit | badge | chats | {{title}} hit its limit |
| member.joined | digest | home | {{name}} joined {{space}} |
| mention | interrupt | chats | {{from}} mentioned you in {{where}} |
| mention.thread | badge | chats | Mentioned in a thread: {{where}} |
| problem.report | badge | console | Problem report from {{from}} |
| reply.followed | badge | inbox | New reply on {{where}} |
| run.failed | badge | automations | {{name}} failed: {{message}} |
| sync.attention | badge | settings | Sync needs attention on {{device}} |
| task.assigned | badge | home | {{from}} gave you a task: {{title}} |

## Health checks

Spec 4.18 and ARCH 3.5. Each check names a cheap read and a plain next step. The next step is the example.

Example: `host.disk_encrypted`.

```json
{
  "cap": "health.disk_encrypted",
  "intervalSec": 60,
  "key": "host.disk_encrypted",
  "module": "health",
  "next": "Enable FileVault or LUKS for the data directory, then run vyre-server doctor.",
  "states": {
    "downWhen": "state == 'down'"
  },
  "timeoutMs": 5000,
  "title": "Data directory is on an encrypted volume"
}
```

| Key | Module | Capability | Example next step |
|---|---|---|---|
| access.projection | access | access.projection_health | Restart the server from Console > Server; if it stays red, open the support bundle |
| audit.chain | audit | audit.chain_health | Run Verify in Console > Audit log; if it fails, restore from the last good backup and keep the support bundle |
| backups.recent | backup | backup.health | Open Console, Infrastructure, Backups and run a backup now. |
| calendar.sync | calendar | calendar.health | Open Settings, Connections and reconnect the Google or Microsoft calendar. |
| computers | computers | computers.health | Check that Docker (Colima on a Mac) is running on the host, then restart agentd |
| connectors.connections | connectors | connectors.health | Reconnect the failing connection in Console > Integrations. |
| documenso.api | documenso | documenso.health | Reconnect Documenso in Console, Integrations. |
| docusign.api | docusign | docusign.health | Reconnect DocuSign in Console, Integrations. |
| dropbox_sign.api | dropbox-sign | dropbox_sign.health | Reconnect Dropbox Sign in Console, Integrations. |
| engine | engine | engine.health | Open Settings > Models and usage and test the account, or switch model |
| esign.documenso | esign | esign.health | Restart the Documenso container in Console, Infrastructure, Services. |
| files.store | files | files.health | Free disk space on the server or restart the files service in the Console. |
| git.binary | git | git.health | Reinstall git on the server or restart the files service in the Console. |
| github.app | github | github.health | Check the GitHub App key in the Vault and that the App is still installed on the organisation. |
| google.dwd | google | google.health | Check the Google_DWD key in the Vault and the scopes in the Google Admin console, then press Probe. |
| governance.retention | governance | governance.jobs_health | Open Console > Data > Retention and run the late job now |
| host.caddy | health | health.caddy | Restart Caddy in Console, Infrastructure, Services. |
| host.disk_encrypted | health | health.disk_encrypted | Enable FileVault or LUKS for the data directory, then run vyre-server doctor. |
| host.disk_space | health | health.disk_space | Free disk space or extend the volume. |
| host.docker | health | health.docker | Start Docker or Colima; sites and agent computers need it. |
| host.time_skew | health | health.time_skew | Fix the server clock (NTP). |
| hubspot.api | hubspot | hubspot.health | Reconnect HubSpot in Console, Integrations. |
| kernel.events_db | health | health.events_db | Run vyre-server doctor and restore from the last backup if the chain fails. |
| mail.sync | mail | mail.health | Open the mailbox, check the Google or Microsoft connection and press Sync now. |
| mailgun.domain | mailgun | mailgun.health | Check the Mailgun_Key in the Vault and the domain verification state in Console, Comms. |
| mcp | mcp | mcp.health | Open Console > Infrastructure > Health and restart the MCP service |
| microsoft.graph | microsoft | ms.health | Check the admin consent and the Exchange application access policy, then press Verify. |
| mounts.lag | mounts | mounts.lag | Reconnect the Google or Microsoft account, or turn on the computer that holds the local folder. |
| network.certificate | network | network.health | Open Console, Infrastructure, Network and renew the certificate. |
| network.relay | network | network.health | Open Console, Infrastructure, Network and check the relay row. |
| previews.converter | previews | previews.health | Restart the preview service in the Console. Files stay available as downloads meanwhile. |
| reports.service | reports-client | reports.health | Check the network; reports queue locally until it returns. |
| resend.api | resend | resend.health | Check the Resend_Key in the Vault, then check the sending domain records in Console, Comms. |
| run_engine | runs | runs.status | Open Failed runs and stop the stuck ones, or restart the server from the Console. |
| scheduler | scheduler-api | scheduler.status | Restart the server from the Console; paused automations resume when the scheduler is healthy again. |
| scheduler.tick | health | health.scheduler | Restart the scheduler service in Console, Infrastructure, Services. |
| search | search | search.health | Open Console > Infrastructure > Health and rebuild the index |
| search.index | health | health.index_db | Rebuild the index with vyre rebuild --projection search.fts. |
| sources.intake | sources | sources.health | Check that the public address is reachable and that each source has its secret in the Vault. |
| stripe.balance | stripe | stripe.health | Check the Stripe_Key item in the Vault and that the restricted key still has read access. |
| sync | sync | sync.health | Open Console > Infrastructure > Health, then restart the sync service |
| terminal | terminal | terminal.health | Check that tmux is installed on the host, then reopen the session |
| twilio.account | twilio | twilio.health | Check the Twilio_Account and Twilio_Auth items in the Vault. |
| updates.current | updates | updates.health | Open Console, Infrastructure, Server, Updates. |
| vault.service | vault | vault.service_health | Restart the vault service from Console > Server > Services; values are safe while it is down |
| webhooks_out | events | webhooks.health | Open Console > Webhooks > Deliveries, fix the failing URLs, then replay the failed deliveries. |
| zoom.account | zoom | zoom.health | Check the Zoom_S2S item in the Vault and that the Zoom app is activated. |

## Retention classes

Module `governance` owns all ten classes. The default duration is the example. The logs class is the spec 4.18 window (full logs for 30 days). The backups class is the spec 5 backup rotation.

Example: `logs`.

```json
{
  "default": "30d",
  "holdable": false,
  "key": "logs",
  "module": "governance",
  "title": "Logs (full 30 days, aggregates 180 days)",
  "tombstone": false
}
```

| Key | Title | Example default | Holdable | Tombstone |
|---|---|---|---|---|
| audit | Audit entries (then archived, never edited) | 2y | yes | no |
| backups | Backups (rotation per policy; an erase purges the next rotation) | per_policy | no | no |
| events | Events (state-bearing forever; other payloads compacted after 30 days) | forever | yes | yes |
| file_versions | File versions (all for 30 days, then daily for 90 days, then monthly unless named) | 30d+daily90d+monthly | yes | no |
| logs | Logs (full 30 days, aggregates 180 days) | 30d | no | no |
| memory | Memory notes and facts | forever | yes | yes |
| records | Records (per record type) | forever | yes | yes |
| run_logs | Run logs and run chats | 90d | yes | no |
| transcripts | Chat transcripts | 1y | yes | yes |
| trash | Trash (records, files) | 30d | yes | no |

## Settings

Each module declares the settings it owns. The default value is the example. The JSON Schema stays on the registry row.

Example: `mail.send_window`.

```json
{
  "default": {
    "days": [
      1,
      2,
      3,
      4,
      5
    ],
    "endHour": 18,
    "startHour": 8,
    "zone": "recipient"
  },
  "key": "mail.send_window",
  "module": "mail",
  "page": "comms",
  "scope": "space",
  "title": "Send window"
}
```

| Key | Module | Scope | Page | Example default |
|---|---|---|---|---|
| access.review_every_days | access | space | console.access | 90 |
| agents.template_mode | agents | space | Policies | suggest |
| appearance.mode | settings | person | appearance | system |
| appearance.skin | settings | person | appearance | classic |
| automations.default_error_alert | automations | space | Automations | {"when":"every","where":"needs_you"} |
| automations.max_chain_depth | automations | space | Automations | 8 |
| automations.run_automations_on_import | automations | space | Automations | false |
| backup.encrypt | backup | space | backups | true |
| changesets.different_person | files | space | files | false |
| chat.agent_tabs | chat | person | Chats | true |
| chat.ask_agent | chat | person | Models and usage | null |
| computers.default_tab_limit | computers | space | Policies | 8 |
| computers.idle_sleep_minutes | computers | space | Policies | 10 |
| connectors.conflict_default | connectors | space | integrations | newest |
| connectors.delete_guard | connectors | space | integrations | {"count":50,"percent":10} |
| connectors.polling | connectors | space | integrations | {"activeSec":120,"dormantSec":3600,"idleSec":900} |
| contacts.dnd_screening | contacts-link | space | comms | true |
| contacts.optout_keywords | contacts-link | space | comms | ["STOP","STOPALL","UNSUBSCRIBE","CANCEL","END","QUIT"] |
| contacts.sms_requires_consent | contacts-link | space | comms | true |
| engine.agent_hops | engine | space | Policies | 4 |
| engine.allowed_accounts | engine | space | Models and providers | any |
| engine.ci_fix_loops | engine | space | Policies | 3 |
| engine.local_runs | engine | person | This computer | true |
| engine.logging | engine | space | Logging | steps |
| engine.review_loops | engine | space | Policies | 2 |
| engine.review_sampling | engine | space | Review sampling | {"labels":["confidential","restricted"],"percent":5} |
| engine.runtime_opt_in | engine | person | Memory and privacy | true |
| engine.subscription_share | engine | person | Models and usage | true |
| files.lint_limits | files | space | files | {"amber":150,"red":200} |
| files.local_mount_default | files | space | files | server_copy |
| files.review_changes | files | space | files | {"cloud_mount":true,"git":true,"plain":false} |
| gate.drafted_by_label | gate | space | Policies | true |
| gate.email_backstop_hours | gate | space | Policies | 4 |
| gate.timeout_hours | gate | space | Policies | 24 |
| git.protected_branches | git | space | files | ["main","master"] |
| google.auto_connect | google | space | integrations | true |
| google.excluded_members | google | space | integrations | [] |
| home.digest_schedule | home | person | Home | {"at":"07:30","tz":"UTC"} |
| keyboard.overrides | settings | person | keyboard | {} |
| kit.choice | kits | space | kit | {} |
| kit.choice_person | kits | person | kit | {} |
| kit.default.rail | default | space | kit | ["home","chats","inbox","records","files","apps","automations","vault","settings"] |
| kit.intake.consult_minutes | law-firm-intake | space | kit | 30 |
| kit.person_choice | settings | person | appearance | null |
| kit.space_choice | settings | space | spaces | null |
| mail.provider | mail | space | comms | resend |
| mail.send_window | mail | space | comms | {"days":[1,2,3,4,5],"endHour":18,"startHour":8,"zone":"recipient"} |
| mail.sender_caps | mail | space | comms | {"perDay":150,"perHour":30} |
| mail.throttle | mail | space | comms | {"perMinute":60} |
| mailgun.region | mailgun | space | integrations | us |
| members.default_role | members | space | console.access | member |
| members.invite_expiry_days | members | space | console.access | 7 |
| memory.auto_merge_kinds | memory | space | Policies | ["preference"] |
| memory.weekly_nudge | memory | person | Memory and privacy | true |
| microsoft.auto_connect | microsoft | space | integrations | true |
| microsoft.excluded_members | microsoft | space | integrations | [] |
| notifications.email_backstop | notifications | person | Notifications | true |
| notifications.push_idle_minutes | notifications | space | Notifications | 5 |
| notifications.working_hours | notifications | person | Notifications | {"days":[1,2,3,4,5],"from":"09:00","to":"18:00","tz":"UTC"} |
| profile.contact | settings | person | profile | {} |
| profile.display_name | settings | person | profile | "" |
| profile.handle | settings | person | profile | "" |
| profile.photo | settings | person | profile | null |
| profile.timezone | settings | person | profile | UTC |
| profile.title | settings | person | profile | "" |
| profile.working_hours | settings | person | profile | {"days":[1,2,3,4,5],"from":"09:00","to":"17:00"} |
| reports.vyre | reports-client | space | ai | on |
| retention.overrides | governance | space | console.data | {} |
| scheduler.default_wait_timeout | scheduler-api | space | Automations | 30d |
| scheduler.missed_window_minutes | scheduler-api | space | Automations | 60 |
| sharing.public_links | access | space | console.access | admins |
| signin.require_sso | members | space | console.access | false |
| signin.second_factor | members | space | console.access | off |
| space.allowed_ai_accounts | spaces | space | console.space | any |
| space.skin_default | spaces | space | console.space | classic |
| sync.blob_cache_mb | sync | person | This computer | 2048 |
| sync.phone_label_ceiling | sync | space | Policies | confidential |
| tasks.allow_self_review | tasks | space | Policies | false |
| tasks.require_human_approver | tasks | space | Policies | false |
| tasks.review_loop_limit | tasks | space | Policies | 2 |
| telephony.recording_default | telephony | space | comms | off |
| telephony.voicemail_transcript | telephony | space | comms | true |
| vault.export_expiry_max | vault | space | console.vault | 1d |

## Steps

ARCH 3.4. Module `steps-core` declares the step kinds an Automation, Journey or Campaign can use. The sample output is the example. Input and output schemas stay on the registry row. A step that names `gateAct` uses one of the ten gate acts.

Example: `send_email`.

```json
{
  "cap": "mail.send",
  "category": "send",
  "editor": "ui:StepSendEmail",
  "effects": "outward",
  "errors": [
    "validation.bad_input",
    "internal.unexpected",
    "provider.unavailable",
    "provider.network",
    "permission.needs_approval"
  ],
  "gateAct": "send",
  "idempotency": "key",
  "key": "send_email",
  "kind": "capability",
  "module": "steps-core",
  "retry": {
    "backoff": "exp",
    "baseMs": 1000,
    "max": 3
  },
  "sample": {
    "messageId": "example",
    "threadId": "example"
  },
  "title": "Send an email"
}
```

| Key | Title | Category | Kind | Effects | Gate | Example sample |
|---|---|---|---|---|---|---|
| ai | AI step | ai | ai | write | "" | {"data":{},"keyUsed":"example","modelUsed":"example","runThreadId":"thr_a1b2c3","text":"example"} |
| approval | Approval | control | control | write | "" | {"by":"example","decision":"approved","note":"example","taskId":"tsk_a1b2c3"} |
| code | Run code | code | code | read | "" | {"logs":["example"],"result":{}} |
| create_task | Create a task | data | capability | write | "" | {"taskId":"tsk_a1b2c3"} |
| if | If | control | control | read | "" | {"result":true} |
| loop | Loop | control | control | read | "" | {"iterations":1,"results":[{}]} |
| parallel | Parallel | control | control | read | "" | {"finished":["example"]} |
| paths | Paths | control | control | read | "" | {"taken":"example"} |
| post_message | Post a chat message | send | capability | outward | post | {"messageId":"msg_a1b2c3"} |
| records.create | Create a record | data | capability | write | "" | {"recordId":"rec_a1b2c3"} |
| records.find | Find records | data | capability | read | "" | {"count":1,"rows":[{}]} |
| records.update | Update a record | data | capability | write | "" | {"recordId":"rec_a1b2c3","version":1} |
| send_email | Send an email | send | capability | outward | send | {"messageId":"example","threadId":"example"} |
| send_sms | Send a text message | send | capability | outward | send | {"messageId":"example"} |
| sheet.add_rows | Add rows | sheet | capability | write | "" | {"appended":1,"rowIds":["r_12"]} |
| sheet.create | Create a spreadsheet | sheet | capability | write | "" | {"fileId":"fil_a1b2c3"} |
| sheet.delete_rows | Delete rows | sheet | capability | write | delete | {"deleted":true} |
| sheet.find_rows | Find rows | sheet | capability | read | "" | {"rows":[{"rowId":"r_12","values":{}}]} |
| sheet.read_all | Read all rows | sheet | capability | read | "" | {"rows":[{"rowId":"r_12","values":{}}]} |
| sheet.update_rows | Update rows | sheet | capability | write | "" | {"rowId":"r_12","versionId":"ver_a1b2c3"} |
| sign | Send for signature | sign | capability | outward | signature_send | {"envelopeId":"example","taskId":"tsk_a1b2c3"} |
| start_journey | Start a Journey | journey | capability | write | "" | {"recordId":"rec_a1b2c3"} |
| stop | Stop | control | control | read | "" | {"stopped":true} |
| wait | Wait | wait | wait | read | "" | {"at":1760000000000,"resumedBy":"duration"} |
| wait_stage | Wait for a Journey stage | wait | wait | read | "" | {"enteredAt":1760000000000,"timedOut":true} |

## Triggers

ARCH 3.4. Module `automations` declares the trigger palette. The sample payload is the example. The source filter schema stays on the registry row. The webhook trigger is Team Space only (`personalOk` false).

Example: `record_change`.

```json
{
  "allowSelfTrigger": false,
  "key": "record_change",
  "module": "automations",
  "personalOk": true,
  "sample": {
    "changed": {},
    "fields": [
      "example"
    ],
    "op": "created",
    "record": {},
    "recordId": "rec_a1b2c3",
    "type": "contact",
    "version": 1
  },
  "source": {
    "events": [
      "record.created",
      "record.updated",
      "record.deleted"
    ]
  },
  "title": "A record changes"
}
```

| Key | Title | Personal | Example sample |
|---|---|---|---|
| button | A button is pressed | yes | {"label":"example","pressedBy":"example","recordId":"rec_a1b2c3","type":"contact"} |
| campaign_reply | A campaign gets a reply | yes | {"campaignId":"cmp_a1b2c3","messageId":"msg_a1b2c3","recordId":"rec_a1b2c3"} |
| chat_message | A chat message is posted | yes | {"author":{"id":"example","kind":"example"},"depth":1,"kind":"example","messageId":"msg_a1b2c3","threadId":"thr_a1b2c3","threadSeq":1} |
| ci_check | A CI check finishes | yes | {"branch":"example","conclusion":"success","name":"example","repo":"example","sha":"example","url":"example"} |
| email_received | An email is received | yes | {"campaignId":"cmp_a1b2c3","contactId":"rec_a1b2c3","from":"example","mailboxId":"mbx_a1b2c3","messageId":"example","subject":"example"} |
| form_submit | A form is submitted | yes | {"formId":"frm_a1b2c3","matched":true,"recordId":"rec_a1b2c3","type":"contact"} |
| journey_stage_entered | A Journey record enters a stage | yes | {"journeyId":"jrn_a1b2c3","manual":true,"previousStage":"example","recordId":"rec_a1b2c3","stage":"example"} |
| manual | Run by hand | yes | {"input":{},"startedBy":"example"} |
| meeting_transcript_ready | A meeting transcript is ready | yes | {"meetingId":"rec_a1b2c3","source":"example"} |
| record_change | A record changes | yes | {"changed":{},"fields":["example"],"op":"created","record":{},"recordId":"rec_a1b2c3","type":"contact","version":1} |
| schedule | On a schedule | yes | {"cron":"example","firedAt":1760000000000,"missed":true,"scheduledFor":1760000000000} |
| spreadsheet_row | A spreadsheet row is added or changed | yes | {"columns":["example"],"fileId":"fil_a1b2c3","op":"added","rowId":"example","sheet":"example"} |
| webhook | A webhook is received | no | {"body":{},"headers":{},"query":{},"receivedAt":1760000000000} |

## Connectors

ARCH 3.4. Each connector names the egress domains it may call and a health check. The first domain is the example. The health key is one of the health checks above.

Example: `github`. Auth, actions and secrets stay on the registry row. The example domain is `api.github.com`.

```json
{
  "key": "github",
  "title": "GitHub",
  "module": "github",
  "mode": "api",
  "scope": "space",
  "auth": "github_app",
  "domains": [
    "api.github.com",
    "github.com"
  ],
  "health": "github.app",
  "rate": {
    "burst": 30,
    "rps": 10
  },
  "tests": "connectors/github/tests"
}
```

| Key | Module | Mode | Scope | Health | Example domain |
|---|---|---|---|---|---|
| documenso | documenso | api | space | documenso.api | documenso.internal |
| docusign | docusign | api | space | docusign.api | *.docusign.net |
| dropbox-sign | dropbox-sign | api | space | dropbox_sign.api | api.hellosign.com |
| github | github | api | space | github.app | api.github.com |
| github_signin | github | oauth_app | person | github.app | api.github.com |
| google | google | dwd | space | google.dwd | *.googleapis.com |
| hubspot | hubspot | api | space | hubspot.api | api.hubapi.com |
| mailgun | mailgun | api | space | mailgun.domain | api.mailgun.net |
| microsoft | microsoft | oauth_app | space | microsoft.graph | graph.microsoft.com |
| resend | resend | api | space | resend.api | api.resend.com |
| stripe | stripe | api | space | stripe.balance | api.stripe.com |
| twilio | twilio | api | space | twilio.account | api.twilio.com |
| zoom | zoom | api | space | zoom.account | api.zoom.us |

## Blocks

ARCH 3.5. Each block type has a fallback text template, which is the example rendered in the CLI, mail and phone notifications. The data schema stays on the registry row.

Example: `record_card`.

```json
{
  "component": "ui:BlockRecordCard",
  "fallback": "{{title}} ({{type}})",
  "module": "records",
  "opens": {
    "input": {
      "recordId": "/recordId"
    },
    "tab": "record"
  },
  "type": "record_card",
  "v": 1
}
```

| Type | Module | Example fallback |
|---|---|---|
| access_request | access | Access request: {{requester}} asks for {{level}} on {{resourceTitle}}. {{note}} |
| changeset | files | Changed {{fileCount}} files in {{folderName}}. Review in Files. |
| checklist | chat | Checklist {{title}} |
| deploy | sites | Deploy {{env}} is {{state}}: {{url}} |
| diff | files | {{fileCount}} files changed, {{added}} added, {{removed}} removed. |
| diff_card | console-assistant | Proposed change: {{title}} |
| doc_excerpt | chat | Excerpt from {{title}} |
| file | files | File {{name}} |
| form_fields | chat | Fields: {{title}} |
| helper | chat | Helper {{title}}: {{status}} |
| memory_saved | memory | Saved to your {{layer}} layer: {{text}} |
| model_switch | chat | Using {{to.model}} for this step |
| mount | files | Mounted {{name}} from {{provider}} |
| plan | chat | Plan: {{title}} ({{steps.length}} steps) |
| question | chat | Question: {{prompt}} |
| record_card | records | {{title}} ({{type}}) |
| screenshot | computers | Screenshot: {{caption}} |
| secret_input | vault | Add {{name}} to the Vault: type the value in the field above. It does not enter this chat. |
| tab_opened | chat | Opened {{title}} beside the chat |
| table | chat | Table {{title}} ({{rows.length}} rows) |
| terminal | terminal | Ran {{commands.length}} commands on {{hostTitle}} |
| vault_used | vault | Used {{handle}} ({{outcome}}). The value was not shown. |

## Import sources

`generated/kinds.ts` exports this table with the others. The first accepted input is the example.

Example: `csv`.

```json
{
  "accepts": [
    "text/csv",
    ".csv",
    ".tsv"
  ],
  "key": "csv",
  "mapsTo": "record_type",
  "module": "import",
  "parse": "import.parse_csv",
  "title": "CSV"
}
```

| Key | Module | Maps to | Parse | Example accepts |
|---|---|---|---|---|
| airtable | import | record_type | import.parse_airtable | https://airtable.com/* |
| bitwarden | vault | vault | vault.import_parse | .json |
| chrome | vault | vault | vault.import_parse | .csv |
| csv | import | record_type | import.parse_csv | text/csv |
| excel | import | record_type | import.parse_excel | application/vnd.openxmlformats-officedocument.spreadsheetml.sheet |
| google_sheets | import | record_type | import.parse_google_sheets | https://docs.google.com/spreadsheets/* |
| lastpass | vault | vault | vault.import_parse | .csv |
| notion | import | record_type | import.parse_notion | https://www.notion.so/* |
| onepassword | vault | vault | vault.import_parse | .1pux |

## Lists

`generated/kinds.ts` exports this table with the others. A new item starts personal. The listing capability is the example.

Example: `file`.

```json
{
  "folders": true,
  "items": "files.list",
  "module": "files",
  "newItemStartsPersonal": true,
  "plural": "Files",
  "shareLevels": [
    "view",
    "use",
    "edit",
    "manage"
  ],
  "title": "File",
  "type": "file"
}
```

| Type | Module | Title | Example capability |
|---|---|---|---|
| agent | agents | Agent | agents.list |
| automation | automations | Automation | automations.list |
| campaign | campaigns | Campaign | campaigns.list |
| channel | chat | Channel | channels.list |
| file | files | File | files.list |
| form | forms | Form | forms.list |
| record_type | schema | Record type | schema.types.list |
| site | sites | Site | sites.list |
| terminal | terminal | Terminal | terminal.list |
| vault_item | vault | Vault item | vault.items.list |
