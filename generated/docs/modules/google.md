# Google Workspace (google)

Lane L5. Kind connector. Version 0.1.0.

Requires: mail.

## Capabilities (60)

- [google.calendar.create_event](../capabilities/google.calendar.create_event.md): Create an event; Google invites the attendees
- [google.calendar.delete_event](../capabilities/google.calendar.delete_event.md): Delete an event; Google tells the attendees
- [google.calendar.free_busy](../capabilities/google.calendar.free_busy.md): Busy blocks for people over a range
- [google.calendar.get_event](../capabilities/google.calendar.get_event.md): Read one event
- [google.calendar.list_calendars](../capabilities/google.calendar.list_calendars.md): List the calendars of the member
- [google.calendar.list_events](../capabilities/google.calendar.list_events.md): List events (incremental with a sync token)
- [google.calendar.respond](../capabilities/google.calendar.respond.md): Accept, decline or answer maybe to an invitation
- [google.calendar.stop_watch](../capabilities/google.calendar.stop_watch.md): Close an events.watch channel
- [google.calendar.update_event](../capabilities/google.calendar.update_event.md): Change an event; Google updates the attendees
- [google.calendar.watch](../capabilities/google.calendar.watch.md): Open an events.watch channel for a calendar
- [google.docs.batch_update](../capabilities/google.docs.batch_update.md): Edit a Google Doc with a list of requests
- [google.docs.create_document](../capabilities/google.docs.create_document.md): Create a Google Doc
- [google.docs.get_document](../capabilities/google.docs.get_document.md): Read a Google Doc as structured content
- [google.drive.changes_start_token](../capabilities/google.drive.changes_start_token.md): The Drive changes start page token, so a mount syncs incrementally from now instead of rescanning
- [google.drive.copy_file](../capabilities/google.drive.copy_file.md): Copy a Drive file
- [google.drive.create_folder](../capabilities/google.drive.create_folder.md): Create a Drive folder
- [google.drive.download_file](../capabilities/google.drive.download_file.md): Download a Drive file into a blob
- [google.drive.export_file](../capabilities/google.drive.export_file.md): Export a Google document, sheet or slide as PDF, DOCX, XLSX or text
- [google.drive.get_file](../capabilities/google.drive.get_file.md): Read Drive file metadata
- [google.drive.get_permissions](../capabilities/google.drive.get_permissions.md): Who a Drive file is shared with
- [google.drive.list_changes](../capabilities/google.drive.list_changes.md): Drive changes since a page token (mount sync and mount lag)
- [google.drive.list_files](../capabilities/google.drive.list_files.md): List or search Drive files and folders (My Drive and Shared Drives)
- [google.drive.share_file](../capabilities/google.drive.share_file.md): Share a Drive file with people; Google emails them
- [google.drive.stop_watch](../capabilities/google.drive.stop_watch.md): Close a Drive watch channel
- [google.drive.trash_file](../capabilities/google.drive.trash_file.md): Move a Drive file to Trash
- [google.drive.upload_file](../capabilities/google.drive.upload_file.md): Upload a Space file into Drive
- [google.drive.watch_changes](../capabilities/google.drive.watch_changes.md): Open a Drive changes.watch channel
- [google.dwd.disable](../capabilities/google.dwd.disable.md): Turn delegation off and stop every member sync
- [google.dwd.members](../capabilities/google.dwd.members.md): Workspace users mapped to Space members by email, with exclusion and mailbox state
- [google.dwd.probe](../capabilities/google.dwd.probe.md): Mint a token for a probe user and call users.getProfile to prove the delegation and scopes
- [google.dwd.scopes](../capabilities/google.dwd.scopes.md): The scope list and client id to paste into the Google Admin console
- [google.dwd.set_excluded](../capabilities/google.dwd.set_excluded.md): Exclude a member from delegation, or include them again (excluded members never get a connection)
- [google.dwd.setup](../capabilities/google.dwd.setup.md): Store the service account JSON (Vault item Google_DWD), map members by email and, with auto-connect on, create their Pending mail and calendar connections
- [google.dwd.status](../capabilities/google.dwd.status.md): State of domain-wide delegation: key stored, scopes, last probe, mapped members
- [google.gmail.create_draft](../capabilities/google.gmail.create_draft.md): Create a draft in the member mailbox
- [google.gmail.get_attachment](../capabilities/google.gmail.get_attachment.md): Download an attachment into a blob
- [google.gmail.get_message](../capabilities/google.gmail.get_message.md): Read one Gmail message
- [google.gmail.get_profile](../capabilities/google.gmail.get_profile.md): Gmail profile of the member (address, history id)
- [google.gmail.get_thread](../capabilities/google.gmail.get_thread.md): Read a Gmail thread
- [google.gmail.list_history](../capabilities/google.gmail.list_history.md): Changes since a history id (cursor polling: 2 min active, 15 idle, 1 h dormant)
- [google.gmail.list_labels](../capabilities/google.gmail.list_labels.md): List Gmail labels
- [google.gmail.list_messages](../capabilities/google.gmail.list_messages.md): Search or list Gmail messages
- [google.gmail.modify_labels](../capabilities/google.gmail.modify_labels.md): Add or remove labels on a message in the member mailbox
- [google.gmail.send_message](../capabilities/google.gmail.send_message.md): Send a message from the member mailbox
- [google.gmail.stop_watch](../capabilities/google.gmail.stop_watch.md): Stop Gmail push notices for the member mailbox
- [google.gmail.trash_message](../capabilities/google.gmail.trash_message.md): Move a Gmail message to Trash
- [google.gmail.watch](../capabilities/google.gmail.watch.md): Start Gmail push notices through Pub/Sub for the member mailbox
- [google.health](../capabilities/google.health.md): Health probe: mint a token for the probe user and call users.getProfile
- [google.meet.get_transcript_entries](../capabilities/google.meet.get_transcript_entries.md): Transcript entries (speaker, text, time)
- [google.meet.list_conference_records](../capabilities/google.meet.list_conference_records.md): List Meet conference records in a time range
- [google.meet.list_recordings](../capabilities/google.meet.list_recordings.md): Recordings of a conference record (they also land in the organizer Drive)
- [google.meet.list_transcripts](../capabilities/google.meet.list_transcripts.md): Transcripts of a conference record
- [google.meet.subscribe](../capabilities/google.meet.subscribe.md): Subscribe to Workspace Events for recording and transcript ready notices
- [google.receive_push](../capabilities/google.receive_push.md): Record a verified Google push (Gmail Pub/Sub, Calendar channel, Drive changes, Meet events) after dedupe
- [google.sheets.append_values](../capabilities/google.sheets.append_values.md): Append rows to a sheet
- [google.sheets.batch_update](../capabilities/google.sheets.batch_update.md): Apply structural changes to a spreadsheet (add sheet, format, resize)
- [google.sheets.create_spreadsheet](../capabilities/google.sheets.create_spreadsheet.md): Create a spreadsheet
- [google.sheets.get_spreadsheet](../capabilities/google.sheets.get_spreadsheet.md): Spreadsheet metadata: sheets and ranges
- [google.sheets.get_values](../capabilities/google.sheets.get_values.md): Read a range of cells
- [google.sheets.update_values](../capabilities/google.sheets.update_values.md): Write a range of cells

## Events (4)

- [google.dwd_configured](../events/google.dwd_configured.md): Domain-wide delegation was set up
- [google.dwd_probed](../events/google.dwd_probed.md): A delegation probe ran
- [google.dwd_revoked](../events/google.dwd_revoked.md): Delegation was turned off
- [google.push_received](../events/google.push_received.md): A verified Google push notice arrived (Gmail, Calendar, Drive or Meet)
