# Meetings (meetings)

Lane L5. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (13)

- [meetings.attach_recording](../capabilities/meetings.attach_recording.md): Download a provider recording into the meeting folder, store the transcript text and show them in the conversation
- [meetings.cancel](../capabilities/meetings.cancel.md): Cancel a meeting and its calendar event
- [meetings.get](../capabilities/meetings.get.md): Read a meeting with recording, transcript, summary and decisions
- [meetings.ingest](../capabilities/meetings.ingest.md): Land a calendar event or provider meeting: merge on time plus attendees or on link into one Meeting
- [meetings.list](../capabilities/meetings.list.md): List meetings by time, contact or status
- [meetings.match_attendees](../capabilities/meetings.match_attendees.md): Link attendee emails to contact records (sure matches link, unsure go to Needs you)
- [meetings.merge](../capabilities/meetings.merge.md): Merge two meetings that describe one call
- [meetings.schedule](../capabilities/meetings.schedule.md): Schedule a meeting: calendar event, provider link and Meeting record in one step
- [meetings.set_state](../capabilities/meetings.set_state.md): Mark a meeting live or ended from a provider or calendar signal
- [meetings.set_summary](../capabilities/meetings.set_summary.md): Write or correct the summary and decisions of a meeting
- [meetings.summarize](../capabilities/meetings.summarize.md): Summarise a meeting and pull decisions into linked records with the meeting as source
- [meetings.transcript.get](../capabilities/meetings.transcript.get.md): Transcript segments of a meeting
- [meetings.unmerge](../capabilities/meetings.unmerge.md): Split a calendar event off a merged meeting

## Events (8)

- [meeting.canceled](../events/meeting.canceled.md): A meeting was canceled
- [meeting.ended](../events/meeting.ended.md): A meeting ended
- [meeting.merged](../events/meeting.merged.md): A calendar event and a provider meeting became one Meeting
- [meeting.recording_attached](../events/meeting.recording_attached.md): A recording was saved to the meeting folder
- [meeting.started](../events/meeting.started.md): A meeting went live (provider or calendar time)
- [meeting.summary_ready](../events/meeting.summary_ready.md): A summary and decisions were written to the meeting
- [meeting.transcript_ready](../events/meeting.transcript_ready.md): The transcript text was stored on the meeting
- [meeting.unmerged](../events/meeting.unmerged.md): A merged event was split off again
