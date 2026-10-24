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
- engine.use_policy.export
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
- logs.settings_set
- members.second_factor.report
- members.sign_in_policy.get
- members.sign_in_policy.set
- members.sso.list
- members.sso.remove
- members.sso.set
- members.sso.test
- reports.policy_get
- reports.policy_set
- settings.floor_set
- settings.reset_space
- settings.set_space
- spaces.update
