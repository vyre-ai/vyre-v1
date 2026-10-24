# Gate (gate)

Lane L6. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (10)

- [gate.acts.list](../capabilities/gate.acts.list.md): The ten Gate act kinds with risk, preview and who they apply to
- [gate.deny](../capabilities/gate.deny.md): Deny a hold: send back with a note for the asker thread, or drop the call
- [gate.effective_rule](../capabilities/gate.effective_rule.md): The effective rule for a principal and act: the strictest of Space policy, owner floor and agent.toml
- [gate.expire](../capabilities/gate.expire.md): Apply the timeout of a hold: drop it or escalate to the delegate or role (called by the scheduler)
- [gate.holds.get](../capabilities/gate.holds.get.md): Read one hold
- [gate.holds.list](../capabilities/gate.holds.list.md): List holds with their state, act and task
- [gate.park](../capabilities/gate.park.md): Park a call that authorize held: render the exact preview, create the Approve task, park the call (called by invoke)
- [gate.release](../capabilities/gate.release.md): Re-invoke the parked capability with an approval token bound to the payload hash, then resume the turn or step
- [gate.rules.list](../capabilities/gate.rules.list.md): List Gate rules: Space defaults, the owner floor and per-agent overrides
- [gate.rules.set](../capabilities/gate.rules.set.md): Set a Gate rule for an act at the Space, owner floor or agent level; a rule can never loosen the strictest level

## Events (5)

- [gate.approved](../events/gate.approved.md): A gated act was approved and released
- [gate.denied](../events/gate.denied.md): A gated act was sent back or dropped
- [gate.expired](../events/gate.expired.md): A hold timed out: dropped or escalated to a delegate or role
- [gate.requested](../events/gate.requested.md): A gated act stopped and became an Approve task with the exact preview
- [gate.rule_changed](../events/gate.rule_changed.md): A Gate rule changed (Space default, owner floor or per-agent override)
