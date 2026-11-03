# Meetings (meetings)

Lane L5. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (25)

- [meetings.attach_recording](../capabilities/meetings.attach_recording.md): Download a provider recording into the meeting folder, store the transcript text and show them in the conversation
- [meetings.cancel](../capabilities/meetings.cancel.md): Cancel a meeting and its calendar event
- [meetings.closeout.approve](../capabilities/meetings.closeout.approve.md): Approve close-out items (all the proposed ones when none are named): create the tasks, apply the record updates, send or save the email, add the holds
- [meetings.closeout.edit](../capabilities/meetings.closeout.edit.md): Change one proposed close-out item before it is approved
- [meetings.closeout.get](../capabilities/meetings.closeout.get.md): One meeting close-out: summary, decisions, open questions and the proposed tasks, record updates, follow-up email and calendar hold
- [meetings.closeout.list](../capabilities/meetings.closeout.list.md): The Meetings tab of the Inbox: your meetings (and meetings shared to a project or channel you can read) with their close-out state
- [meetings.closeout.prepare](../capabilities/meetings.closeout.prepare.md): Have the meeting owner's Assistant prepare the close-out from the transcript; redo starts it again without duplicating what was approved
- [meetings.closeout.propose](../capabilities/meetings.closeout.propose.md): The Assistant's close-out of a meeting: summary, decisions, open questions, action items, record updates, the follow-up email and the next meeting
- [meetings.closeout.share](../capabilities/meetings.closeout.share.md): Share a meeting and its close-out with a project or channel (everyone who can read it sees it in their Meetings tab), or stop sharing
- [meetings.closeout.skip](../capabilities/meetings.closeout.skip.md): Skip a proposed close-out item, or bring a skipped one back
- [meetings.closeout.sync](../capabilities/meetings.closeout.sync.md): Prepare the close-out of each of your recent meetings that has a transcript and none yet
- [meetings.get](../capabilities/meetings.get.md): Read a meeting with recording, transcript, summary and decisions
- [meetings.ingest](../capabilities/meetings.ingest.md): Land a calendar event or provider meeting: merge on time plus attendees or on link into one Meeting
- [meetings.list](../capabilities/meetings.list.md): List meetings by time, contact or status
- [meetings.match_attendees](../capabilities/meetings.match_attendees.md): Link attendee emails to contact records (sure matches link, unsure go to Needs you)
- [meetings.merge](../capabilities/meetings.merge.md): Merge two meetings that describe one call
- [meetings.prep.get](../capabilities/meetings.prep.get.md): Your prep notes for an event: whether your Assistant is still working on them, and the notes
- [meetings.prep.save](../capabilities/meetings.prep.save.md): The Assistant's prep notes for an event, a few short lines
- [meetings.prep.start](../capabilities/meetings.prep.start.md): Ask your Assistant to prepare for an event from the attendees' records and your past meetings with them
- [meetings.schedule](../capabilities/meetings.schedule.md): Schedule a meeting: calendar event, provider link and Meeting record in one step
- [meetings.set_state](../capabilities/meetings.set_state.md): Mark a meeting live or ended from a provider or calendar signal
- [meetings.set_summary](../capabilities/meetings.set_summary.md): Write or correct the summary and decisions of a meeting
- [meetings.summarize](../capabilities/meetings.summarize.md): Summarise a meeting and pull decisions into linked records with the meeting as source
- [meetings.transcript.get](../capabilities/meetings.transcript.get.md): Transcript segments of a meeting
- [meetings.unmerge](../capabilities/meetings.unmerge.md): Split a calendar event off a merged meeting

## Events (10)

- [meeting.canceled](../events/meeting.canceled.md): A meeting was canceled
- [meeting.closed](../events/meeting.closed.md): Every item of a meeting close-out was approved or skipped
- [meeting.closeout_ready](../events/meeting.closeout_ready.md): The close-out package of a meeting is ready to approve
- [meeting.ended](../events/meeting.ended.md): A meeting ended
- [meeting.merged](../events/meeting.merged.md): A calendar event and a provider meeting became one Meeting
- [meeting.recording_attached](../events/meeting.recording_attached.md): A recording was saved to the meeting folder
- [meeting.started](../events/meeting.started.md): A meeting went live (provider or calendar time)
- [meeting.summary_ready](../events/meeting.summary_ready.md): A summary and decisions were written to the meeting
- [meeting.transcript_ready](../events/meeting.transcript_ready.md): The transcript text was stored on the meeting
- [meeting.unmerged](../events/meeting.unmerged.md): A merged event was split off again
