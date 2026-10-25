# Sites (sites)

Lane L8. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (23)

- [sites.build](../capabilities/sites.build.md): Build the site from its repo (the site agent runs in the repo); test and verify
- [sites.create](../capabilities/sites.create.md): Create a site with its root folder under Deployments/
- [sites.delete](../capabilities/sites.delete.md): Delete a site and stop its container
- [sites.deploy](../capabilities/sites.deploy.md): Deploy a build to the always-password-protected staging URL
- [sites.deployments](../capabilities/sites.deployments.md): List deployments with state and URL
- [sites.domain_set](../capabilities/sites.domain_set.md): Add or remove a site domain
- [sites.domains_get](../capabilities/sites.domains_get.md): Site domains with the DNS check and the Caddy certificate state
- [sites.env_list](../capabilities/sites.env_list.md): List environment names (never values)
- [sites.env_set](../capabilities/sites.env_set.md): Set environment names for deployments; values come from Vault by key name with inject into deployments
- [sites.get](../capabilities/sites.get.md): Read one site
- [sites.list](../capabilities/sites.list.md): List sites by section (Personal, Shared with me, Space) and folder
- [sites.logs](../capabilities/sites.logs.md): Container logs of a deployment (ids and text from the site, not Vyre content)
- [sites.preview_rebuild](../capabilities/sites.preview_rebuild.md): Rebuild a preview or bring back a removed one
- [sites.preview_remove](../capabilities/sites.preview_remove.md): Remove a preview
- [sites.previews](../capabilities/sites.previews.md): List previews (one per branch and pull request, on their own staging address)
- [sites.promote](../capabilities/sites.promote.md): Promote a staging build to production (merges the pull request first when there is one)
- [sites.rollback](../capabilities/sites.rollback.md): Roll production back to an earlier build
- [sites.service_identity](../capabilities/sites.service_identity.md): The site service identity and its grants (capped by the owner)
- [sites.staging_password_set](../capabilities/sites.staging_password_set.md): Choose the sealed Vault key that protects staging (shared across a site previews)
- [sites.table_create](../capabilities/sites.table_create.md): Create a site table (a site-scoped record type); no schema permission needed for people who can edit the site
- [sites.table_promote](../capabilities/sites.table_promote.md): Promote a site table to a Space record type
- [sites.tables](../capabilities/sites.tables.md): List site tables of a site
- [sites.update](../capabilities/sites.update.md): Rename a site or change its settings

## Events (10)

- [site.build_failed](../events/site.build_failed.md): A build failed
- [site.created](../events/site.created.md): A site was created
- [site.deployed](../events/site.deployed.md): A deployment reached staging or a preview
- [site.domain_changed](../events/site.domain_changed.md): A site domain was set or removed
- [site.preview_created](../events/site.preview_created.md): A preview was built for a branch or pull request
- [site.preview_removed](../events/site.preview_removed.md): A preview was removed after the branch merged
- [site.promoted](../events/site.promoted.md): A build was promoted to production through the Gate
- [site.rolled_back](../events/site.rolled_back.md): Production was rolled back to an earlier build
- [site.table_created](../events/site.table_created.md): A site table (site-scoped record type) was created; fields carries its columns so the record type can be made from the event alone
- [site.table_promoted](../events/site.table_promoted.md): A site table became a Space record type
