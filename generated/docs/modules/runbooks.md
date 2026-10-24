# Runbooks (runbooks)

Lane L4. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (7)

- [runbooks.list](../capabilities/runbooks.list.md): List runbook files (markdown with fenced shell blocks) the caller can open
- [runbooks.parse](../capabilities/runbooks.parse.md): Find the fenced shell blocks of a runbook and the saved Runs on target
- [runbooks.run](../capabilities/runbooks.run.md): Run one block or all blocks of a runbook on a target; Run all stops at the first error
- [runbooks.runs.get](../capabilities/runbooks.runs.get.md): One run with the output of each block (kept as run logs)
- [runbooks.runs.list](../capabilities/runbooks.runs.list.md): History of runs of a runbook: who, where, when, exit and duration
- [runbooks.set_target](../capabilities/runbooks.set_target.md): Save where a runbook runs (the Runs on bar)
- [runbooks.targets](../capabilities/runbooks.targets.md): Places the caller may run on: the server and the agent computers they can use

## Events (4)

- [runbook.block_finished](../events/runbook.block_finished.md): One block of a runbook finished
- [runbook.run_finished](../events/runbook.run_finished.md): A runbook run ended
- [runbook.run_started](../events/runbook.run_started.md): A runbook run began
- [runbook.target_set](../events/runbook.target_set.md): The Runs on target of a runbook changed
