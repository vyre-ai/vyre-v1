# Runs (runs)

Lane L6. Kind module. Status stub. Version 0.1.0.

Requires: nothing.

## Capabilities (17)

- [runs.count](../capabilities/runs.count.md): Count Runs by status for badges (failed runs in Needs you, running now)
- [runs.finish](../capabilities/runs.finish.md): Finish a Run as succeeded, failed or stopped with cost and a one-line result
- [runs.get](../capabilities/runs.get.md): Read one Run: status, owner, key and model used, cost, thread, trace
- [runs.list](../capabilities/runs.list.md): List Runs by owner, subject, kind and status; scope all is for Manage holders and the Console
- [runs.mark_waiting](../capabilities/runs.mark_waiting.md): Mark a Run as waiting for approval, background work or a key
- [runs.preview_undo](../capabilities/runs.preview_undo.md): Show what Undo this run would reverse and what it cannot (sent messages and deployments)
- [runs.record_key](../capabilities/runs.record_key.md): Record the key and model a step used, or a fallback to the backup key
- [runs.record_step](../capabilities/runs.record_step.md): Write one row of the durable step log (state, input and output refs, error, trace span)
- [runs.replay](../capabilities/runs.replay.md): Replay a past Run in the sandbox: outward steps are recorded, never executed; sealed and Restricted values are synthetic unless the replayer holds clearance
- [runs.resume](../capabilities/runs.resume.md): Continue a waiting Run
- [runs.retry](../capabilities/runs.retry.md): Retry a failed or stopped Run from the start or from a step
- [runs.start](../capabilities/runs.start.md): Create a Run record (engine, Gate and other modules call this for any long-lived work)
- [runs.status](../capabilities/runs.status.md): Cheap health probe of the Run engine: queue depth, oldest queued Run, stuck Runs
- [runs.steps](../capabilities/runs.steps.md): The durable step log of a Run
- [runs.stop](../capabilities/runs.stop.md): Stop a Run (owner or Manage holder); stoppable work halts at the next safe point
- [runs.undo](../capabilities/runs.undo.md): Undo this run: replay the inverse of its writes for events still at the Run version and report the rest
- [runs.wait_for](../capabilities/runs.wait_for.md): Wait in the background for an event, another Run or a time; ends the turn and wakes the thread on a match (default timeout 30 days)

## Events (9)

- [run.failed](../events/run.failed.md): A Run failed; it lands in the owner Needs you
- [run.key_fallback](../events/run.key_fallback.md): A lost key fell back to the backup key (the Run chat records it)
- [run.resumed](../events/run.resumed.md): A waiting Run continued
- [run.retried](../events/run.retried.md): A Run was retried; the new Run points at the old one
- [run.started](../events/run.started.md): A Run started
- [run.stopped](../events/run.stopped.md): A Run was stopped by its owner or a Manage holder
- [run.succeeded](../events/run.succeeded.md): A Run finished
- [run.undone](../events/run.undone.md): The writes of a Run were undone where possible
- [run.waiting](../events/run.waiting.md): A Run is waiting for approval, background work or a key
