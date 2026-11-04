# CI runners (ci)

Lane L5. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (8)

- [ci.cost.month](../capabilities/ci.cost.month.md): What CI cost this month so far (or the month given, written 2026-11), the cap, what is left, how many runs, and the cost by repository. Admin only
- [ci.job.intake](../capabilities/ci.job.intake.md): Host only: a job is waiting (or ended) on GitHub; start or stop its machine. Called for the workflow_job events, never by a person
- [ci.project.get](../capabilities/ci.project.get.md): Whether a project shows the CI tab: its repository is linked and runners are on. Anyone who can see the project
- [ci.runs.get](../capabilities/ci.runs.get.md): One run
- [ci.runs.list](../capabilities/ci.runs.list.md): Runs, newest first, for one project or one repository (give one); each has its state, machine, times and cost. Anyone who can see the project
- [ci.settings.get](../capabilities/ci.settings.get.md): The CI settings: whether runners are on, the cloud provider, the Vault item that holds its key (never the key), region, machine size, image, how many at once, the monthly cap, the time limit and the labels. Admin only
- [ci.settings.set](../capabilities/ci.settings.set.md): Turn runners on or off and change their settings. Admin only, audited. Turning them on needs a key (a Vault item) and a monthly cap
- [ci.sweep](../capabilities/ci.sweep.md): Host only: every 2 minutes, delete any machine tagged vyre-ci that is too old or has no live run, and start queued jobs that now fit

## Events (7)

- [ci.job.refused](../events/ci.job.refused.md): A job asked for a runner and was refused, with the reason in plain words
- [ci.paused](../events/ci.paused.md): CI paused: this month's cap is reached (once a month; the admins' Inbox line)
- [ci.run.failed](../events/ci.run.failed.md): A machine could not be made for a job, or it was lost before the job ran
- [ci.run.finished](../events/ci.run.finished.md): A job ended and its machine was deleted; the cost is recorded
- [ci.run.started](../events/ci.run.started.md): A cloud machine was made for a job and the runner is on it
- [ci.run.swept](../events/ci.run.swept.md): The sweeper deleted a machine: past its time limit, or with no live run
- [ci.settings_changed](../events/ci.settings_changed.md): An admin changed the CI settings (never the key)
