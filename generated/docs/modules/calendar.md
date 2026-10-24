# Calendar (calendar)

Lane L5. Kind module. Status stub. Version 0.1.0.

Requires: nothing.

## Capabilities (19)

- [calendar.availability](../capabilities/calendar.availability.md): Busy blocks for people over a range (the shaded stripes while adding people)
- [calendar.create_calendar](../capabilities/calendar.create_calendar.md): Create a local calendar (for example a private Personal one)
- [calendar.create_event](../capabilities/calendar.create_event.md): Create an event (drag in 15 minute steps); the provider invites attendees
- [calendar.delete_calendar](../capabilities/calendar.delete_calendar.md): Delete a local calendar (provider calendars are disconnected, not deleted)
- [calendar.delete_event](../capabilities/calendar.delete_event.md): Delete an event (Undo in the title bar restores it)
- [calendar.duplicate_event](../capabilities/calendar.duplicate_event.md): Duplicate an event
- [calendar.find_time](../capabilities/calendar.find_time.md): Find a time: the next free slots for a set of people
- [calendar.get_event](../capabilities/calendar.get_event.md): Read one event with attendees, agenda, linked records and meeting
- [calendar.health](../capabilities/calendar.health.md): Calendar sync health: age of the last successful sync per calendar
- [calendar.ingest_event](../capabilities/calendar.ingest_event.md): Land one provider event: upsert by provider id, then merge with a meeting on time plus attendees or on link
- [calendar.link_record](../capabilities/calendar.link_record.md): Link an event to records, or remove a link (Open Record, Open Conversation)
- [calendar.list_calendars](../capabilities/calendar.list_calendars.md): List calendars: Work Google, Microsoft and the private Personal one, with colours
- [calendar.list_events](../capabilities/calendar.list_events.md): Events in a time range for chosen calendars (Day, Week and Month views)
- [calendar.move_to_calendar](../capabilities/calendar.move_to_calendar.md): Move an event to another calendar
- [calendar.respond](../capabilities/calendar.respond.md): Accept, decline or answer maybe to an invitation
- [calendar.restore_event](../capabilities/calendar.restore_event.md): Restore a deleted event
- [calendar.sync_now](../capabilities/calendar.sync_now.md): Sync a calendar now
- [calendar.update_calendar](../capabilities/calendar.update_calendar.md): Rename a calendar or change its colour
- [calendar.update_event](../capabilities/calendar.update_event.md): Change, move or resize an event

## Events (6)

- [calendar.synced](../events/calendar.synced.md): A calendar finished a sync pass
- [calendar_event.created](../events/calendar_event.created.md): An event was created in Vyre or arrived from a provider
- [calendar_event.deleted](../events/calendar_event.deleted.md): An event was deleted (Undo restores it)
- [calendar_event.response_changed](../events/calendar_event.response_changed.md): An attendee or the caller answered an invitation
- [calendar_event.restored](../events/calendar_event.restored.md): A deleted event came back
- [calendar_event.updated](../events/calendar_event.updated.md): An event moved or changed
