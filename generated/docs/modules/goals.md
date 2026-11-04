# Goals (goals)

Lane L6. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (27)

- [goals.activity](../capabilities/goals.activity.md): The activity of a goal, newest first: every reading, wake-up, step, task and status change, and why
- [goals.ask](../capabilities/goals.ask.md): Ask the owner (or a named person) for a decision only they can make: one Waiting-on item, with the options. The same decision asked again returns the first ask; the answer wakes you
- [goals.brief](../capabilities/goals.brief.md): What the lead agent of a goal reads at each wake-up: the finish line and where it stands, why it was woken, the plan, what waits, the budget and the rules
- [goals.checklist.tick](../capabilities/goals.checklist.tick.md): The owner ticks or unticks one condition of a checklist goal
- [goals.complete](../capabilities/goals.complete.md): When a goal ends (done or missed), write its retrospective: what worked, what did not, and a playbook worth repeating. It is saved to the goal, its project and Space memory. On an owner-says-done goal whose work is finished, it asks the owner to confirm instead
- [goals.confirm](../capabilities/goals.confirm.md): Start a drafted goal: the owner presses Start on its card, or an agent acting for the owner starts it with messageId, the message in which the owner asked for it, in the goal chat and under 15 minutes old. An agent start grants no permission. The standing permissions it names hold from this press
- [goals.count](../capabilities/goals.count.md): How many goals a project has, whoever may open them: a number and nothing else (never a title). Only a manager of the project or the system may ask; the Overview uses it to say how many goals a reader may not open
- [goals.create](../capabilities/goals.create.md): Give an agent a goal with a finish line: it plans the work as tasks, works across days, posts progress, asks for approvals and says when it is stuck. Drafted by an agent, it waits for its owner to press Start
- [goals.extend](../capabilities/goals.extend.md): Move the deadline of a goal; a missed goal starts again
- [goals.finish](../capabilities/goals.finish.md): The owner says a goal is done (the finish line of an owner-says-done goal, or done early)
- [goals.folder](../capabilities/goals.folder.md): The Files folder of a goal, where its plan, drafts, research and reports go; asking for a subfolder makes it the first time it is needed
- [goals.get](../capabilities/goals.get.md): One goal: its finish line and progress, the plan as tasks, who is helping, what waits on whom, budget used and the latest activity
- [goals.go](../capabilities/goals.go.md): System: may the work of a goal wake its agents now (false while it is a draft, paused or ended)
- [goals.list](../capabilities/goals.list.md): Goals by scope: mine, the ones I help with, a project, a record, a task, or all I can see
- [goals.mark_stuck](../capabilities/goals.mark_stuck.md): Say plainly that the goal cannot move: the reason and two options for the owner. The owner hears once; the goal shows Stuck until the number moves or the owner picks
- [goals.number.set](../capabilities/goals.number.set.md): The owner updates the number of a goal whose source is a number they keep
- [goals.pause](../capabilities/goals.pause.md): Pause a goal: no wake-ups and none of its tasks wake their agents until it is resumed
- [goals.plan](../capabilities/goals.plan.md): Add tasks to the plan of a goal: each with its brief, what done means, who does it (an agent, a person, a group) and what it waits on. They are tasks like any other and show "Part of" the goal
- [goals.progress](../capabilities/goals.progress.md): Where a goal stands: the number from its source, read now when asked, and its history
- [goals.report](../capabilities/goals.report.md): Post the check-in in the goal chat: the real number against the pace, what changed and why, what was done, the next best step. One per wake-up; short and specific
- [goals.resume](../capabilities/goals.resume.md): Resume a paused goal
- [goals.search_past](../capabilities/goals.search_past.md): Past goals in this Space with their outcome and retrospective, to learn what worked before planning
- [goals.sources](../capabilities/goals.sources.md): What a goal could count, for drafting a measurable finish line: record types with their counts, connections, and the outside MCP servers the lead can read
- [goals.step](../capabilities/goals.step.md): Before a step with an effect (a send, a post, a record change), claim it by id; a step already done answers done with its result, so a retried wake-up never repeats it. Finish it with finish true
- [goals.stop](../capabilities/goals.stop.md): Stop a goal for good: its open tasks are withdrawn and its permissions end
- [goals.update](../capabilities/goals.update.md): Change a goal: its title, finish line, deadline, lead, owner, drafted plan, budget, check-in rhythm, quiet hours, helpers, links or standing permissions (only the owner)
- [goals.wake_claim](../capabilities/goals.wake_claim.md): System: the engine claims one wake-up of a goal before it starts the turn, so a wake-up read twice runs once. Only the server may call it

## Events (12)

- [goal.budget_warned](../events/goal.budget_warned.md): A goal used 80 percent of its budget
- [goal.created](../events/goal.created.md): A goal was created, as a draft for its owner to start or started at once
- [goal.ended](../events/goal.ended.md): A goal ended: done, missed or stopped, with its summary
- [goal.extended](../events/goal.extended.md): The deadline of a goal moved
- [goal.progress](../events/goal.progress.md): The source of a goal was read
- [goal.reported](../events/goal.reported.md): The lead agent posted a goal update
- [goal.resumed](../events/goal.resumed.md): A paused goal goes on: the work its agents hold may wake again
- [goal.started](../events/goal.started.md): The owner started a goal: its standing permissions hold from now
- [goal.status_changed](../events/goal.status_changed.md): A goal changed status
- [goal.step_done](../events/goal.step_done.md): A step of a goal finished; a retried wake-up will not do it again
- [goal.updated](../events/goal.updated.md): Fields of a goal changed (finish line, deadline, budget, rhythm, helpers, links, permissions)
- [goal.woken](../events/goal.woken.md): The lead agent of a goal is due a turn in the goal chat (check-in, a task done, the number moved, an answer)
