# Microsoft 365

Key microsoft, module microsoft. Mode oauth_app, owned by a space. Auth client_credentials.

## Egress domains

- graph.microsoft.com
- login.microsoftonline.com

## Secrets (names only)

- Microsoft_App: App registration client id, client secret and tenant id. Application permissions: Mail.ReadWrite, Mail.Send, Calendars.ReadWrite, Files.ReadWrite.All, User.Read.All, OnlineMeetingRecording.Read.All, OnlineMeetingTranscript.Read.All

## Webhook sources

- /hooks/graph (signature) emits microsoft.notification_received

## Actions

- ms.consent.status
- ms.consent.link
- ms.consent.policy_snippet
- ms.consent.setup
- ms.consent.verify
- ms.consent.members
- ms.consent.set_excluded
- ms.consent.disable
- ms.health
- ms.receive_notification
- ms.subscriptions.renew
- ms.mail.list_folders
- ms.mail.list_messages
- ms.mail.get_message
- ms.mail.delta
- ms.mail.get_attachment
- ms.mail.update_message
- ms.mail.move_message
- ms.mail.create_draft
- ms.mail.send_message
- ms.mail.delete_message
- ms.mail.subscribe
- ms.mail.unsubscribe
- ms.calendar.list_calendars
- ms.calendar.list_events
- ms.calendar.get_event
- ms.calendar.delta
- ms.calendar.create_event
- ms.calendar.update_event
- ms.calendar.delete_event
- ms.calendar.respond
- ms.calendar.get_schedule
- ms.calendar.find_meeting_times
- ms.calendar.subscribe
- ms.calendar.unsubscribe
- ms.drive.list_items
- ms.drive.get_item
- ms.drive.download_item
- ms.drive.delta
- ms.drive.upload_item
- ms.drive.create_folder
- ms.drive.share_item
- ms.drive.delete_item
- ms.teams.recordings.list_recordings
- ms.teams.recordings.get_recording
- ms.teams.recordings.list_transcripts
- ms.teams.recordings.get_transcript
- ms.teams.recordings.subscribe
- mail.connect
- mail.sync_now
- mail.send_as

## Synced types

