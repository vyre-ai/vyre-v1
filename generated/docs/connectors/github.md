# GitHub

Key github, module github. Mode oauth_app, owned by a space. Auth oauth2.

## Egress domains

- api.github.com
- github.com

## Secrets (names only)

- GitHub_App_Key: GitHub App private key (PEM) used to mint installation tokens
- GitHub_App_Client_Secret: GitHub App OAuth client secret (sign in)
- GitHub_App_Webhook_Secret: Secret that signs /hooks/github

## Webhook sources

- /hooks/github (hmac) emits github.event_received

## Actions

- github.app.create_manifest
- github.app.complete
- github.app.get
- github.installations.list
- github.repos.list
- github.repo.get
- github.branches.list
- github.installation_token
- github.health
- github.pull_request.get
- github.pull_request.list_files
- github.pull_request.diff
- github.pull_request.checks
- github.pull_request.create
- github.pull_request.update
- github.pull_request.comment
- github.pull_request.request_review
- github.pull_request.merge
- github.pull_request.close
- github.pull_request.rerun_checks
- github.pull_request.ask_author_fix
- github.issue.get
- github.issue.create
- github.issue.update
- github.issue.comment
- github.issue.close
- github.issue.assign_agent
- github.receive_webhook

## Synced types

- pull_request from pulls
- issue from issues
