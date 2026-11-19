# Runs (runs)

Lane L6. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (43)

- [runs.activity.list](../capabilities/runs.activity.list.md): Everything of the agent work tree that is running, asleep or paused for the person (or for everyone, for someone who manages runs), newest first
- [runs.board.answer](../capabilities/runs.board.answer.md): The parent, the owner or a manager answers a question on the board
- [runs.board.list](../capabilities/runs.board.list.md): The board of a tree: what its nodes know together, newest last
- [runs.board.put](../capabilities/runs.board.put.md): A node writes to the board of its tree: a fact or decision with what it stands on, or a question
- [runs.count](../capabilities/runs.count.md): Count Runs by status for badges (failed runs in Needs you, running now)
- [runs.erase](../capabilities/runs.erase.md): Erase one Run for good with its steps, waits and alerts (governance erase)
- [runs.events.list](../capabilities/runs.events.list.md): A tree's events since a cursor, in order (one node's with runId)
- [runs.finish](../capabilities/runs.finish.md): Finish a Run as succeeded, failed or stopped with cost and a one-line result
- [runs.get](../capabilities/runs.get.md): Read one Run: status, owner, key and model used, cost, thread, trace
- [runs.list](../capabilities/runs.list.md): List Runs by owner, subject, kind and status; scope all is for Manage holders and the Console
- [runs.mark_waiting](../capabilities/runs.mark_waiting.md): Mark a Run as waiting for approval, background work or a key
- [runs.message.list](../capabilities/runs.message.list.md): The messages of a node, sent and received, with how far each got; with tree the messages of the whole tree
- [runs.message.seen](../capabilities/runs.message.seen.md): The server marks delivered messages as read by their receiver
- [runs.message.send](../capabilities/runs.message.send.md): A node tells another node of its tree something (a sibling, or its parent); it is read at the receiver's next step
- [runs.message.take](../capabilities/runs.message.take.md): The server hands a node what waits for it and marks it delivered, once
- [runs.node.beat](../capabilities/runs.node.beat.md): A worker's heartbeat on a node it holds; false means the lease is gone and the worker must stop
- [runs.node.claim](../capabilities/runs.node.claim.md): Take a queued node for a worker: queued to running with a lease; returns the node, or none when it was not free
- [runs.node.control](../capabilities/runs.node.control.md): Pause, resume or stop a node and, with subtree, everything under it (the owner or someone who manages runs)
- [runs.node.event](../capabilities/runs.node.event.md): Add one event to the record of a node, idempotent by key; a usage event adds to the spend of that node once
- [runs.node.get](../capabilities/runs.node.get.md): Read one node of the agent work tree
- [runs.node.label](../capabilities/runs.node.label.md): Give a node its name, once the task it was asked is known (the server)
- [runs.node.move](../capabilities/runs.node.move.md): Move a node to another state; the one way a node changes state (a node already there answers as a no-op, a finished one refuses)
- [runs.node.reclaim](../capabilities/runs.node.reclaim.md): Put nodes whose worker stopped beating back in the queue with the next attempt (the host's sweep)
- [runs.node.start](../capabilities/runs.node.start.md): Make a node in the agent work tree: a turn, helper, subagent, handoff, ask, watcher, terminal command or job (the engine, chat and terminal call this)
- [runs.people_counts](../capabilities/runs.people_counts.md): How many Runs each person's own agents have, counted and never listed: an admin sees the number, not the work
- [runs.pin_version](../capabilities/runs.pin_version.md): Move an active Run onto a definition version without replaying its steps
- [runs.preview_undo](../capabilities/runs.preview_undo.md): Show what Undo this run would reverse and what it cannot (sent messages and deployments)
- [runs.purge](../capabilities/runs.purge.md): Remove Runs and step logs older than a time, a batch at a time (retention)
- [runs.record_key](../capabilities/runs.record_key.md): Record the key and model a step used, or a fallback to the backup key
- [runs.record_step](../capabilities/runs.record_step.md): Write one row of the durable step log (state, input and output refs, error, trace span)
- [runs.replay](../capabilities/runs.replay.md): Replay a past Run in the sandbox: outward steps are recorded, never executed; sealed and Restricted values are synthetic unless the replayer holds clearance
- [runs.resume](../capabilities/runs.resume.md): Continue a waiting Run
- [runs.retry](../capabilities/runs.retry.md): Retry a failed or stopped Run from the start or from a step
- [runs.start](../capabilities/runs.start.md): Create a Run record (engine, Gate and other modules call this for any long-lived work)
- [runs.states](../capabilities/runs.states.md): System: the status of many Runs at once (up to 200); every id asked gets an answer: its status, or "gone" for a Run that is not there. For the host's sweeps, so a pass over open fires costs one call, not one per fire
- [runs.status](../capabilities/runs.status.md): Cheap health probe of the Run engine: queue depth, oldest queued Run, stuck Runs
- [runs.step_io](../capabilities/runs.step_io.md): What one step of a Run was given and what it answered, as the step log holds them, with anything that looks like a key hidden
- [runs.steps](../capabilities/runs.steps.md): The durable step log of a Run
- [runs.stop](../capabilities/runs.stop.md): Stop a Run (owner or Manage holder); stoppable work halts at the next safe point
- [runs.tree.find](../capabilities/runs.tree.find.md): The trees of agent work that ran in a chat or in a helper's own thread, newest first, with the root of each (only those the person may see; full says whether they see all of it or only that it goes on)
- [runs.tree.get](../capabilities/runs.tree.get.md): Read a whole tree of agent work: every node, with what each has spent and what it waits for
- [runs.undo](../capabilities/runs.undo.md): Undo this run: replay the inverse of its writes for events still at the Run version and report the rest
- [runs.wait_for](../capabilities/runs.wait_for.md): Wait in the background for an event, another Run or a time; ends the turn and wakes the thread on a match (default timeout 30 days)

## Events (13)

- [run.erased](../events/run.erased.md): A Run was erased for good with its steps (ids only)
- [run.failed](../events/run.failed.md): A Run failed; it lands in the owner Needs you
- [run.key_fallback](../events/run.key_fallback.md): A lost key fell back to the backup key (the Run chat records it)
- [run.node_ended](../events/run.node_ended.md): A node of the agent work tree is over (done, failed or stopped); it carries no words, so everyone who may hear of it learns state only: read the node for what it found. Native nodes only: a routine, wait or terminal Run mirrored into the tree is waited for as a Run
- [run.node_state](../events/run.node_state.md): A node of the agent work tree changed state
- [run.resumed](../events/run.resumed.md): A waiting Run continued
- [run.retried](../events/run.retried.md): A Run was retried; the new Run points at the old one
- [run.started](../events/run.started.md): A Run started
- [run.stopped](../events/run.stopped.md): A Run was stopped by its owner or a Manage holder
- [run.succeeded](../events/run.succeeded.md): A Run finished
- [run.undone](../events/run.undone.md): The writes of a Run were undone where possible
- [run.waiting](../events/run.waiting.md): A Run is waiting for approval, background work or a key
- [runs.purged](../events/runs.purged.md): Runs past their retention were removed with their step logs (a count)
