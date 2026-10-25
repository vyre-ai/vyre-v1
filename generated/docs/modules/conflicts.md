# Conflicts (conflicts)

Lane L1. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (11)

- [conflicts.assist](../capabilities/conflicts.assist.md): Start the assistant run that compares both sides of a non-restricted conflict (never started for Restricted fields)
- [conflicts.confirm](../capabilities/conflicts.confirm.md): Confirm the assistant proposal on a protected field (the Answer task action in Needs you)
- [conflicts.counts](../capabilities/conflicts.counts.md): Counts of open, needs-you and resolved conflicts for the sync status line
- [conflicts.field_history](../capabilities/conflicts.field_history.md): Previous values and merge losers of one field (field_history joined to resolutions)
- [conflicts.get](../capabilities/conflicts.get.md): Read one conflict with both values, the base, the proposal and the resolution
- [conflicts.list](../capabilities/conflicts.list.md): List conflicts and resolutions for the Conflicts tab
- [conflicts.log_binary](../capabilities/conflicts.log_binary.md): Record a binary file conflict: the newest save stays current and the other becomes a labelled version with a Conflicts row
- [conflicts.propose](../capabilities/conflicts.propose.md): Store the assistant proposal for a conflict; protected fields (status, money, owner, locked, sealed) go to Needs you for confirmation, others resolve
- [conflicts.redo](../capabilities/conflicts.redo.md): Redo an undone resolution
- [conflicts.resolve](../capabilities/conflicts.resolve.md): Resolve a conflict with a choice and a summary; applies the value as the person and writes an Undo op
- [conflicts.undo](../capabilities/conflicts.undo.md): Undo a resolution: re-applies the previous value as a normal op

## Events (6)

- [conflict.binary_logged](../events/conflict.binary_logged.md): Two saves of a binary file collided; the other became a labelled version
- [conflict.confirmation_needed](../events/conflict.confirmation_needed.md): A protected field conflict waits for the person to confirm or choose
- [conflict.proposed](../events/conflict.proposed.md): The assistant proposed a choice for a conflict
- [conflict.redone](../events/conflict.redone.md): An undone resolution was restored
- [conflict.resolved](../events/conflict.resolved.md): A conflict was resolved (summary and choice, values never in the payload)
- [conflict.undone](../events/conflict.undone.md): A resolution was undone
