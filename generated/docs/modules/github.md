# GitHub (github)

Lane L5. Kind connector. Version 0.1.0.

Requires: nothing.

## Capabilities (42)

- [github.actions.secrets](../capabilities/github.actions.secrets.md): How many Actions secrets a repository holds; null when GitHub would not say
- [github.app.complete](../capabilities/github.app.complete.md): Finish the manifest flow: exchange the code, store the app key in the Vault and return the install link
- [github.app.create_manifest](../capabilities/github.app.create_manifest.md): Start the GitHub App manifest flow that creates the app in the organisation
- [github.app.get](../capabilities/github.app.get.md): Read the GitHub App (id, permissions, subscribed events)
- [github.branches.list](../capabilities/github.branches.list.md): List branches of a repository (branch picker)
- [github.health](../capabilities/github.health.md): Health probe: GET /app
- [github.installation_token](../capabilities/github.installation_token.md): Mint a short-lived installation token for git over HTTPS and return a filler handle, never the token
- [github.installations.list](../capabilities/github.installations.list.md): List installations of the App
- [github.issue.assign_agent](../capabilities/github.issue.assign_agent.md): Assign an issue to an agent: creates a task whose result lands as a linked changeset
- [github.issue.close](../capabilities/github.issue.close.md): Close an issue
- [github.issue.comment](../capabilities/github.issue.comment.md): Comment on an issue
- [github.issue.create](../capabilities/github.issue.create.md): Open an issue
- [github.issue.get](../capabilities/github.issue.get.md): Read an issue live from GitHub
- [github.issue.update](../capabilities/github.issue.update.md): Change the title, body, labels or assignees of an issue
- [github.me.approve](../capabilities/github.me.approve.md): Ask me before something uses my GitHub for this repository and kind of use (the Gate holds it; once I approve, it is good for ten minutes)
- [github.me.complete](../capabilities/github.me.complete.md): Finish connecting my GitHub: GitHub sent me back with a code; trade it, learn who I am on GitHub and keep the refresh token in my Vault
- [github.me.connect](../capabilities/github.me.connect.md): Start connecting my own GitHub: the address to send me to (the Space's own GitHub app when an admin set one up, else the default Vyre app), with PKCE. The refresh token ends up in my own Vault (Mine)
- [github.me.disconnect](../capabilities/github.me.disconnect.md): Disconnect my GitHub: revoke it, delete the refresh token from my Vault and forget approvals
- [github.me.policy.get](../capabilities/github.me.policy.get.md): What I let each kind of use do on GitHub: Always, Ask me first or Never
- [github.me.policy.set](../capabilities/github.me.policy.set.md): Change what I let a kind of use do: read, push a branch, open a pull request, comment, merge, push to the default branch
- [github.me.reach](../capabilities/github.me.reach.md): The repositories and organisations I reach through the app; each organisation says whether the app is installed on all repositories, chosen ones or not at all, and gives the address to install or ask
- [github.me.status](../capabilities/github.me.status.md): Is my GitHub connected, as whom, through which app, and does it need connecting again
- [github.me.usage](../capabilities/github.me.usage.md): Where my GitHub was last used, by consumer (crew, CI, linked pull requests, agent tools): the Used by list
- [github.pull_request.ask_author_fix](../capabilities/github.pull_request.ask_author_fix.md): Ask the author agent to fix a failing check: creates a task (at most 3 rounds per pull request)
- [github.pull_request.checks](../capabilities/github.pull_request.checks.md): Check runs of a pull request
- [github.pull_request.close](../capabilities/github.pull_request.close.md): Close a pull request without merging
- [github.pull_request.comment](../capabilities/github.pull_request.comment.md): Comment on a pull request
- [github.pull_request.create](../capabilities/github.pull_request.create.md): Open a pull request
- [github.pull_request.diff](../capabilities/github.pull_request.diff.md): Unified diff of a pull request (opens as a diff tab)
- [github.pull_request.get](../capabilities/github.pull_request.get.md): Read a pull request live from GitHub
- [github.pull_request.list_files](../capabilities/github.pull_request.list_files.md): Changed files of a pull request (the Changes tab)
- [github.pull_request.merge](../capabilities/github.pull_request.merge.md): Merge a pull request (protected branches go through the Gate)
- [github.pull_request.request_review](../capabilities/github.pull_request.request_review.md): Request a review
- [github.pull_request.rerun_checks](../capabilities/github.pull_request.rerun_checks.md): Re-run failed checks
- [github.pull_request.update](../capabilities/github.pull_request.update.md): Change the title, body, labels, assignees or base of a pull request
- [github.receive_webhook](../capabilities/github.receive_webhook.md): Record a verified GitHub delivery after dedupe; normalise push, pull request, issue, check and workflow events
- [github.repo.get](../capabilities/github.repo.get.md): Read one repository
- [github.repos.list](../capabilities/github.repos.list.md): List repositories the App can reach
- [github.runners.jit_config](../capabilities/github.runners.jit_config.md): Make a just-in-time runner for one job: GitHub answers a config the new machine runs with, once. Called by the CI module; the config is never stored
- [github.runners.remove](../capabilities/github.runners.remove.md): Take back a runner that never ran a job (its machine failed to start)
- [github.session_env](../capabilities/github.session_env.md): For one turn of Claude Code, Codex or Grok: GH_TOKEN and GITHUB_TOKEN as filler handles and a git credential helper, scoped to the owner's repositories the person lets run without asking
- [github.token](../capabilities/github.token.md): The one way to get a GitHub token: for a person (the caller, or an agent on that person's own turn), one repository and one kind of use; short-lived, narrowed to that, returned as a filler handle and never the token. Follows the person's Always, Ask me first or Never

## Events (15)

- [github.app_created](../events/github.app_created.md): The GitHub App was created and its key stored
- [github.check_completed](../events/github.check_completed.md): A check run finished
- [github.event_received](../events/github.event_received.md): A verified GitHub delivery arrived
- [github.fix_requested](../events/github.fix_requested.md): The author agent was asked to fix a failing check
- [github.issue_assigned](../events/github.issue_assigned.md): An issue was assigned to an agent
- [github.me_connected](../events/github.me_connected.md): A person connected their own GitHub
- [github.me_disconnected](../events/github.me_disconnected.md): A person disconnected their GitHub
- [issue.opened](../events/issue.opened.md): An issue was opened
- [pull_request.closed](../events/pull_request.closed.md): A pull request was closed without merging
- [pull_request.merged](../events/pull_request.merged.md): A pull request was merged
- [pull_request.opened](../events/pull_request.opened.md): A pull request was opened
- [repo.pushed](../events/repo.pushed.md): Commits were pushed to a branch
- [workflow.completed](../events/workflow.completed.md): A workflow run finished
- [workflow_job.completed](../events/workflow_job.completed.md): A workflow job finished, on any runner
- [workflow_job.queued](../events/workflow_job.queued.md): A workflow job is waiting for a runner; fork says whether its run came from another repository (unknown counts as a fork)
