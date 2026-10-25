# Files (files)

Lane L4. Kind module. Version 0.1.0.

Requires: mounts.

## Capabilities (63)

- [changesets.approve](../capabilities/changesets.approve.md): Approve and commit a changeset: 3-way merge on the recorded base, conflicts go to the reviewer; optionally push
- [changesets.comments.add](../capabilities/changesets.comments.add.md): Add an inline comment to a changeset with @ people and agents (an @ agent answers in the thread)
- [changesets.comments.list](../capabilities/changesets.comments.list.md): List inline comments on a changeset
- [changesets.diff](../capabilities/changesets.diff.md): Hunks of one file inside a changeset, against its recorded base version
- [changesets.discard](../capabilities/changesets.discard.md): Throw the staged changes away
- [changesets.get](../capabilities/changesets.get.md): Read a changeset with its file list and counts
- [changesets.list](../capabilities/changesets.list.md): List changesets, for example the ones waiting for me
- [changesets.request_changes](../capabilities/changesets.request_changes.md): Send the reviewer comments back to the agent thread and keep the changeset open
- [changesets.revert_change](../capabilities/changesets.revert_change.md): Revert a single change (one hunk or one file) inside a changeset
- [changesets.review_externally](../capabilities/changesets.review_externally.md): Open a changeset to an outside agent (Claude Code, Codex) with a read and comment token; returns a one-time review link (the token is in the link, shown once, never logged)
- [files.comments.add](../capabilities/files.comments.add.md): Comment on a file, a range, a cell, a page or an area (area comments are numbered pins); @ people and agents
- [files.comments.delete](../capabilities/files.comments.delete.md): Delete a comment
- [files.comments.list](../capabilities/files.comments.list.md): List comments and numbered pins on a file; agents read pins to see what a person marked
- [files.comments.resolve](../capabilities/files.comments.resolve.md): Resolve or reopen a comment
- [files.copy](../capabilities/files.copy.md): Copy a file into a folder
- [files.create](../capabilities/files.create.md): Create a file in a folder from text, base64 or an uploaded blob
- [files.delete](../capabilities/files.delete.md): Move a file to Trash
- [files.diff](../capabilities/files.diff.md): Compare two versions of a file, or a version with the current one: unified or split hunks, word marks, paragraph diff for docx and md, image blobs for the slider
- [files.external_links](../capabilities/files.external_links.md): List the outside links of a file
- [files.folder.create](../capabilities/files.folder.create.md): Create a folder
- [files.folder.delete](../capabilities/files.folder.delete.md): Move a folder and its files to Trash
- [files.folder.get](../capabilities/files.folder.get.md): Read one folder with counts, source mark, git state and Review changes flag
- [files.folder.move](../capabilities/files.folder.move.md): Move a folder under another folder (its sharing follows the new parent)
- [files.folder.rename](../capabilities/files.folder.rename.md): Rename a folder
- [files.folder.restore](../capabilities/files.folder.restore.md): Bring a folder back from Trash
- [files.folder.search](../capabilities/files.folder.search.md): Find folders by name for the # picker and the Into picker
- [files.folder.settings](../capabilities/files.folder.settings.md): Change Review changes, sensitivity label or the working-folder flags of a folder
- [files.get](../capabilities/files.get.md): Read the metadata of one file
- [files.health](../capabilities/files.health.md): Blob store and tree health: free space, orphaned blobs, index lag
- [files.knowledge](../capabilities/files.knowledge.md): The Knowledge section of the tree: the knowledge folders and files the caller may read, plus the Memory and Graph entries
- [files.lint](../capabilities/files.lint.md): Lint a guidance file: line counts against the limits, Inherits VYRE.md, Override lines, secret scan, agent.toml schema, routine prompt files, handoff names, repeated facts
- [files.list](../capabilities/files.list.md): List files and folders in a folder or a section (Personal, Shared with me, Space)
- [files.markup.get](../capabilities/files.markup.get.md): Read freehand markup (Draw) saved on an image or page
- [files.markup.save](../capabilities/files.markup.save.md): Save freehand markup on an image or page
- [files.move](../capabilities/files.move.md): Move a file to another folder (grants of the new folder apply, nothing is copied)
- [files.name_version](../capabilities/files.name_version.md): Name a version or give its reason
- [files.purge](../capabilities/files.purge.md): Delete a file from Trash for good
- [files.read](../capabilities/files.read.md): Read the content of a file or one of its versions as text, base64 or a short-lived download address
- [files.recent](../capabilities/files.recent.md): Recently opened or changed files
- [files.rename](../capabilities/files.rename.md): Rename a file
- [files.resolve](../capabilities/files.resolve.md): Turn a tree path such as Projects/Probate GTM/plan.md into an id
- [files.restore](../capabilities/files.restore.md): Bring a file back from Trash
- [files.restore_version](../capabilities/files.restore_version.md): Restore a file to an earlier version (a new version is added)
- [files.revoke_external](../capabilities/files.revoke_external.md): Revoke an outside link
- [files.save](../capabilities/files.save.md): Save a guidance file (VYRE.md, AGENT.md, agent.toml, routine prompts): snapshot first, lint, then commit as a version
- [files.share](../capabilities/files.share.md): Share a file with a person, group, role or agent at View, Use, Edit or Manage (folders use access.share)
- [files.share_external](../capabilities/files.share_external.md): Make a view-only link to a file for someone outside the Space, with an expiry
- [files.shared_with_me](../capabilities/files.shared_with_me.md): Files and folders other people shared with the caller, newest share first (the Shared with me section of the tree)
- [files.trash.empty](../capabilities/files.trash.empty.md): Delete everything in Trash that the caller may delete
- [files.trash.list](../capabilities/files.trash.list.md): Files and folders in Trash (30 days)
- [files.tree](../capabilities/files.tree.md): The roots of the file tree: Agents, Projects, People, Channels, shared knowledge, Agent template, Deployments, GitHub, plus Recent, Shared with me, Trash and Knowledge
- [files.upload_url](../capabilities/files.upload_url.md): Get a one-time address to upload bytes; the result is a blobId for files.create or files.write
- [files.versions](../capabilities/files.versions.md): List versions of a file with who and why
- [files.viewer_data](../capabilities/files.viewer_data.md): Everything the one viewer needs for any file type: text projection, pages, preview address, sheet info, export snapshot for Google-native files, and what the caller may do
- [files.write](../capabilities/files.write.md): Replace the content of a file. In a Review changes folder an agent write lands in a changeset and syncs only on Approve
- [sheets.add_sheet](../capabilities/sheets.add_sheet.md): Add a sheet (tab) to a workbook
- [sheets.append_rows](../capabilities/sheets.append_rows.md): Append rows to a sheet; each write is a version labelled with the automation and run, so parallel runs never overwrite
- [sheets.create](../capabilities/sheets.create.md): Create a CSV or XLSX table file with a header row
- [sheets.delete_row](../capabilities/sheets.delete_row.md): Remove a row from a sheet
- [sheets.info](../capabilities/sheets.info.md): List the sheets of a table file with row counts, columns and the key column
- [sheets.read_rows](../capabilities/sheets.read_rows.md): Read rows from a sheet with a filter over column values
- [sheets.update_row](../capabilities/sheets.update_row.md): Update one row by row id or by a key column value
- [sheets.upsert_row](../capabilities/sheets.upsert_row.md): Update the row that matches the given columns, or append a new one

## Events (28)

- [changeset.approved](../events/changeset.approved.md): A changeset was approved and committed
- [changeset.changes_requested](../events/changeset.changes_requested.md): The reviewer asked the agent for changes
- [changeset.discarded](../events/changeset.discarded.md): A changeset was discarded
- [changeset.opened](../events/changeset.opened.md): Agent edits were staged in a working copy for review
- [changeset.sent_for_review](../events/changeset.sent_for_review.md): A changeset was opened to an outside agent for review
- [changeset.updated](../events/changeset.updated.md): A change inside a changeset was reverted or the agent added more edits
- [file.comment_added](../events/file.comment_added.md): A comment or pin was added to a file
- [file.comment_resolved](../events/file.comment_resolved.md): A comment was resolved
- [file.conflict_kept](../events/file.conflict_kept.md): Two saves collided on a binary file; the newest is current and the other is kept as a labelled version
- [file.created](../events/file.created.md): A file was created
- [file.deleted](../events/file.deleted.md): A file moved to Trash
- [file.external_revoked](../events/file.external_revoked.md): An outside link was revoked
- [file.markup_saved](../events/file.markup_saved.md): Freehand markup on an image or page was saved
- [file.moved](../events/file.moved.md): A file moved to another folder
- [file.purged](../events/file.purged.md): A file was deleted for good
- [file.renamed](../events/file.renamed.md): A file was renamed
- [file.restored](../events/file.restored.md): A file came back from Trash
- [file.shared_external](../events/file.shared_external.md): A link outside the Space was made for a file
- [file.version_added](../events/file.version_added.md): A file got a new version
- [folder.created](../events/folder.created.md): A folder was created
- [folder.deleted](../events/folder.deleted.md): A folder and its files moved to Trash
- [folder.moved](../events/folder.moved.md): A folder moved
- [folder.renamed](../events/folder.renamed.md): A folder was renamed
- [folder.restored](../events/folder.restored.md): A folder came back from Trash
- [folder.settings_changed](../events/folder.settings_changed.md): Review changes, label or branch protection of a folder changed
- [sheet.row_appended](../events/sheet.row_appended.md): A row was added to a sheet
- [sheet.row_deleted](../events/sheet.row_deleted.md): A row was removed from a sheet
- [sheet.row_updated](../events/sheet.row_updated.md): A row of a sheet changed
