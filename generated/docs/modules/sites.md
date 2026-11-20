# Sites (sites)

Lane L8. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (66)

- [sites.addon_add](../capabilities/sites.addon_add.md): Give a site its own Postgres or Redis (DATABASE_URL, REDIS_URL); data survives redeploys
- [sites.addon_remove](../capabilities/sites.addon_remove.md): Remove a site's Postgres or Redis and its data
- [sites.artifact_open](../capabilities/sites.artifact_open.md): A short-lived address that opens an artifact for the asker
- [sites.artifact_publish](../capabilities/sites.artifact_publish.md): Needs a title and exactly one of html, fileId, folderId, path or port. THE way to show what you made: publishes it privately, the person gets a card to open. Example: artifact_publish {"title":"Q3 plan","html":"<h1>Q3</h1>"}. Same title or artifactId updates the link. No title: its <title> is used
- [sites.artifact_thumb_set](../capabilities/sites.artifact_thumb_set.md): Keep an artifact's small picture (from the Vyre for Chrome extension) only if none or it changed
- [sites.backup_create](../capabilities/sites.backup_create.md): Back up the site's Postgres now; read sites_backups_list to see it finish
- [sites.backup_delete](../capabilities/sites.backup_delete.md): Delete a backup and its file
- [sites.backup_download](../capabilities/sites.backup_download.md): Where to fetch a finished backup from: one address per part (a dump over 32 MB is kept in parts: join them in order). Readable by whoever can see the site
- [sites.backup_pin](../capabilities/sites.backup_pin.md): Keep a backup for good (the clean-up never deletes a pinned one), or let it go again
- [sites.backup_restore](../capabilities/sites.backup_restore.md): Put a finished backup back, never losing data: the live database is backed up first (kept 7 days, else the restore is refused), the dump loads into a new database, and it is swapped in only if that worked
- [sites.backups_list](../capabilities/sites.backups_list.md): The site's database backups and the database size
- [sites.build](../capabilities/sites.build.md): Build the site from its repo (the agent runs in it); test, verify
- [sites.chat_viewing](../capabilities/sites.chat_viewing.md): The app says a chat is open (every 30 s). An artifact an agent publishes for that person opens in their app only while it does
- [sites.create](../capabilities/sites.create.md): Create a site: where it runs (computer port or Files folder) or its source (repo, folder, zip). Nothing is served until published or deployed
- [sites.db_import](../capabilities/sites.db_import.md): Copy a Postgres into the site's: a pg_dump in Files, or a Vault key with the old connection string
- [sites.delete](../capabilities/sites.delete.md): Delete a site and stop its container
- [sites.deploy](../capabilities/sites.deploy.md): Build a site from its source and run it (Dockerfile, Node, Vite, Python, static); the last good build serves until the new one answers
- [sites.deploy_cancel](../capabilities/sites.deploy_cancel.md): Cancel the running deploy; the last good build keeps serving
- [sites.deployments](../capabilities/sites.deployments.md): List deployments with state and URL
- [sites.domain_add](../capabilities/sites.domain_add.md): Add a custom domain: returns the DNS records to set; TLS is automatic
- [sites.domain_check](../capabilities/sites.domain_check.md): A custom domain's state: waiting for DNS, issuing the certificate, or live
- [sites.domain_set](../capabilities/sites.domain_set.md): Add or remove a site domain
- [sites.domains_get](../capabilities/sites.domains_get.md): A site's domains with DNS check and certificate state
- [sites.env_list](../capabilities/sites.env_list.md): A site's env var names and sources (never values), plus names the app wants that are unset
- [sites.env_set](../capabilities/sites.env_set.md): Set a site's env vars (replaces the list): a Vault key, or a plain value (not a secret). scope: production (default), previews, all
- [sites.get](../capabilities/sites.get.md): Read one site
- [sites.head_check](../capabilities/sites.head_check.md): The commit a site's branch is at, and whether it was already deployed
- [sites.host](../capabilities/sites.host.md): What this Space can host: address, whether Vyre runs apps, the sites address, custom domain needs
- [sites.job_cancel](../capabilities/sites.job_cancel.md): Stop a job run that is queued or going
- [sites.job_create](../capabilities/sites.job_create.md): Add a scheduled job to a deployed site: a command run on a cron schedule in the site's image, with its variables
- [sites.job_delete](../capabilities/sites.job_delete.md): Delete a scheduled job and its history; a run that is going is stopped
- [sites.job_run](../capabilities/sites.job_run.md): Run a scheduled job now (refused while one of its runs goes)
- [sites.job_runs](../capabilities/sites.job_runs.md): The newest runs of a job (up to 50): when, how long, how it ended and one sentence for any end that is not a success. Its output is in sites_logs_read with source jobs and the run's id as scope
- [sites.job_update](../capabilities/sites.job_update.md): Change a scheduled job: its name, schedule, command, time zone, time limit, or pause and resume it. Resuming does not run what was missed
- [sites.jobs_list](../capabilities/sites.jobs_list.md): A site's scheduled jobs (a command run in its own image on a cron schedule) and its workers (processes that stay up), with state and last run
- [sites.list](../capabilities/sites.list.md): List the sites and artifacts you can see, by section, kind, folder
- [sites.logs](../capabilities/sites.logs.md): A site's log: its app, or with build a deploy's build log. Text from the site
- [sites.logs_read](../capabilities/sites.logs_read.md): A site's log (app, requests, build, jobs): search words (-word excludes), source, level, time, deploy; after = cursor to follow. Text from the site, not Vyre content
- [sites.metrics](../capabilities/sites.metrics.md): CPU, memory, requests and response time of a site over 1h, 6h or 24h, and right now against its limits
- [sites.ops](../capabilities/sites.ops.md): Site ops: logs, metrics, jobs, workers, backups; read the sites skill
- [sites.password_set](../capabilities/sites.password_set.md): Set the password for a site whose access is password (kept as a hash)
- [sites.plan](../capabilities/sites.plan.md): What a deploy of this source would do: build and start, port, databases and env names it needs
- [sites.preview_promote](../capabilities/sites.preview_promote.md): Serve a preview's build as production without a rebuild, using production variables
- [sites.preview_rebuild](../capabilities/sites.preview_rebuild.md): Build a repo branch as a preview at its own address behind sign-in; a rebuild replaces the last
- [sites.preview_remove](../capabilities/sites.preview_remove.md): Remove a preview
- [sites.previews](../capabilities/sites.previews.md): List previews (one per branch and pull request, each at its own address)
- [sites.promote](../capabilities/sites.promote.md): Put a site on the public internet. Held for approval unless the person asked this turn
- [sites.publish](../capabilities/sites.publish.md): Serve a non-public site: space or private access, or a password on its domain
- [sites.rollback](../capabilities/sites.rollback.md): Serve an earlier build again (the previous or the one named); nothing is built
- [sites.service_add](../capabilities/sites.service_add.md): Add a worker to a deployed site: a command that stays up in the site's image, restarts itself on a crash, and moves to the newest deploy
- [sites.service_identity](../capabilities/sites.service_identity.md): The site service identity and its grants (capped by the owner)
- [sites.service_remove](../capabilities/sites.service_remove.md): Remove a worker
- [sites.service_restart](../capabilities/sites.service_restart.md): Restart a worker, clearing a crash loop that stopped it
- [sites.service_stop](../capabilities/sites.service_stop.md): Stop a worker and keep it stopped until it is restarted
- [sites.services_list](../capabilities/sites.services_list.md): A site's workers: processes of its image that stay up without a port (a queue consumer, a bot). A crashing one waits longer each time and stops for good after eight crashes in ten minutes
- [sites.ship](../capabilities/sites.ship.md): Put an app online in one call: create the site (or use siteId), set env, add databases, deploy, wait. Returns the address or the failed step and fix
- [sites.signin_link](../capabilities/sites.signin_link.md): A short-lived link that signs the person asking in to a Space-only site at its own address
- [sites.staging_password_set](../capabilities/sites.staging_password_set.md): Choose the sealed Vault key protecting staging (shared by its previews)
- [sites.status](../capabilities/sites.status.md): Is the port answering? Where it runs, its address, what is wrong if not
- [sites.stop](../capabilities/sites.stop.md): Stop serving a site. Its address answers nothing
- [sites.table_create](../capabilities/sites.table_create.md): Create a site table (a site-scoped record type)
- [sites.table_promote](../capabilities/sites.table_promote.md): Promote a site table to a Space record type
- [sites.tables](../capabilities/sites.tables.md): List a site's tables
- [sites.update](../capabilities/sites.update.md): Change a site: name, source, CPU and memory, deploy on push, where it runs, who may reach it
- [sites.webhook_get](../capabilities/sites.webhook_get.md): A site's GitHub webhook: on or off, its address, branches that get a preview. The secret is never shown again
- [sites.webhook_set](../capabilities/sites.webhook_set.md): Turn the GitHub webhook on or off, rotate its secret (shown once), or set preview branches

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
