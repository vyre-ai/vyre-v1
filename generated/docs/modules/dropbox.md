# Dropbox (dropbox)

Lane L4. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (18)

- [dropbox.account.list](../capabilities/dropbox.account.list.md): Dropbox accounts you can use: your own and the Space's
- [dropbox.account.remove](../capabilities/dropbox.account.remove.md): Disconnect a Dropbox account: revoke it at Dropbox and remove its token
- [dropbox.app.set](../capabilities/dropbox.app.set.md): Name the Vault item that holds the Dropbox app key (and secret, for change notices)
- [dropbox.app.status](../capabilities/dropbox.app.status.md): Whether the Dropbox app is set up on this server, its key, the address Dropbox sends people back to, and whether change notices can be verified (the address to give Dropbox for them)
- [dropbox.connect.complete](../capabilities/dropbox.connect.complete.md): Finish signing in from the callback: the state and the code, or the error Dropbox sent when the person declined. Only who started it can finish it
- [dropbox.connect.start](../capabilities/dropbox.connect.start.md): Start signing in to Dropbox: the address to approve at (your own Dropbox, or the Space's with admin rights)
- [dropbox.files.create_folder](../capabilities/dropbox.files.create_folder.md): Create a Dropbox folder
- [dropbox.files.delete](../capabilities/dropbox.files.delete.md): Delete a Dropbox file or folder (Dropbox keeps it in its deleted files for a while)
- [dropbox.files.download](../capabilities/dropbox.files.download.md): Download a Dropbox file, or one of its revisions, into a blob
- [dropbox.files.get_metadata](../capabilities/dropbox.files.get_metadata.md): Read one Dropbox file or folder
- [dropbox.files.latest_cursor](../capabilities/dropbox.files.latest_cursor.md): The change feed's start point for a folder, so a mount reads only what happens after it
- [dropbox.files.list_folder](../capabilities/dropbox.files.list_folder.md): List a Dropbox folder, or continue a listing with its cursor; a cursor kept from before reads only what changed since
- [dropbox.files.list_revisions](../capabilities/dropbox.files.list_revisions.md): List the saved revisions of a Dropbox file, newest first
- [dropbox.files.longpoll](../capabilities/dropbox.files.longpoll.md): Wait for the next change after a cursor (30 to 480 seconds); answers whether there is one and how long to wait before asking again
- [dropbox.files.restore](../capabilities/dropbox.files.restore.md): Restore a Dropbox file to one of its revisions
- [dropbox.files.upload](../capabilities/dropbox.files.upload.md): Upload a Space file to Dropbox; with rev it only replaces that revision
- [dropbox.health](../capabilities/dropbox.health.md): Health probe: the first connected account answers get_current_account
- [dropbox.receive_webhook](../capabilities/dropbox.receive_webhook.md): Record a verified Dropbox change notice once; it names the accounts that changed

## Events (2)

- [dropbox.changes_received](../events/dropbox.changes_received.md): Dropbox said files changed in these accounts
- [dropbox.connected](../events/dropbox.connected.md): A Dropbox account was connected
