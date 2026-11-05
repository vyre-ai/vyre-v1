# Gate (gate)

Lane L6. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (22)

- [gate.acts.list](../capabilities/gate.acts.list.md): The ten Gate act kinds with risk, preview and who they apply to
- [gate.allow.list](../capabilities/gate.allow.list.md): What may go without asking: your Always allow rules and the automations your press gave permission to
- [gate.allow.remove](../capabilities/gate.allow.remove.md): Take an Always allow rule or an automation's permission back. It stops at the next act
- [gate.allow.set](../capabilities/gate.allow.set.md): Always allow: a rule the Gate reads, for one agent or one chat, one act and one target, with an expiry. Local changes are a person's to allow; an outward act needs an admin; money is never allowed this way
- [gate.deny](../capabilities/gate.deny.md): Deny a hold: send back with a note for the asker thread, or drop the call
- [gate.effective_rule](../capabilities/gate.effective_rule.md): The effective rule for a principal and act: the strictest of Space policy, owner floor and agent.toml
- [gate.expire](../capabilities/gate.expire.md): Apply the timeout of a hold: drop it or escalate to the delegate or role (called by the scheduler)
- [gate.grants.ask](../capabilities/gate.grants.ask.md): What a person asks for in their own message: one single-use grant per act and target, read from their words by the server before the turn starts
- [gate.grants.give_back](../capabilities/gate.grants.give_back.md): System: hand back the turn grants a call spent when the call was refused before it went out; only the server may call it
- [gate.grants.goal](../capabilities/gate.grants.goal.md): System: what a goal may do without a hold. The owner's press on the goal names the acts (set); the goal's own chats are where they hold, and only while it runs (threads, empty to end them). Only the goals module calls it
- [gate.grants.set](../capabilities/gate.grants.set.md): Replace what an automation may send without a hold, for its definition as saved now. A person pressing Save or Turn on writes rows for the outward steps it names; anyone else leaves the automation with none
- [gate.grants.take](../capabilities/gate.grants.take.md): System: does a grant cover this call? Asked by the Gate hook at act time, it spends a single-use grant; only the server may call it
- [gate.holds.get](../capabilities/gate.holds.get.md): Read one hold
- [gate.holds.list](../capabilities/gate.holds.list.md): List holds with their state, act and task
- [gate.holds.revise](../capabilities/gate.holds.revise.md): Change what a held message says before it is sent. The approval is bound to the new words and the card says it was edited
- [gate.links.known](../capabilities/gate.links.known.md): System: did the person give this link, or did a page already read in this chat link to it
- [gate.park](../capabilities/gate.park.md): Park a call that authorize held: render the exact preview, create the Approve task, park the call (called by invoke)
- [gate.release](../capabilities/gate.release.md): Re-invoke the parked capability with an approval token bound to the payload hash, then resume the turn or step
- [gate.result.take](../capabilities/gate.result.take.md): System: hand the engine the answer of an approved call for a chat turn parked on it, once, and clear it. Only the server may call it; a requester or approver never reads the answer here.
- [gate.rules.list](../capabilities/gate.rules.list.md): List Gate rules: Space defaults, the owner floor and per-agent overrides
- [gate.rules.set](../capabilities/gate.rules.set.md): Set a Gate rule for an act at the Space, owner floor or agent level; a rule can never loosen the strictest level
- [gate.taint.mark](../capabilities/gate.taint.mark.md): System: outside words entered the turn in these threads, and the links a page gave are now known. Only the server may call it

## Events (7)

- [gate.approved](../events/gate.approved.md): A gated act was approved and released
- [gate.approver_moved](../events/gate.approver_moved.md): The person or role a held act waits on changed (the task was assigned, delegated or escalated): who moved it, from whom, to whom
- [gate.denied](../events/gate.denied.md): A gated act was sent back or dropped
- [gate.expired](../events/gate.expired.md): A hold timed out: dropped or escalated to a delegate or role
- [gate.requested](../events/gate.requested.md): A gated act stopped and became an Approve task with the exact preview
- [gate.revised](../events/gate.revised.md): A held message was edited before it was sent: the approval is bound to the new words
- [gate.rule_changed](../events/gate.rule_changed.md): A Gate rule changed (Space default, owner floor or per-agent override)
