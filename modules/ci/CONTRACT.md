# CI runners: what the UI needs

The backend is done and has no UI. A Space's GitHub Actions jobs run on throwaway cloud machines the Space pays for. One machine runs one job and is deleted. Nobody's own computer and not the Space server is ever used.

## Where it shows
- **CI tab on a project**: only when `ci.project.get({ projectId })` says `linked: true` (the project's Files folder has a GitHub remote). Show the tab when `linked` is true; show a quiet "Runners are off" state when `enabled` is false.
- **Console, Computers, "Cloud runners"**: the admin's card for the settings and the month's cost.

## Capabilities
| Capability | Who | Use |
|---|---|---|
| `ci.project.get({ projectId })` | anyone in the project | `{ linked, repo, enabled, labels, live, queued }`: decides the tab and its header counts |
| `ci.runs.list({ projectId or repo, state?, cursor?, limit? })` | anyone in the project; admins by repo | Runs, newest first, with `next` cursor |
| `ci.runs.get({ runId })` | same | One run |
| `ci.settings.get()` | admin | `{ settings, keyReady }` |
| `ci.settings.set({ ...fields })` | admin, audited | Any subset of the fields below; returns `{ settings }` |
| `ci.cost.month({ month? })` | admin | `{ month, spentUsd, capUsd, leftUsd, runs, paused, byRepo[] }` |

## Settings fields
`enabled` (bool), `provider` ("digitalocean", read only today), `vaultKeyRef` (a Vault handle such as `#Northwind_DO`, or null; the key is never shown), `region` (default fra1), `size` (default s-2vcpu-4gb; one of s-1vcpu-1gb, s-1vcpu-2gb, s-2vcpu-2gb, s-2vcpu-4gb, s-4vcpu-8gb, s-8vcpu-16gb), `image` (default ubuntu-24-04-x64 or a snapshot id), `maxConcurrent` (1 to 20, default 3), `monthlyCapUsd` (default 0; must be above 0 to turn on), `maxJobMinutes` (5 to 360, default 60), `labels` (1 to 5, default ["vyre"]; a workflow asks for runners with `runs-on: [self-hosted, vyre]`).

Turning on needs a key and a cap above zero, else `validation.precondition_failed` with a plain message to show as is. A size outside the list is `validation.bad_input`.

## A run row
`runId, jobId, workflowRunId, repo, jobName, projectId, state, dropletId, size, queuedAt, startedAt, endedAt, conclusion, costUsd, note`.
States: `queued` (waiting for a free machine, `note` says "Waiting for a free machine: 3 of 3 are busy."), `starting`, `running`, `finished` (`conclusion` is GitHub's), `failed` (`note` says why in plain words), `swept` (the sweeper deleted it), `refused` (`note` says why: a fork with secrets, or "CI paused: this month's cap of $X is reached"). `costUsd` is final once `endedAt` is set; for a `running` run compute the live figure from `startedAt` and the size.

## Events (for live refresh)
`ci.run.started`, `ci.run.finished`, `ci.run.failed`, `ci.run.swept`, `ci.job.refused` (with `code`: fork_with_secrets, cap_reached, not_enabled, no_key), `ci.settings_changed`, and `ci.paused` (the admins get an Inbox line "CI paused: this month's cap of $X is reached").

## Things the UI should say plainly
- Cost is per second, at least 60 seconds and one cent per machine, billed to the Space's own cloud account. GitHub minutes are not used.
- A pull request from a fork does not run on a cloud machine while the repository holds secrets.
- The GitHub App needs the new permissions (Actions read, Administration write, Secrets read) and the workflow_job event. A Space whose App was made before this must accept them in GitHub; until then a job simply stays on GitHub.
