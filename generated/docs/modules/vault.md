# Vault (vault)

Lane L7a. Kind module. Status stub. Version 0.1.0.

Requires: access.

## Capabilities (42)

- [providers.add](../capabilities/providers.add.md): Connect a provider with a pasted API key (stored once, used by handle) or a local model address
- [providers.catalog](../capabilities/providers.catalog.md): The provider gallery from the definition files: name, logo, connection kinds, model list source, engine
- [providers.list](../capabilities/providers.list.md): My connected AI providers: logo, how connected, Mine or Shared, agents using it, this month's usage
- [providers.remove](../capabilities/providers.remove.md): Remove a provider and its key or sign-in
- [providers.set_space_use](../capabilities/providers.set_space_use.md): Let the Space run work on my subscription, or stop it (stopping ends my sandbox)
- [providers.subscription_complete](../capabilities/providers.subscription_complete.md): Finish a subscription sign-in: the credential files are captured into a Mine item of kind ai_subscription
- [providers.subscription_start](../capabilities/providers.subscription_start.md): Start a subscription sign-in (Claude Code setup-token, Codex login) inside my own sandbox or device
- [providers.test](../capabilities/providers.test.md): Test a provider connection and list the models it offers
- [vault.export_env](../capabilities/vault.export_env.md): Export a folder as a .env file: one pull link that expires after 1 hour, 1 day or 7 days; never for Restricted items; the folder owner is notified
- [vault.exports.list](../capabilities/vault.exports.list.md): Export pull links that are still open
- [vault.exports.revoke](../capabilities/vault.exports.revoke.md): Close an export pull link early
- [vault.fill](../capabilities/vault.fill.md): Fill a handle into a process at the last moment (env, request header, browser field, terminal) and scrub it from the output; the value stays in the filler
- [vault.folders.create](../capabilities/vault.folders.create.md): Make a vault folder (Mine, or Shared when the person may create shared items)
- [vault.folders.delete](../capabilities/vault.folders.delete.md): Delete an empty vault folder
- [vault.folders.list](../capabilities/vault.folders.list.md): Vault folders with counts and my level
- [vault.folders.update](../capabilities/vault.folders.update.md): Rename a vault folder or set Who can export for it
- [vault.generate](../capabilities/vault.generate.md): Make a password, passphrase or token; the result is a fresh value that is not stored
- [vault.health](../capabilities/vault.health.md): Team health: weak, reused, stale and rotation-due items (ids and issues only; breach checks come later)
- [vault.import](../capabilities/vault.import.md): Import items in one step into a folder; the file is deleted afterwards
- [vault.import_parse](../capabilities/vault.import_parse.md): Preview an import file from 1Password, Bitwarden, LastPass or Chrome: names, kinds, field keys and duplicates (values are not echoed)
- [vault.inject_env](../capabilities/vault.inject_env.md): Inject a folder into one child process environment (vyre run --env folder -- command); returns key names only
- [vault.item.delete](../capabilities/vault.item.delete.md): Move an item to Trash
- [vault.item.get](../capabilities/vault.item.get.md): One item: metadata and field keys, never values
- [vault.item.history](../capabilities/vault.item.history.md): Every use, reveal, edit and share of an item (never values)
- [vault.item.mark_rotated](../capabilities/vault.item.mark_rotated.md): Record that the secret was rotated and restart its reminder
- [vault.item.move](../capabilities/vault.item.move.md): Move an item to another folder; crossing Mine and Shared re-encrypts it
- [vault.item.put](../capabilities/vault.item.put.md): Add an item: a name plus KEY=value fields (a pasted .env or an app template becomes fields on the client)
- [vault.item.restore](../capabilities/vault.item.restore.md): Bring an item back from Trash
- [vault.item.reveal](../capabilities/vault.item.reveal.md): Show the values of an item to a person at View level (asked once, logged per actor)
- [vault.item.update](../capabilities/vault.item.update.md): Change fields or settings of an item: set and remove fields, Space only lock, inject into deployments, rotation reminder
- [vault.items.export_mine](../capabilities/vault.items.export_mine.md): A person exports their own Mine items (also for 30 days after removal); one pull link, audited
- [vault.items.list](../capabilities/vault.items.list.md): List items (names and metadata only, never values) by section, folder, kind or text
- [vault.items.match](../capabilities/vault.items.match.md): Items that fit a website address (the Chrome extension offers them to fill)
- [vault.policy.get](../capabilities/vault.policy.get.md): The Space vault policy: who may export, longest pull link, Restricted never exported, reveal reasons
- [vault.policy.set](../capabilities/vault.policy.set.md): Set the Space vault policy
- [vault.report_scrub_miss](../capabilities/vault.report_scrub_miss.md): System: the filler reports a value it could not scrub from an output stream
- [vault.service_health](../capabilities/vault.service_health.md): Health probe: the vault service answers and its key handle is loaded
- [vault.share](../capabilities/vault.share.md): Share an item or folder with a person, group, agent or automation at Use, View, Edit or Manage; subscription sign-ins are never shareable
- [vault.site_rules.list](../capabilities/vault.site_rules.list.md): Sites where I never fill and never get offered to save a login in this Space (Never Fill on This Site)
- [vault.site_rules.set](../capabilities/vault.site_rules.set.md): Set or clear the never-fill and never-save rule for one site; personal, follows the extension in this Space
- [vault.unshare](../capabilities/vault.unshare.md): Stop sharing an item or folder with someone
- [vault.use](../capabilities/vault.use.md): Ask for an item by name: returns a handle like #Dana_Lawmatics and the field names, never values

## Events (20)

- [provider.added](../events/provider.added.md): An AI provider was connected (subscription, key or local model)
- [provider.removed](../events/provider.removed.md): An AI provider was removed
- [provider.updated](../events/provider.updated.md): A provider changed (Space may use it, sign-in state)
- [vault.export_revoked](../events/vault.export_revoked.md): An export pull link was revoked before it expired
- [vault.exported](../events/vault.exported.md): A .env file was made from a folder; the folder owner is notified
- [vault.folder_created](../events/vault.folder_created.md): A vault folder was made
- [vault.folder_deleted](../events/vault.folder_deleted.md): A vault folder was deleted
- [vault.folder_updated](../events/vault.folder_updated.md): A vault folder was renamed or its Who can export rule changed
- [vault.imported](../events/vault.imported.md): Items came in from another password manager (counts only)
- [vault.item_created](../events/vault.item_created.md): An item was added
- [vault.item_deleted](../events/vault.item_deleted.md): An item moved to Trash
- [vault.item_moved](../events/vault.item_moved.md): An item moved to another folder (re-encrypted when it crosses Mine and Shared)
- [vault.item_restored](../events/vault.item_restored.md): An item came back from Trash
- [vault.item_rotated](../events/vault.item_rotated.md): An item was marked rotated
- [vault.item_updated](../events/vault.item_updated.md): Fields or settings of an item changed (field keys only)
- [vault.revealed](../events/vault.revealed.md): A value was shown to a person at View level (audited per actor)
- [vault.rotation_due](../events/vault.rotation_due.md): An item reached its rotation reminder date (ids only); the owner gets a Badge notification
- [vault.scrub_miss](../events/vault.scrub_miss.md): The output scrubber failed to remove a value from a stream (value not recorded)
- [vault.site_rule_changed](../events/vault.site_rule_changed.md): A person set or cleared the never-fill or never-save rule for one site (host only)
- [vault.used](../events/vault.used.md): An item was used by handle; the value was filled and scrubbed (no value in the event)
