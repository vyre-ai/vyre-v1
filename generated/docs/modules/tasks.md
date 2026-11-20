# Tasks (tasks)

Lane L6. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (46)

- [tasks.act](../capabilities/tasks.act.md): Act on a request at its source: approve, reject, send back, answer or resolve, with a note; the chat or run goes on at once
- [tasks.agent_on_it](../capabilities/tasks.agent_on_it.md): Say an agent is on a task for its assignee: it moves to Doing and reads "<Agent> is on it for you". Only they or the host
- [tasks.archive](../capabilities/tasks.archive.md): Put away a task that no longer matters, with why; back: true puts it back. Not deleted
- [tasks.ask](../capabilities/tasks.ask.md): Ask a question while you work: an Answer task opens for the requester or a named person, the work waits and the answer wakes you
- [tasks.assign](../capabilities/tasks.assign.md): Set or clear Assigned, Reviewer or Approver (person, agent, group, role or automation)
- [tasks.block](../capabilities/tasks.block.md): Report what is in the way: an Unblock task opens for whoever the task escalates to, and the work waits
- [tasks.by_key](../capabilities/tasks.by_key.md): Find a task by its short key, such as VY-123
- [tasks.changes](../capabilities/tasks.changes.md): What the Space did to my tasks since a time (put away because they passed, their chat closed, nobody answered), each with its reason; and how many new ones wait on me. Built from the log
- [tasks.clock](../capabilities/tasks.clock.md): What the clock moves, once a minute: the day a task is due begins for its holder, a due time passes, a snooze ends, a step sat with someone too long
- [tasks.count_needs_you](../capabilities/tasks.count_needs_you.md): Count of Ready requests for the rail badge and the Space switcher dot
- [tasks.create](../capabilities/tasks.create.md): Create a task
- [tasks.decide](../capabilities/tasks.decide.md): Decide on reviewed work: approve (Done, held actions release) or reject with a reason
- [tasks.delegate](../capabilities/tasks.delegate.md): Hand a request to someone else with a note; never widens access: walks the delegate chain to the first who can act
- [tasks.delete](../capabilities/tasks.delete.md): Delete a task (Undo restores it); a held act or a task a Run waits on is canceled
- [tasks.dependencies.add](../capabilities/tasks.dependencies.add.md): Make a task wait on another; Blocked comes from unmet dependencies and open Unblocks
- [tasks.dependencies.remove](../capabilities/tasks.dependencies.remove.md): Remove a dependency
- [tasks.digest](../capabilities/tasks.digest.md): What an agent should keep in mind: this thread's task, its parent and siblings, then its own open tasks (top five and a count). About 300 tokens; tasks_get has detail. Leave out agentId for yourself
- [tasks.done_when](../capabilities/tasks.done_when.md): What proves a task done; it closes itself. No kind clears
- [tasks.escalate](../capabilities/tasks.escalate.md): Pass a task to the delegate or role after its timeout (called by the scheduler and the Gate)
- [tasks.followers.add](../capabilities/tasks.followers.add.md): Add a follower; plain @mentions become followers, never tasks
- [tasks.followers.remove](../capabilities/tasks.followers.remove.md): Remove a follower
- [tasks.get](../capabilities/tasks.get.md): Read one task with blocks, slots, links, notes and followers
- [tasks.held_revise](../capabilities/tasks.held_revise.md): Rewrite the card of a held act and the hash its approval is bound to (the Gate's edit of a held message; not for a person or an agent to call)
- [tasks.history](../capabilities/tasks.history.md): Activity of a task: transitions, hand-overs, notes, sends back; newest first
- [tasks.index](../capabilities/tasks.index.md): A scope's long list in one read: a light row per task, newest first; send the last rev and an unchanged list answers nothing
- [tasks.links.add](../capabilities/tasks.links.add.md): Link a record or file to a task
- [tasks.links.remove](../capabilities/tasks.links.remove.md): Remove a record or file link
- [tasks.list](../capabilities/tasks.list.md): List tasks by scope (mine, given by me, following, a record, a run) and filters
- [tasks.my_work](../capabilities/tasks.my_work.md): My work: the full list in sections Open, Assigned by me, Done
- [tasks.needs_you](../capabilities/tasks.needs_you.md): Needs you: my Ready Approve, Review, Answer and Unblock tasks, plus due today, overdue or blocking
- [tasks.plan](../capabilities/tasks.plan.md): Break work into a parent (new or existing) and children in one step, each with brief, what done means, owner and dependencies. A child starts when they are done; the parent hears only when all are done or one is blocked or asks
- [tasks.release](../capabilities/tasks.release.md): Give a taken task back to its group or role
- [tasks.restore](../capabilities/tasks.restore.md): Bring a deleted task back
- [tasks.rev](../capabilities/tasks.rev.md): A mark that changes when any task changes, for a screen with a long list
- [tasks.review](../capabilities/tasks.review.md): Review submitted work: approve, or send back with numbered fixes (after the loop limit a person decides)
- [tasks.snooze](../capabilities/tasks.snooze.md): Snooze an open task until a time; null clears the snooze
- [tasks.still_answer](../capabilities/tasks.still_answer.md): Answer the card for one or several tasks: keep (not asked again for 90 days) or archive (put away, Put back undoes it)
- [tasks.still_needed](../capabilities/tasks.still_needed.md): The card Still need these?: tasks the Space cannot tell about (a guessed moment passed), each with why it is asked; at most seven, oldest first
- [tasks.submit](../capabilities/tasks.submit.md): Hand in your part with outputs and a one-line summary; it goes to the Reviewer, else Approver, else Done
- [tasks.take](../capabilities/tasks.take.md): Take a group or role task; the first Take locks it
- [tasks.transition](../capabilities/tasks.transition.md): Move a task to a new status (the only writer of status); checks the state table and reviewer/approver rules
- [tasks.unarchive](../capabilities/tasks.unarchive.md): Put an archived task back
- [tasks.update](../capabilities/tasks.update.md): Edit title, summary, why, due, effort or blocks, or link its thread if none (status: tasks.transition)
- [tasks.withdraw](../capabilities/tasks.withdraw.md): Withdraw open requests whose source chat or run stopped or whose item changed, or let one task go, with a note
- [tasks.working_notes.delete](../capabilities/tasks.working_notes.delete.md): Delete a working note
- [tasks.working_notes.set](../capabilities/tasks.working_notes.set.md): Write a working note (key, value) everyone on the task can read; send expectedFrom: the note as you last read it

## Events (28)

- [task.approved](../events/task.approved.md): A review or approval was granted
- [task.archived](../events/task.archived.md): A task was put away with its reason; it is not deleted and can be put back
- [task.assigned](../events/task.assigned.md): A slot (Assigned, Reviewer or Approver) was set or changed
- [task.children_settled](../events/task.children_settled.md): The children of a task need its holder: all finished, or one is blocked or asks
- [task.completed](../events/task.completed.md): A task reached Done
- [task.created](../events/task.created.md): A task was created
- [task.delegated](../events/task.delegated.md): A task was handed over with a note
- [task.deleted](../events/task.deleted.md): A task was deleted; it can come back with Undo
- [task.due](../events/task.due.md): A due date reached its holder: the day it is due began in their time zone, or the time passed
- [task.escalated](../events/task.escalated.md): A task passed to a delegate or role after its timeout
- [task.follower_added](../events/task.follower_added.md): A follower was added
- [task.follower_removed](../events/task.follower_removed.md): A follower was removed
- [task.handled](../events/task.handled.md): A request addressed to a role was resolved by the first action; others see handled by
- [task.link_changed](../events/task.link_changed.md): A record or file link, or a dependency, was added or removed
- [task.note_set](../events/task.note_set.md): A working note (key and value) was written by a person or agent
- [task.nudged](../events/task.nudged.md): A step sat with someone too long, so they (or the person behind it) were reminded
- [task.ready](../events/task.ready.md): Everything a task waited on finished, so it can start
- [task.rejected](../events/task.rejected.md): An approver rejected the work with a note
- [task.released](../events/task.released.md): A taken task went back to the group or role
- [task.requested](../events/task.requested.md): A request (Approve, Review, Answer or Unblock) is waiting on someone, or the baton of a work task reached its next holder
- [task.restored](../events/task.restored.md): A deleted task came back
- [task.sent_back](../events/task.sent_back.md): A reviewer or approver sent work back with a note
- [task.snoozed](../events/task.snoozed.md): A request was snoozed until a time
- [task.taken](../events/task.taken.md): A person took a group or role task; it is locked to them
- [task.transitioned](../events/task.transitioned.md): A task changed status
- [task.unarchived](../events/task.unarchived.md): An archived task was put back
- [task.updated](../events/task.updated.md): Fields of a task changed (title, summary, why, due, effort, blocks, links)
- [task.withdrawn](../events/task.withdrawn.md): A request or a task was withdrawn because its source chat or run stopped, the item changed or someone let it go
