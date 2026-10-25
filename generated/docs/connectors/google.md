# Google Workspace

Key google, module google. Mode dwd, owned by a space. Auth service_account_dwd.

## Egress domains

- *.googleapis.com
- oauth2.googleapis.com
- meet.googleapis.com

## Secrets (names only)

- Google_DWD: Service account JSON key used for domain-wide delegation

## Webhook sources

- /hooks/google (signature) emits google.push_received

## Actions

- google.dwd.status
- google.dwd.scopes
- google.dwd.setup
- google.dwd.probe
- google.dwd.members
- google.dwd.set_excluded
- google.dwd.disable
- google.health
- google.receive_push
- google.gmail.get_profile
- google.gmail.list_labels
- google.gmail.list_messages
- google.gmail.get_message
- google.gmail.get_thread
- google.gmail.list_history
- google.gmail.get_attachment
- google.gmail.modify_labels
- google.gmail.create_draft
- google.gmail.send_message
- google.gmail.trash_message
- google.gmail.watch
- google.gmail.stop_watch
- google.calendar.list_calendars
- google.calendar.list_events
- google.calendar.get_event
- google.calendar.create_event
- google.calendar.update_event
- google.calendar.delete_event
- google.calendar.respond
- google.calendar.free_busy
- google.calendar.watch
- google.calendar.stop_watch
- google.drive.list_files
- google.drive.get_file
- google.drive.download_file
- google.drive.export_file
- google.drive.get_permissions
- google.drive.upload_file
- google.drive.create_folder
- google.drive.copy_file
- google.drive.share_file
- google.drive.trash_file
- google.drive.changes_start_token
- google.drive.list_changes
- google.drive.watch_changes
- google.drive.stop_watch
- google.sheets.get_spreadsheet
- google.sheets.get_values
- google.sheets.update_values
- google.sheets.append_values
- google.sheets.create_spreadsheet
- google.sheets.batch_update
- google.docs.get_document
- google.docs.create_document
- google.docs.batch_update
- google.meet.list_conference_records
- google.meet.list_recordings
- google.meet.list_transcripts
- google.meet.get_transcript_entries
- google.meet.subscribe
- mail.connect
- mail.sync_now
- mail.send_as

## Synced types

