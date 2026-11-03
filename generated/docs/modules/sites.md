# Sites (sites)

Lane L8. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (37)

- [sites.addon_add](../capabilities/sites.addon_add.md): Give a deployed site its own Postgres or Redis on this server, with its address set as DATABASE_URL or REDIS_URL. Its data stays on the server through redeploys
- [sites.addon_remove](../capabilities/sites.addon_remove.md): Remove a site's Postgres or Redis and its data
- [sites.artifact_open](../capabilities/sites.artifact_open.md): A short-lived address that opens an artifact for the person asking, in a tab or the browser
- [sites.artifact_publish](../capabilities/sites.artifact_publish.md): THE way to show something you made: publish it privately to a link that opens in a tab. Give html, a file or folder in Files, a path on this machine, or a running port. Same title or artifactId updates the same link
- [sites.build](../capabilities/sites.build.md): Build the site from its repo (the site agent runs in the repo); test and verify
- [sites.create](../capabilities/sites.create.md): Create a site: a name, and where it runs (a port on a computer, or a folder in Files), or its source (a GitHub repo, an uploaded folder or zip) for Vyre to build and run with sites_deploy. Nothing is served until it is published or deployed
- [sites.db_import](../capabilities/sites.db_import.md): Copy an existing Postgres into the site's own: a pg_dump file in Files, or a Vault key holding the old connection string (for example from Railway)
- [sites.delete](../capabilities/sites.delete.md): Delete a site and stop its container
- [sites.deploy](../capabilities/sites.deploy.md): Build the site from its source (GitHub repo, folder or zip in Files, or a folder here) and run it on this Space, like Railway: Dockerfile, Node, Next.js, Vite, Python or static. The last good build serves until the new one answers. wait returns when it ends
- [sites.deployments](../capabilities/sites.deployments.md): List deployments with state and URL
- [sites.domain_add](../capabilities/sites.domain_add.md): Add a custom domain to a site: returns the exact DNS records to set and adds the Caddy route with automatic TLS
- [sites.domain_check](../capabilities/sites.domain_check.md): The state of a custom domain: waiting for DNS, issuing the certificate, or live
- [sites.domain_set](../capabilities/sites.domain_set.md): Add or remove a site domain
- [sites.domains_get](../capabilities/sites.domains_get.md): Site domains with the DNS check and the Caddy certificate state
- [sites.env_list](../capabilities/sites.env_list.md): List env var names and the Vault keys they come from (never values), and the names the app looks for that are not set yet
- [sites.env_set](../capabilities/sites.env_set.md): Set the env vars of a deployed site: each name takes its value from a Vault key, filled at deploy time and never shown. The next deploy uses them
- [sites.get](../capabilities/sites.get.md): Read one site
- [sites.host](../capabilities/sites.host.md): What this Space can host: its address, whether it is a phone address, whether Vyre can build and run apps here, the address sites get, and what a custom domain needs
- [sites.list](../capabilities/sites.list.md): List sites and artifacts you can see, by section (Personal, Shared with me, Space), kind and folder
- [sites.logs](../capabilities/sites.logs.md): The log of a site: its running app, or with build the build log of a deployment (the latest when none is named). Text from the site, not Vyre content
- [sites.password_set](../capabilities/sites.password_set.md): Set the password visitors type to open a site whose access is password. Kept only as a hash
- [sites.plan](../capabilities/sites.plan.md): What a deploy would do with this source, before running it: how it is built and started, the port, and the databases and env names it looks for (read from railway.json, nixpacks.toml, a Procfile, package.json, requirements.txt or a Dockerfile)
- [sites.preview_rebuild](../capabilities/sites.preview_rebuild.md): Rebuild a preview or bring back a removed one
- [sites.preview_remove](../capabilities/sites.preview_remove.md): Remove a preview
- [sites.previews](../capabilities/sites.previews.md): List previews (one per branch and pull request, on their own staging address)
- [sites.promote](../capabilities/sites.promote.md): Put a site on the public internet at its address. Held for approval unless the person asked for it this turn
- [sites.publish](../capabilities/sites.publish.md): Serve a site that is not public: space or private access, or a password on its own domain
- [sites.rollback](../capabilities/sites.rollback.md): Serve an earlier build again (the one before the current, or the one named). Its image is kept on the server, so nothing is built
- [sites.service_identity](../capabilities/sites.service_identity.md): The site service identity and its grants (capped by the owner)
- [sites.signin_link](../capabilities/sites.signin_link.md): A short-lived link that signs the person asking in to a Space-only site at its own address
- [sites.staging_password_set](../capabilities/sites.staging_password_set.md): Choose the sealed Vault key that protects staging (shared across a site previews)
- [sites.status](../capabilities/sites.status.md): Is the port answering? Where it runs, the address, and what is wrong when something is
- [sites.stop](../capabilities/sites.stop.md): Stop serving a site. Its address answers nothing; the process on the computer keeps running
- [sites.table_create](../capabilities/sites.table_create.md): Create a site table (a site-scoped record type); no schema permission needed for people who can edit the site
- [sites.table_promote](../capabilities/sites.table_promote.md): Promote a site table to a Space record type
- [sites.tables](../capabilities/sites.tables.md): List site tables of a site
- [sites.update](../capabilities/sites.update.md): Rename a site, change its settings, its source, its CPU and memory, auto deploy on push, where it runs or who may reach it. Making it public takes it down until it is published again

## Events (12)

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
