# Sites (sites)

Lane L8. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (67)

- [sites.addon_add](../capabilities/sites.addon_add.md): Give a deployed site its own Postgres or Redis on this server, with its address set as DATABASE_URL or REDIS_URL. Its data stays on the server through redeploys
- [sites.addon_remove](../capabilities/sites.addon_remove.md): Remove a site's Postgres or Redis and its data
- [sites.artifact_open](../capabilities/sites.artifact_open.md): A short-lived address that opens an artifact for the person asking, in a tab or the browser
- [sites.artifact_publish](../capabilities/sites.artifact_publish.md): Needs a title and exactly one of html, fileId, folderId, path or port. THE way to show what you made: publishes it privately, the person gets a card to open. Example: artifact_publish {"title":"Q3 plan","html":"<h1>Q3</h1>"}. Same title or artifactId updates the link. No title: its <title> is used
- [sites.artifact_thumb_set](../capabilities/sites.artifact_thumb_set.md): Keep a small picture of an artifact, taken when someone opened it (the Vyre for Chrome extension sends it). It is set only when there is none yet or the artifact changed since the last one
- [sites.backup_create](../capabilities/sites.backup_create.md): Back up the site's Postgres now; read sites_backups_list to see it finish
- [sites.backup_delete](../capabilities/sites.backup_delete.md): Delete a backup and its file
- [sites.backup_download](../capabilities/sites.backup_download.md): Where to fetch a finished backup from: one address per part (a dump over 32 MB is kept in parts: join them in order). Readable by whoever can see the site
- [sites.backup_pin](../capabilities/sites.backup_pin.md): Keep a backup for good (the clean-up never deletes a pinned one), or let it go again
- [sites.backup_restore](../capabilities/sites.backup_restore.md): Put a finished backup back, never losing data: the live database is backed up first (kept 7 days, else the restore is refused), the dump loads into a new database, and it is swapped in only if that worked
- [sites.backups](../capabilities/sites.backups.md): Postgres backups of a site. action: list, create, delete, pin, download, restore (safety backup first)
- [sites.backups_list](../capabilities/sites.backups_list.md): The site's database backups and the database size
- [sites.build](../capabilities/sites.build.md): Build the site from its repo (the site agent runs in the repo); test and verify
- [sites.chat_viewing](../capabilities/sites.chat_viewing.md): The app says a chat is open for the person right now (every half minute while it stays open). An artifact an agent publishes in a turn that person asked opens in their app only while this holds
- [sites.create](../capabilities/sites.create.md): Create a site: a name, and where it runs (a port on a computer, or a folder in Files), or its source (a GitHub repo, an uploaded folder or zip) for Vyre to build and run with sites_deploy. Nothing is served until it is published or deployed
- [sites.db_import](../capabilities/sites.db_import.md): Copy an existing Postgres into the site's own: a pg_dump file in Files, or a Vault key holding the old connection string (for example from Railway)
- [sites.delete](../capabilities/sites.delete.md): Delete a site and stop its container
- [sites.deploy](../capabilities/sites.deploy.md): Build the site from its source (GitHub repo, folder or zip in Files, or a folder here) and run it on this Space, like Railway: Dockerfile, Node, Next.js, Vite, Python or static. The last good build serves until the new one answers. wait returns when it ends
- [sites.deploy_cancel](../capabilities/sites.deploy_cancel.md): Stop the deploy that is running. The last good build keeps serving. A deploy that already went live stays live
- [sites.deployments](../capabilities/sites.deployments.md): List deployments with state and URL
- [sites.domain_add](../capabilities/sites.domain_add.md): Add a custom domain to a site: returns the exact DNS records to set and adds the Caddy route with automatic TLS
- [sites.domain_check](../capabilities/sites.domain_check.md): The state of a custom domain: waiting for DNS, issuing the certificate, or live
- [sites.domain_set](../capabilities/sites.domain_set.md): Add or remove a site domain
- [sites.domains_get](../capabilities/sites.domains_get.md): Site domains with the DNS check and the Caddy certificate state
- [sites.env_list](../capabilities/sites.env_list.md): List env var names and the Vault keys they come from (never values), and the names the app looks for that are not set yet
- [sites.env_set](../capabilities/sites.env_set.md): Set the env vars of a deployed site (replaces the list). A secret takes its value from a Vault key at deploy time. A plain value is kept as given; one that looks like a secret is refused unless confirmPlain. scope: production (default), previews or all
- [sites.get](../capabilities/sites.get.md): Read one site
- [sites.host](../capabilities/sites.host.md): What this Space can host: its address, whether it is a phone address, whether Vyre can build and run apps here, the address sites get, and what a custom domain needs
- [sites.job_cancel](../capabilities/sites.job_cancel.md): Stop a job run that is queued or going
- [sites.job_create](../capabilities/sites.job_create.md): Add a scheduled job to a deployed site: a command run on a cron schedule in the site's image, with its variables
- [sites.job_delete](../capabilities/sites.job_delete.md): Delete a scheduled job and its history; a run that is going is stopped
- [sites.job_run](../capabilities/sites.job_run.md): Run a scheduled job now (refused while one of its runs goes)
- [sites.job_runs](../capabilities/sites.job_runs.md): The newest runs of a job (up to 50): when, how long, how it ended and one sentence for any end that is not a success. Its output is in sites_logs_read with source jobs and the run's id as scope
- [sites.job_update](../capabilities/sites.job_update.md): Change a scheduled job: its name, schedule, command, time zone, time limit, or pause and resume it. Resuming does not run what was missed
- [sites.jobs](../capabilities/sites.jobs.md): Scheduled jobs of a site. action: list (jobs and workers), create, update, delete, run, cancel, runs
- [sites.jobs_list](../capabilities/sites.jobs_list.md): A site's scheduled jobs (a command run in its own image on a cron schedule) and its workers (processes that stay up), with state and last run
- [sites.list](../capabilities/sites.list.md): List sites and artifacts you can see, by section (Personal, Shared with me, Space), kind and folder
- [sites.logs](../capabilities/sites.logs.md): The log of a site: its running app, or with build the build log of a deployment (the latest when none is named). Text from the site, not Vyre content
- [sites.logs_read](../capabilities/sites.logs_read.md): A site's log (app, requests, build, jobs): search words (-word excludes), source, level, time, deploy; after = cursor to follow. Text from the site, not Vyre content
- [sites.metrics](../capabilities/sites.metrics.md): CPU, memory, requests and response time of a site over 1h, 6h or 24h, and right now against its limits
- [sites.password_set](../capabilities/sites.password_set.md): Set the password visitors type to open a site whose access is password. Kept only as a hash
- [sites.plan](../capabilities/sites.plan.md): What a deploy would do with this source, before running it: how it is built and started, the port, and the databases and env names it looks for (read from railway.json, nixpacks.toml, a Procfile, package.json, requirements.txt or a Dockerfile)
- [sites.preview_promote](../capabilities/sites.preview_promote.md): Serve a preview's build as production without building it again: its image starts with the production variables and the address switches when it answers. The build that was serving is kept for a rollback
- [sites.preview_rebuild](../capabilities/sites.preview_rebuild.md): Build a branch of the site's repo as a preview at its own address behind sign-in, or build it again. A new build replaces the one before it for that branch. wait returns when it ends
- [sites.preview_remove](../capabilities/sites.preview_remove.md): Remove a preview
- [sites.previews](../capabilities/sites.previews.md): List previews (one per branch and pull request, on their own staging address)
- [sites.promote](../capabilities/sites.promote.md): Put a site on the public internet at its address. Held for approval unless the person asked for it this turn
- [sites.publish](../capabilities/sites.publish.md): Serve a site that is not public: space or private access, or a password on its own domain
- [sites.rollback](../capabilities/sites.rollback.md): Serve an earlier build again (the one before the current, or the one named). Its image is kept on the server, so nothing is built
- [sites.service_add](../capabilities/sites.service_add.md): Add a worker to a deployed site: a command that stays up in the site's image, restarts itself on a crash, and moves to the newest deploy
- [sites.service_identity](../capabilities/sites.service_identity.md): The site service identity and its grants (capped by the owner)
- [sites.service_remove](../capabilities/sites.service_remove.md): Remove a worker
- [sites.service_restart](../capabilities/sites.service_restart.md): Restart a worker, clearing a crash loop that stopped it
- [sites.service_stop](../capabilities/sites.service_stop.md): Stop a worker and keep it stopped until it is restarted
- [sites.services](../capabilities/sites.services.md): Workers of a site. action: list, add, restart, stop, remove
- [sites.services_list](../capabilities/sites.services_list.md): A site's workers: processes of its image that stay up without a port (a queue consumer, a bot). A crashing one waits longer each time and stops for good after eight crashes in ten minutes
- [sites.ship](../capabilities/sites.ship.md): Put an app on the web in one call: create the site from its source (or take siteId), set env from Vault handles, add Postgres or Redis, deploy and wait. Answers with the address, or the failed step, reason and fix. Call again with the returned siteId to go on
- [sites.signin_link](../capabilities/sites.signin_link.md): A short-lived link that signs the person asking in to a Space-only site at its own address
- [sites.staging_password_set](../capabilities/sites.staging_password_set.md): Choose the sealed Vault key that protects staging (shared across a site previews)
- [sites.status](../capabilities/sites.status.md): Is the port answering? Where it runs, the address, and what is wrong when something is
- [sites.stop](../capabilities/sites.stop.md): Stop serving a site. Its address answers nothing; the process on the computer keeps running
- [sites.table_create](../capabilities/sites.table_create.md): Create a site table (a site-scoped record type); no schema permission needed for people who can edit the site
- [sites.table_promote](../capabilities/sites.table_promote.md): Promote a site table to a Space record type
- [sites.tables](../capabilities/sites.tables.md): List site tables of a site
- [sites.update](../capabilities/sites.update.md): Rename a site, change its settings, its source, its CPU and memory, auto deploy on push, where it runs or who may reach it. Making it public takes it down until it is published again
- [sites.webhook_get](../capabilities/sites.webhook_get.md): Whether GitHub's webhook is on for a site, the address to give GitHub, and the branches that get a preview on a push. The secret is never shown again after it was made
- [sites.webhook_set](../capabilities/sites.webhook_set.md): Turn GitHub's webhook on or off for a site that comes from a repo, make a new secret (rotate; the answer shows it once), or set which branches get a preview on a push (names, prefixes ending in *, or *). The production branch deploys on a push when the site deploys on push

## Events (13)

- [site.access_changed](../events/site.access_changed.md): Who may reach a site was changed (public, password, the Space, or private)
- [site.build_failed](../events/site.build_failed.md): A build failed
- [site.created](../events/site.created.md): A site was created
- [site.deployed](../events/site.deployed.md): A deployment reached staging or a preview
- [site.domain_changed](../events/site.domain_changed.md): A site domain was set or removed
- [site.preview_created](../events/site.preview_created.md): A preview was built for a branch or pull request
- [site.preview_removed](../events/site.preview_removed.md): A preview was removed after the branch merged
- [site.promoted](../events/site.promoted.md): A build was promoted to production through the Gate
- [site.published](../events/site.published.md): A site or artifact went live at its address
- [site.rolled_back](../events/site.rolled_back.md): Production was rolled back to an earlier build
- [site.stopped](../events/site.stopped.md): A site or artifact stopped being served
- [site.table_created](../events/site.table_created.md): A site table (site-scoped record type) was created; fields carries its columns so the record type can be made from the event alone
- [site.table_promoted](../events/site.table_promoted.md): A site table became a Space record type
