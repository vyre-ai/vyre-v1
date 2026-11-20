# Sites (sites)

Lane L8. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (45)

- [sites.addon_add](../capabilities/sites.addon_add.md): Give a site its own Postgres or Redis (DATABASE_URL or REDIS_URL). Its data survives redeploys
- [sites.addon_remove](../capabilities/sites.addon_remove.md): Remove a site's Postgres or Redis and its data
- [sites.artifact_open](../capabilities/sites.artifact_open.md): A short-lived address that opens an artifact for the person asking, in a tab or the browser
- [sites.artifact_publish](../capabilities/sites.artifact_publish.md): Needs a title and exactly one of html, fileId, folderId, path or port. THE way to show what you made: publishes it privately, the person gets a card to open. Example: artifact_publish {"title":"Q3 plan","html":"<h1>Q3</h1>"}. Same title or artifactId updates the link. No title: its <title> is used
- [sites.artifact_thumb_set](../capabilities/sites.artifact_thumb_set.md): Keep a small picture of an artifact, sent by the Vyre for Chrome extension. Set only when there is none or the artifact changed
- [sites.build](../capabilities/sites.build.md): Build the site from its repo (the site agent runs in the repo); test and verify
- [sites.chat_viewing](../capabilities/sites.chat_viewing.md): The app says a chat is open for the person (every 30 s while open). An artifact an agent publishes for that person opens in their app only while this holds
- [sites.create](../capabilities/sites.create.md): Create a site: where it runs (a computer port or a Files folder) or its source (repo, folder or zip). Nothing is served until published or deployed
- [sites.db_import](../capabilities/sites.db_import.md): Copy a Postgres into the site's own: a pg_dump file in Files, or a Vault key with the old connection string
- [sites.delete](../capabilities/sites.delete.md): Delete a site and stop its container
- [sites.deploy](../capabilities/sites.deploy.md): Build the site from its source and run it here (Dockerfile, Node, Vite, Python, static). The last good build serves until the new one answers
- [sites.deploy_cancel](../capabilities/sites.deploy_cancel.md): Cancel the running deploy. The last good build keeps serving
- [sites.deployments](../capabilities/sites.deployments.md): List deployments with state and URL
- [sites.domain_add](../capabilities/sites.domain_add.md): Add a custom domain: returns the DNS records to set; TLS is automatic
- [sites.domain_check](../capabilities/sites.domain_check.md): The state of a custom domain: waiting for DNS, issuing the certificate, or live
- [sites.domain_set](../capabilities/sites.domain_set.md): Add or remove a site domain
- [sites.domains_get](../capabilities/sites.domains_get.md): Site domains with the DNS check and the Caddy certificate state
- [sites.env_list](../capabilities/sites.env_list.md): A site's env var names and sources (never values), and names the app looks for that are not set
- [sites.env_set](../capabilities/sites.env_set.md): Set a site's env vars (replaces the list): a Vault key, or a plain value (not a secret). scope: production (default), previews or all
- [sites.get](../capabilities/sites.get.md): Read one site
- [sites.head_check](../capabilities/sites.head_check.md): The commit a site's branch is at, and whether it was already deployed
- [sites.host](../capabilities/sites.host.md): What this Space can host: its address, whether Vyre can run apps here, the sites address, what a custom domain needs
- [sites.list](../capabilities/sites.list.md): List the sites and artifacts you can see, by section, kind, folder
- [sites.logs](../capabilities/sites.logs.md): A site's log: its app, or with build a deploy's build log. Text from the site
- [sites.password_set](../capabilities/sites.password_set.md): Set the password for a site whose access is password (kept as a hash)
- [sites.plan](../capabilities/sites.plan.md): What a deploy would do with this source: how it builds and starts, the port, and the databases and env names it looks for
- [sites.preview_promote](../capabilities/sites.preview_promote.md): Serve a preview's build as production without a rebuild, with the production variables
- [sites.preview_rebuild](../capabilities/sites.preview_rebuild.md): Build a branch of the repo as a preview at its own address behind sign-in. A new build replaces the last
- [sites.preview_remove](../capabilities/sites.preview_remove.md): Remove a preview
- [sites.previews](../capabilities/sites.previews.md): List previews (one per branch and pull request, on their own staging address)
- [sites.promote](../capabilities/sites.promote.md): Put a site on the public internet. Held for approval unless the person asked this turn
- [sites.publish](../capabilities/sites.publish.md): Serve a non-public site: space or private access, or a password on its own domain
- [sites.rollback](../capabilities/sites.rollback.md): Serve an earlier build again (the previous, or the one named). Nothing is built
- [sites.service_identity](../capabilities/sites.service_identity.md): The site service identity and its grants (capped by the owner)
- [sites.ship](../capabilities/sites.ship.md): Put an app online in one call: create the site (or use siteId), set env, add databases, deploy, wait. Returns the address, or the failed step with its fix
- [sites.signin_link](../capabilities/sites.signin_link.md): A short-lived link that signs the person asking in to a Space-only site at its own address
- [sites.staging_password_set](../capabilities/sites.staging_password_set.md): Choose the sealed Vault key that protects staging (shared across a site previews)
- [sites.status](../capabilities/sites.status.md): Is the port answering? Where it runs, the address, and what is wrong when something is
- [sites.stop](../capabilities/sites.stop.md): Stop serving a site. Its address answers nothing
- [sites.table_create](../capabilities/sites.table_create.md): Create a site table (a site-scoped record type)
- [sites.table_promote](../capabilities/sites.table_promote.md): Promote a site table to a Space record type
- [sites.tables](../capabilities/sites.tables.md): List site tables of a site
- [sites.update](../capabilities/sites.update.md): Change a site: name, source, CPU and memory, deploy on push, where it runs, who may reach it
- [sites.webhook_get](../capabilities/sites.webhook_get.md): GitHub webhook of a site: on or off, its address, the branches that get a preview. The secret is never shown again
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
