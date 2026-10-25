# Scheduler (scheduler-api)

Lane L6. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (18)

- [scheduler.cancel](../capabilities/scheduler.cancel.md): Cancel a schedule
- [scheduler.catch_up](../capabilities/scheduler.catch_up.md): After downtime apply each schedule if-missed rule: run once if within the missed window, else skip with a note in the owner digest
- [scheduler.fire](../capabilities/scheduler.fire.md): Fire a due schedule: invoke its capability as its principal (called by the host tick)
- [scheduler.get](../capabilities/scheduler.get.md): Read one schedule
- [scheduler.list](../capabilities/scheduler.list.md): List schedules by owner, with next and last fire times
- [scheduler.missed](../capabilities/scheduler.missed.md): Schedules missed in a period and what was done about each
- [scheduler.next_times](../capabilities/scheduler.next_times.md): The next fire times of a cron or schedule, for the editor preview
- [scheduler.pause](../capabilities/scheduler.pause.md): Pause a schedule with a visible reason
- [scheduler.reschedule](../capabilities/scheduler.reschedule.md): Change the time, cron or if-missed rule of a schedule
- [scheduler.resume](../capabilities/scheduler.resume.md): Resume a paused schedule
- [scheduler.run_now](../capabilities/scheduler.run_now.md): Fire a schedule once now without changing its cron
- [scheduler.schedule](../capabilities/scheduler.schedule.md): Schedule a capability call at a time or on a cron as a principal, with an if-missed rule
- [scheduler.status](../capabilities/scheduler.status.md): Cheap health probe of the scheduler: tick lag, due schedules, open waits
- [scheduler.waits.cancel](../capabilities/scheduler.waits.cancel.md): Cancel a wait
- [scheduler.waits.expire](../capabilities/scheduler.waits.expire.md): Expire waits past their timeout and wake their owners with a timeout result
- [scheduler.waits.list](../capabilities/scheduler.waits.list.md): List open waits by Run, subject or thread
- [scheduler.waits.match](../capabilities/scheduler.waits.match.md): Match an event against open waits by event type and filter hash and wake the thread, step or Journey (called by the event consumer)
- [scheduler.waits.register](../capabilities/scheduler.waits.register.md): Register a background wait on an event, a Run or a time with a timeout (default 30 days) and cancel conditions

## Events (10)

- [schedule.canceled](../events/schedule.canceled.md): A schedule was canceled
- [schedule.created](../events/schedule.created.md): A schedule was created
- [schedule.fired](../events/schedule.fired.md): A schedule fired its call
- [schedule.missed](../events/schedule.missed.md): A schedule was missed while the server was down and handled by its if-missed rule
- [schedule.paused](../events/schedule.paused.md): A schedule was paused, with the visible reason
- [schedule.resumed](../events/schedule.resumed.md): A paused schedule resumed
- [wait.canceled](../events/wait.canceled.md): A wait was canceled: its subject record was deleted or left the stage, or the Run was stopped
- [wait.expired](../events/wait.expired.md): A wait reached its timeout
- [wait.matched](../events/wait.matched.md): A wait matched an event, a Run or a time and woke its thread
- [wait.registered](../events/wait.registered.md): A background wait was registered
