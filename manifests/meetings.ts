// meetings (lane L5): the Meeting record type (time, attendees, link, recording, transcript), the merge of a calendar
// event with a provider meeting, and attach_recording from Zoom, Google Meet and Teams. No meeting bot in v1 (lead
// ruling 50). Spec 2.18 (Meetings, Meeting sources in v1), 3.3 flow 5, ARCHITECTURE 8.3.
// DECISION: the summary is written by an AI step of the meeting_ended Automation template that Kits install;
// meetings.summarize is the capability that step (or a person) calls. No step is declared here.
// DECISION: meeting rows are ordinary records, so create/update/delete use records.*; this module adds only what a
// record cannot do (merge with events, attach recordings, summaries).
import { defineManifest, ev, field, read, rtype, screen, t, write } from '../packages/contracts/src/index.ts';
import { email, id, pageIn, pageOut } from './_common.ts';

const cevId = t.id('cev');
const calId = t.id('cld');
const provider = t.enm('zoom', 'meet', 'teams', 'none');
const mstatus = t.enm('scheduled', 'live', 'ended', 'canceled');
const meetingRow = t.obj({
  id: id.record, title: t.str(), startsAt: t.ts(), endsAt: t.opt(t.ts()), provider, joinUrl: t.opt(t.str()), status: mstatus, organizer: t.opt(id.user),
  attendeeIds: t.arr(id.record), calendarEventId: t.opt(cevId), recordingState: t.enm('none', 'pending', 'attached', 'unavailable'), hasTranscript: t.bool(), hasSummary: t.bool(),
});
const attendeeIn = t.obj({ email, name: t.opt(t.str()), contactId: t.opt(id.record) });
const sourceKind = t.enm('zoom', 'meet', 'teams', 'upload');

export default defineManifest({
  id: 'meetings',
  title: 'Meetings',
  owner: 'L5',
  recordTypes: [
    rtype('meeting', 'Meeting', 'Meetings', 'video', [
      field('title', 'text', 'Title', { required: true }),
      field('starts_at', 'datetime', 'Starts'),
      field('ends_at', 'datetime', 'Ends'),
      field('provider', 'choice', 'Provider', { default: 'none', options: { choices: [{ key: 'zoom', title: 'Zoom' }, { key: 'meet', title: 'Google Meet' }, { key: 'teams', title: 'Teams' }, { key: 'none', title: 'None' }] } }),
      field('join_url', 'url', 'Join link'),
      field('status', 'status', 'Status', { default: 'scheduled', options: { stages: [{ key: 'scheduled', title: 'Scheduled' }, { key: 'live', title: 'Live' }, { key: 'ended', title: 'Ended' }, { key: 'canceled', title: 'Canceled' }] } }),
      field('organizer', 'person', 'Organizer'),
      field('attendees', 'relation', 'Attendees', { options: { target: 'contact' } }),
      field('calendar_event_id', 'text', 'Calendar event'),
      field('provider_ref', 'text', 'Provider meeting id'),
      field('recording', 'files', 'Recording'),
      field('recording_state', 'choice', 'Recording state', { default: 'none', options: { choices: [{ key: 'none', title: 'None' }, { key: 'pending', title: 'Pending' }, { key: 'attached', title: 'Attached' }, { key: 'unavailable', title: 'Unavailable' }] } }),
      field('transcript', 'longtext', 'Transcript', { label: 'confidential' }),
      field('summary', 'longtext', 'Summary'),
      field('decisions', 'longtext', 'Decisions'),
    ], { statusField: 'status', ownerField: 'organizer', summaryField: 'summary', group: 'Activity' }),
  ],
  events: [
    ev('meeting.started', 'A meeting went live (provider or calendar time)', { p: { meetingId: id.record, provider }, subject: ['record', '/meetingId'], label: 'subject' }),
    ev('meeting.ended', 'A meeting ended', {
      p: { meetingId: id.record, provider, attendeeIds: t.arr(id.record) }, subject: ['record', '/meetingId'], label: 'subject', replay: 'stub', trigger: { title: 'A meeting ends', fields: ['/provider'] },
    }),
    ev('meeting.canceled', 'A meeting was canceled', { p: { meetingId: id.record }, subject: ['record', '/meetingId'], label: 'subject' }),
    ev('meeting.recording_attached', 'A recording was saved to the meeting folder', { p: { meetingId: id.record, fileId: id.file, source: sourceKind }, subject: ['record', '/meetingId'], label: 'subject' }),
    ev('meeting.transcript_ready', 'The transcript text was stored on the meeting', {
      p: { meetingId: id.record, source: sourceKind }, subject: ['record', '/meetingId'], label: 'subject', trigger: { title: 'A meeting transcript is ready', fields: ['/source'] },
    }),
    ev('meeting.summary_ready', 'A summary and decisions were written to the meeting', { p: { meetingId: id.record, byAgent: t.opt(id.agent) }, subject: ['record', '/meetingId'], label: 'subject' }),
    ev('meeting.merged', 'A calendar event and a provider meeting became one Meeting', {
      p: { meetingId: id.record, eventId: t.opt(cevId), providerRef: t.opt(t.str()), by: t.enm('time_and_attendees', 'link', 'person') }, subject: ['record', '/meetingId'], label: 'subject',
    }),
    ev('meeting.unmerged', 'A merged event was split off again', { p: { meetingId: id.record, eventId: cevId }, subject: ['record', '/meetingId'], label: 'subject' }),
  ],
  capabilities: [
    read('meetings.get', 'Read a meeting with recording, transcript, summary and decisions', {
      in: { meetingId: id.record },
      out: {
        meeting: meetingRow, recordingFileId: t.opt(id.file), recordingDurationSec: t.opt(t.int()), transcript: t.opt(t.str()), summary: t.opt(t.str()), decisions: t.opt(t.str()),
      },
      on: ['record', '/meetingId'], tool: 'inbox', label: 'check',
    }),
    read('meetings.list', 'List meetings by time, contact or status', {
      in: { from: t.opt(t.ts()), to: t.opt(t.ts()), contactId: t.opt(id.record), status: t.opt(mstatus), ...pageIn }, out: { meetings: t.arr(meetingRow), ...pageOut }, tool: 'inbox', label: 'filter',
    }),
    write('meetings.schedule', 'Schedule a meeting: calendar event, provider link and Meeting record in one step', {
      in: { title: t.str(), startsAt: t.ts(), endsAt: t.ts(), attendees: t.arr(attendeeIn), provider, calendarId: t.opt(calId), agenda: t.opt(t.str()) },
      out: { meetingId: id.record, eventId: cevId, joinUrl: t.opt(t.str()) }, perm: 'records.create', idem: 'key', gate: { act: 'send', when: "actor.kind != 'person'" },
      tool: 'inbox', offline: 'queue',
    }),
    write('meetings.cancel', 'Cancel a meeting and its calendar event', {
      in: { meetingId: id.record }, out: { meetingId: id.record }, on: ['record', '/meetingId'], perm: 'records.edit', emits: ['meeting.canceled'], gate: { act: 'send', when: "actor.kind != 'person'" }, tool: 'inbox',
    }),
    write('meetings.ingest', 'Land a calendar event or provider meeting: merge on time plus attendees or on link into one Meeting', {
      in: {
        source: t.enm('calendar', 'zoom', 'meet', 'teams'), providerRef: t.str(), calendarEventId: t.opt(cevId), title: t.opt(t.str()), startsAt: t.ts(), endsAt: t.opt(t.ts()),
        joinUrl: t.opt(t.str()), attendees: t.arr(attendeeIn), status: t.opt(mstatus),
      },
      out: { meetingId: id.record, created: t.bool(), merged: t.bool() }, emits: ['meeting.merged'], idem: 'natural',
    }),
    write('meetings.set_state', 'Mark a meeting live or ended from a provider or calendar signal', {
      in: { meetingId: id.record, state: t.enm('live', 'ended') }, out: { meetingId: id.record }, on: ['record', '/meetingId'], emits: ['meeting.started', 'meeting.ended'], idem: 'natural',
    }),
    write('meetings.merge', 'Merge two meetings that describe one call', {
      in: { meetingId: id.record, otherId: id.record }, out: { meetingId: id.record }, on: ['record', '/meetingId'], perm: 'records.edit', emits: ['meeting.merged'], tool: 'inbox',
    }),
    write('meetings.unmerge', 'Split a calendar event off a merged meeting', {
      in: { meetingId: id.record, eventId: cevId }, out: { meetingId: id.record, newMeetingId: t.opt(id.record) }, on: ['record', '/meetingId'], perm: 'records.edit', emits: ['meeting.unmerged'], tool: 'inbox',
    }),
    write('meetings.match_attendees', 'Link attendee emails to contact records (sure matches link, unsure go to Needs you)', {
      in: { meetingId: id.record }, out: { matched: t.int(), unsure: t.int() }, on: ['record', '/meetingId'], perm: 'records.edit', tool: 'inbox',
    }),
    write('meetings.attach_recording', 'Download a provider recording into the meeting folder, store the transcript text and show them in the conversation', {
      in: { meetingId: id.record, source: sourceKind, providerRef: t.opt(t.str()), fileId: t.opt(id.file), transcriptText: t.opt(t.str()) },
      out: { runId: id.run }, on: ['record', '/meetingId'], perm: 'records.edit', run: { kind: 'meeting_recording', stoppable: true },
      emits: ['meeting.recording_attached', 'meeting.transcript_ready'], tool: 'inbox', idem: 'natural', errors: ['provider.auth_failed', 'provider.unavailable', 'validation.precondition_failed'],
    }),
    read('meetings.transcript.get', 'Transcript segments of a meeting', {
      in: { meetingId: id.record, ...pageIn }, out: { segments: t.arr(t.obj({ startMs: t.int(), endMs: t.int(), speaker: t.opt(t.str()), text: t.str() })), ...pageOut },
      on: ['record', '/meetingId'], tool: 'inbox', label: 'check',
    }),
    write('meetings.summarize', 'Summarise a meeting and pull decisions into linked records with the meeting as source', {
      in: { meetingId: id.record, agentId: t.opt(id.agent), pullDecisions: t.opt(t.bool()) }, out: { runId: id.run }, on: ['record', '/meetingId'], perm: 'records.edit',
      run: { kind: 'meeting_summary', stoppable: true }, emits: ['meeting.summary_ready'], tool: 'inbox',
    }),
    write('meetings.set_summary', 'Write or correct the summary and decisions of a meeting', {
      in: { meetingId: id.record, summary: t.opt(t.str()), decisions: t.opt(t.str()) }, out: { meetingId: id.record }, on: ['record', '/meetingId'], perm: 'records.edit',
      emits: ['meeting.summary_ready'], tool: 'inbox', offline: 'patch',
    }),
  ],
  screens: [
    screen('meetings.panel', 'inbox', 'ui:MeetingPanel', {
      slot: 'side',
      q: { meeting: ['meetings.get', { meetingId: '/state/meetingId' }, true], transcript: ['meetings.transcript.get', { meetingId: '/state/meetingId' }, true] },
      a: {
        attach: ['meetings.attach_recording', { meetingId: '/state/meetingId', source: '/state/source', providerRef: '/state/providerRef' }],
        summarize: ['meetings.summarize', { meetingId: '/state/meetingId' }], save: ['meetings.set_summary', { meetingId: '/state/meetingId', summary: '/state/summary', decisions: '/state/decisions' }],
        unmerge: ['meetings.unmerge', { meetingId: '/state/meetingId', eventId: '/state/eventId' }], match: ['meetings.match_attendees', { meetingId: '/state/meetingId' }],
      },
      empty: 'No recording or transcript yet',
    }),
    screen('meetings.schedule', 'inbox', 'ui:ScheduleMeeting', {
      slot: 'sheet',
      a: { schedule: ['meetings.schedule', { title: '/state/title', startsAt: '/state/startsAt', endsAt: '/state/endsAt', attendees: '/state/attendees', provider: '/state/provider', calendarId: '/state/calendarId' }] },
      empty: 'Pick a time',
    }),
  ],
});
