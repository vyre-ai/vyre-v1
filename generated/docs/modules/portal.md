# Site accounts (portal)

Lane L8. Kind module. Status stub. Version 0.1.0.

Requires: nothing.

## Capabilities (8)

- [portal.account_create](../capabilities/portal.account_create.md): Create an outside account for a site (magic link or password, per site)
- [portal.account_disable](../capabilities/portal.account_disable.md): Disable an outside account
- [portal.accounts](../capabilities/portal.accounts.md): List outside accounts of a site
- [portal.file_link](../capabilities/portal.file_link.md): Make a short-lived scoped link to a file for an outside account
- [portal.link_record](../capabilities/portal.link_record.md): Link an outside account to a contact or client record with a row rule
- [portal.post](../capabilities/portal.post.md): Post into a record conversation or channel as the outside account; lands in the Inbox like any message
- [portal.rules](../capabilities/portal.rules.md): Row rules and grants of the site service identity
- [portal.sign_in](../capabilities/portal.sign_in.md): Request a magic link or sign in with a password

## Events (4)

- [portal.account_created](../events/portal.account_created.md): A site end-user account was created (not a Space member)
- [portal.message_posted](../events/portal.message_posted.md): An outside account posted into a record conversation through the API
- [portal.record_linked](../events/portal.record_linked.md): An outside account was linked to a record with a row rule
- [portal.signed_in](../events/portal.signed_in.md): A site end-user signed in
