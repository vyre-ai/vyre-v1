# Tasks (tasks)

Lane L6. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (37)

- [tasks.act](../capabilities/tasks.act.md): Act on a request at its source: approve, reject, send back, answer, resolve, with a note; continues the chat or run at once
- [tasks.ask](../capabilities/tasks.ask.md): Ask a question while you work on a task: an Answer task opens for the requester or a named person, the work waits, and the answer wakes you
- [tasks.assign](../capabilities/tasks.assign.md): Set or clear a slot: Assigned, Reviewer or Approver (person, agent, group, role or automation)
- [tasks.block](../capabilities/tasks.block.md): Report what is in the way of a task: an Unblock task opens for whoever the task escalates to, and the work waits
- [tasks.by_key](../capabilities/tasks.by_key.md): Find a task by its short key, such as VY-123
- [tasks.count_needs_you](../capabilities/tasks.count_needs_you.md): Count of Ready requests for the rail badge and the Space switcher dot
- [tasks.create](../capabilities/tasks.create.md): Create a task of any kind (Work by default); Approve, Review, Answer and Unblock requests come from the Gate, agents and Journeys
- [tasks.decide](../capabilities/tasks.decide.md): Decide on reviewed work: approve it (Done, held actions release) or reject it with a reason (back to the doer)
- [tasks.delegate](../capabilities/tasks.delegate.md): Hand a request to someone else with a note; never widens access, so it walks the delegate chain to the first who can act
- [tasks.delete](../capabilities/tasks.delete.md): Delete a task; Undo brings it back. A held act and a task a Run waits on are canceled instead
- [tasks.dependencies.add](../capabilities/tasks.dependencies.add.md): Make a task wait on another; Blocked is derived from unmet dependencies and open Unblock children
- [tasks.dependencies.remove](../capabilities/tasks.dependencies.remove.md): Remove a dependency
- [tasks.digest](../capabilities/tasks.digest.md): What an agent should keep in mind: the task bound to this thread, its parent and siblings in a line each, then its own open tasks, the top five and a count. About 300 tokens; detail stays one tasks_get away
- [tasks.escalate](../capabilities/tasks.escalate.md): Pass a task to the delegate or role after its timeout (called by the scheduler and the Gate)
- [tasks.followers.add](../capabilities/tasks.followers.add.md): Add a follower; plain @mentions become followers, never tasks
- [tasks.followers.remove](../capabilities/tasks.followers.remove.md): Remove a follower
- [tasks.get](../capabilities/tasks.get.md): Read one task with its blocks, slots, links, notes and followers
- [tasks.history](../capabilities/tasks.history.md): Activity of a task: transitions, hand-overs, notes and sends back, newest first
- [tasks.index](../capabilities/tasks.index.md): The long list of a scope in one read: a light row per task with its rollup, ordered newest first; pass the last rev and an unchanged list answers nothing
- [tasks.links.add](../capabilities/tasks.links.add.md): Link a record or a file to a task
- [tasks.links.remove](../capabilities/tasks.links.remove.md): Remove a record or file link from a task
- [tasks.list](../capabilities/tasks.list.md): List tasks by scope (mine, assigned by me, following, a record, a run) and filters
- [tasks.my_work](../capabilities/tasks.my_work.md): My work: the full list, with sections Open, Assigned by me, Done
- [tasks.needs_you](../capabilities/tasks.needs_you.md): Needs you: my Ready tasks of kind Approve, Review, Answer or Unblock, plus due today, overdue or blocking others
- [tasks.plan](../capabilities/tasks.plan.md): Break work into tasks in one step: a parent (new, or one that exists) and its children, each with its brief, what done means, who does it and which others it waits on. A child starts by itself when what it waits on is done; the parent hears only when all are done, or one is blocked or asks
- [tasks.release](../capabilities/tasks.release.md): Give a taken task back to its group or role
- [tasks.restore](../capabilities/tasks.restore.md): Bring a deleted task back
- [tasks.rev](../capabilities/tasks.rev.md): A short mark that changes whenever any task changes, for a screen that holds a long list
- [tasks.review](../capabilities/tasks.review.md): Review submitted work: approve it, or send it back with numbered fixes (after the loop limit a person decides)
- [tasks.snooze](../capabilities/tasks.snooze.md): Snooze an open task until a time, or clear the snooze with null
- [tasks.submit](../capabilities/tasks.submit.md): Hand in your part of a work task with its outputs and a one-line summary; it goes to the Reviewer, else the Approver, else Done
- [tasks.take](../capabilities/tasks.take.md): Take a group or role task; the first Take locks it and others see taken by
- [tasks.transition](../capabilities/tasks.transition.md): Move a task to a new status (the only writer of status); checks the 4.7 state table and the reviewer/approver rules
- [tasks.update](../capabilities/tasks.update.md): Edit the title, summary, why, due, effort or content blocks of a task, or link its thread when it has none (status goes through tasks.transition)
- [tasks.withdraw](../capabilities/tasks.withdraw.md): Withdraw open requests whose source chat or run stopped or whose item changed, or let one task go, with a note
- [tasks.working_notes.delete](../capabilities/tasks.working_notes.delete.md): Delete a working note
- [tasks.working_notes.set](../capabilities/tasks.working_notes.set.md): Write a working note (key and value) that any person or agent on the task can read

## Events (24)

- [task.approved](../events/task.approved.md): A review or approval was granted
- [task.assigned](../events/task.assigned.md): A slot (Assigned, Reviewer or Approver) was set or changed
- [task.children_settled](../events/task.children_settled.md): The children of a task need its holder: all finished, or one is blocked or asks
- [task.completed](../events/task.completed.md): A task reached Done
- [task.created](../events/task.created.md): A task was created
- [task.delegated](../events/task.delegated.md): A task was handed over with a note
- [task.deleted](../events/task.deleted.md): A task was deleted; it can come back with Undo
- [task.escalated](../events/task.escalated.md): A task passed to a delegate or role after its timeout
- [task.follower_added](../events/task.follower_added.md): A follower was added
- [task.follower_removed](../events/task.follower_removed.md): A follower was removed
- [task.handled](../events/task.handled.md): A request addressed to a role was resolved by the first action; others see handled by
- [task.link_changed](../events/task.link_changed.md): A record or file link, or a dependency, was added or removed
- [task.note_set](../events/task.note_set.md): A working note (key and value) was written by a person or agent
- [task.ready](../events/task.ready.md): Everything a task waited on finished, so it can start
- [task.rejected](../events/task.rejected.md): An approver rejected the work with a note
- [task.released](../events/task.released.md): A taken task went back to the group or role
- [task.requested](../events/task.requested.md): A request (Approve, Review, Answer or Unblock) is waiting on someone
- [task.restored](../events/task.restored.md): A deleted task came back
- [task.sent_back](../events/task.sent_back.md): A reviewer or approver sent work back with a note
- [task.snoozed](../events/task.snoozed.md): A request was snoozed until a time
- [task.taken](../events/task.taken.md): A person took a group or role task; it is locked to them
- [task.transitioned](../events/task.transitioned.md): A task changed status
- [task.updated](../events/task.updated.md): Fields of a task changed (title, summary, why, due, effort, blocks, links)
- [task.withdrawn](../events/task.withdrawn.md): A request or a task was withdrawn because its source chat or run stopped, the item changed or someone let it go
