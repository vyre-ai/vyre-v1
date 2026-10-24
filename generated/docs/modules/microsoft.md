# Microsoft 365 (microsoft)

Lane L5. Kind connector. Status stub. Version 0.1.0.

Requires: mail.

## Capabilities (48)

- [ms.calendar.create_event](../capabilities/ms.calendar.create_event.md): Create an event; Exchange invites the attendees
- [ms.calendar.delete_event](../capabilities/ms.calendar.delete_event.md): Delete an event; Exchange tells the attendees
- [ms.calendar.delta](../capabilities/ms.calendar.delta.md): Changes in a calendar view since a delta link
- [ms.calendar.find_meeting_times](../capabilities/ms.calendar.find_meeting_times.md): Suggested meeting times for a set of attendees
- [ms.calendar.get_event](../capabilities/ms.calendar.get_event.md): Read one event
- [ms.calendar.get_schedule](../capabilities/ms.calendar.get_schedule.md): Free and busy blocks for people over a range
- [ms.calendar.list_calendars](../capabilities/ms.calendar.list_calendars.md): List the calendars of the member
- [ms.calendar.list_events](../capabilities/ms.calendar.list_events.md): List events in a range
- [ms.calendar.respond](../capabilities/ms.calendar.respond.md): Accept, decline or answer maybe to an invitation
- [ms.calendar.subscribe](../capabilities/ms.calendar.subscribe.md): Subscribe to change notifications for a calendar
- [ms.calendar.unsubscribe](../capabilities/ms.calendar.unsubscribe.md): Remove a calendar change subscription
- [ms.calendar.update_event](../capabilities/ms.calendar.update_event.md): Change an event; Exchange updates the attendees
- [ms.consent.disable](../capabilities/ms.consent.disable.md): Turn the Microsoft connection off and stop every member sync
- [ms.consent.link](../capabilities/ms.consent.link.md): The admin consent link to open as a tenant admin, with the application permissions it grants
- [ms.consent.members](../capabilities/ms.consent.members.md): Tenant users mapped to Space members by email, with exclusion and mailbox state
- [ms.consent.policy_snippet](../capabilities/ms.consent.policy_snippet.md): PowerShell for the Exchange application access policy, limited to the mapped members, for a tenant admin to run
- [ms.consent.set_excluded](../capabilities/ms.consent.set_excluded.md): Exclude a member from the connection, or include them again (excluded members never get a connection)
- [ms.consent.setup](../capabilities/ms.consent.setup.md): Store the app registration (Vault item Microsoft_App), map members by email and, with auto-connect on, create their Pending mail and calendar connections
- [ms.consent.status](../capabilities/ms.consent.status.md): State of the Microsoft 365 connection: app registered, consent given, access policy checked, mapped members
- [ms.consent.verify](../capabilities/ms.consent.verify.md): Call GET /organization and check consent and the access policy for a probe member
- [ms.drive.create_folder](../capabilities/ms.drive.create_folder.md): Create a folder
- [ms.drive.delete_item](../capabilities/ms.drive.delete_item.md): Delete an item
- [ms.drive.delta](../capabilities/ms.drive.delta.md): Item changes since a delta link (mount sync and mount lag)
- [ms.drive.download_item](../capabilities/ms.drive.download_item.md): Download an item into a blob
- [ms.drive.get_item](../capabilities/ms.drive.get_item.md): Read item metadata
- [ms.drive.list_items](../capabilities/ms.drive.list_items.md): List items in a OneDrive or SharePoint folder
- [ms.drive.share_item](../capabilities/ms.drive.share_item.md): Create a sharing link or invite people; Microsoft emails them
- [ms.drive.upload_item](../capabilities/ms.drive.upload_item.md): Upload a Space file into OneDrive or SharePoint
- [ms.health](../capabilities/ms.health.md): Health probe: GET /organization
- [ms.mail.create_draft](../capabilities/ms.mail.create_draft.md): Create a draft in the member mailbox
- [ms.mail.delete_message](../capabilities/ms.mail.delete_message.md): Delete a message (moves it to Deleted Items)
- [ms.mail.delta](../capabilities/ms.mail.delta.md): Changes in a mail folder since a delta link (fallback when change notifications are missed)
- [ms.mail.get_attachment](../capabilities/ms.mail.get_attachment.md): Download an attachment into a blob
- [ms.mail.get_message](../capabilities/ms.mail.get_message.md): Read one message
- [ms.mail.list_folders](../capabilities/ms.mail.list_folders.md): List mail folders of the member
- [ms.mail.list_messages](../capabilities/ms.mail.list_messages.md): List or search messages
- [ms.mail.move_message](../capabilities/ms.mail.move_message.md): Move a message to another folder
- [ms.mail.send_message](../capabilities/ms.mail.send_message.md): Send a message from the member mailbox
- [ms.mail.subscribe](../capabilities/ms.mail.subscribe.md): Subscribe to change notifications for a mail folder
- [ms.mail.unsubscribe](../capabilities/ms.mail.unsubscribe.md): Remove a mail change subscription
- [ms.mail.update_message](../capabilities/ms.mail.update_message.md): Mark read, flag or categorise a message in the member mailbox
- [ms.receive_notification](../capabilities/ms.receive_notification.md): Record a verified Graph change notification (answers the validationToken handshake) after dedupe
- [ms.subscriptions.renew](../capabilities/ms.subscriptions.renew.md): Renew every Graph subscription before it expires (lifetime is about 3 days); a Run does this on a schedule
- [ms.teams.recordings.get_recording](../capabilities/ms.teams.recordings.get_recording.md): Download a Teams recording into a blob
- [ms.teams.recordings.get_transcript](../capabilities/ms.teams.recordings.get_transcript.md): Transcript text (VTT) of an online meeting
- [ms.teams.recordings.list_recordings](../capabilities/ms.teams.recordings.list_recordings.md): Recordings of an online meeting
- [ms.teams.recordings.list_transcripts](../capabilities/ms.teams.recordings.list_transcripts.md): Transcripts of an online meeting
- [ms.teams.recordings.subscribe](../capabilities/ms.teams.recordings.subscribe.md): Subscribe to recording and transcript ready notices

## Events (4)

- [microsoft.consent_configured](../events/microsoft.consent_configured.md): The Microsoft app registration was stored and members mapped
- [microsoft.consent_revoked](../events/microsoft.consent_revoked.md): The Microsoft connection was turned off
- [microsoft.consent_verified](../events/microsoft.consent_verified.md): A consent and access policy check ran
- [microsoft.notification_received](../events/microsoft.notification_received.md): A verified Graph change notification arrived
