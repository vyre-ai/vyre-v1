# policy.manage

Manage policies, retention and erase a person

Area: space. Risk: high. Applies to: space.

| Role | Default |
|---|---|
| owner | on |
| admin | on |
| developer | off |
| member | off |
| guest | off |

## Capabilities that need it

- access.labels.set
- access.policies.list
- access.policies.reset
- access.policies.set
- channels.erase
- chat.transcript.purge
- engine.use_policy.export
- files.versions_purge
- gate.rules.set
- git.protect
- governance.erase.apply
- governance.erase.find
- governance.erase.list
- governance.jobs.list
- governance.jobs.run_now
- governance.retention.get
- governance.retention.reset
- governance.retention.set
- governance.tombstones.list
- inbox.item.erase
- logs.purge
- logs.settings_set
- mail.message.erase
- members.second_factor.report
- members.sign_in_policy.get
- members.sign_in_policy.set
- members.sso.list
- members.sso.remove
- members.sso.set
- members.sso.test
- memory.notes.erase
- records.purge
- records.purge_trashed
- reports.policy_get
- reports.policy_set
- runs.erase
- runs.purge
- settings.floor_set
- settings.reset_space
- settings.set_space
- spaces.update
- telephony.call.erase
- telephony.sms.erase
- threads.erase
