// calendar (lane L5): the Calendar view inside Inbox. Calendars from Google and Microsoft plus a private Personal one,
// events, availability, Find a time, and the merge with meetings. Spec 3.3 flow 4, 2.18 (Calendar), 2.10 (calendar sync).
// DECISION: event capabilities bind to the Space resource and rely on the calendar_event row ACL (the calendar's owner
// and connection) because no 'calendar' ResourceType exists.
// NOT EXPRESSIBLE: ResourceType has no 'calendar'; the entity ACL uses 'connection' and the handler adds the owner rule
// for local Personal calendars that have no connection.
// DECISION: create, update, delete and respond are plain writes (the provider sends invitations when the outbox syncs).
// For agents, automations and campaigns they are held by the Gate act 'send' when the event has attendees.
import { defineManifest, entity, ev, health, read, screen, t, write } from '../packages/contracts/src/index.ts';
import { email, id, pageIn, pageOut } from './_common.ts';

const calId = t.id('cld');
const cevId = t.id('cev');
const attendee = t.obj({ email, name: t.opt(t.str()), contactId: t.opt(id.record), optional: t.opt(t.bool()), response: t.opt(t.enm('needs_action', 'accepted', 'declined', 'tentative')) });
const joinProvider = t.enm('zoom', 'meet', 'teams', 'none');
const calendarRow = t.obj({
  id: calId, title: t.str(), color: t.str({ examples: ['#4f6bed'] }), provider: t.enm('google', 'microsoft', 'local'), connectionId: t.opt(id.connection),
  ownerId: id.user, personal: t.bool(), state: t.enm('syncing', 'paused', 'error'),
});
const eventRow = t.obj({
  id: cevId, calendarId: calId, title: t.str(), startsAt: t.ts(), endsAt: t.ts(), allDay: t.bool(), location: t.opt(t.str()), joinUrl: t.opt(t.str()), joinProvider,
  description: t.opt(t.str()), agenda: t.opt(t.str()), attendees: t.arr(attendee), organizer: t.opt(email), recordIds: t.arr(id.record), meetingId: t.opt(id.record),
  status: t.enm('confirmed', 'tentative', 'canceled'), bookedByAgentId: t.opt(id.agent), fromBookingPage: t.opt(id.form),
});
const eventFields = {
  calendarId: calId, title: t.str(), startsAt: t.ts(), endsAt: t.ts(), allDay: t.opt(t.bool()), location: t.opt(t.str()), description: t.opt(t.str()), agenda: t.opt(t.str()),
  attendees: t.opt(t.arr(attendee)), recordIds: t.opt(t.arr(id.record)), joinProvider: t.opt(joinProvider), bookedByAgentId: t.opt(id.agent), fromBookingPage: t.opt(id.form),
};
const sendGate = { act: 'send', when: "actor.kind != 'person' && input.attendees != null" };
const healthOut = { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()) };

export default defineManifest({
  id: 'calendar',
  title: 'Calendar',
  owner: 'L5',
  entities: [
    entity('calendar', 'calendar_list', 'cld_', { title: 'text', color: 'text', provider: 'choice', connectionId: 'text', remoteId: 'text', ownerId: 'person', personal: 'checkbox', state: 'status' }, 'connection', {
      parentField: 'connectionId', ownerField: 'ownerId',
    }),
    entity('calendar_event', 'calendar_event', 'cev_', {
      calendarId: 'text', title: 'text', startsAt: 'datetime', endsAt: 'datetime', allDay: 'checkbox', location: 'text', joinUrl: 'url', joinProvider: 'choice',
      description: 'longtext', agenda: 'longtext', attendees: 'text', organizer: 'email', recordIds: 'text', meetingId: 'text', providerId: 'text', status: 'status',
      bookedByAgentId: 'text', fromBookingPage: 'text', deletedAt: 'datetime',
    }, 'connection', {
      parent: { entity: 'calendar', field: 'calendarId' }, parentField: 'calendarId', fts: ['title', 'location', 'description'],
      sync: { profile: { desktop: 'window', phone: 'window', web: 'window' }, window: { days: 120, recentCount: 500 }, protectedFields: ['status'] },
    }),
  ],
  events: [
    ev('calendar_event.created', 'An event was created in Vyre or arrived from a provider', {
      p: { eventId: cevId, calendarId: calId, startsAt: t.ts(), attendeeCount: t.int(), source: t.enm('vyre', 'google', 'microsoft', 'booking') }, subject: ['entity', '/eventId'], label: 'subject',
      trigger: { title: 'An event is created', fields: ['/calendarId', '/source'] },
    }),
    ev('calendar_event.updated', 'An event moved or changed', { p: { eventId: cevId, calendarId: calId, fields: t.arr(t.str()) }, subject: ['entity', '/eventId'], label: 'subject' }),
    ev('calendar_event.deleted', 'An event was deleted (Undo restores it)', { p: { eventId: cevId, calendarId: calId }, subject: ['entity', '/eventId'], label: 'subject' }),
    ev('calendar_event.restored', 'A deleted event came back', { p: { eventId: cevId, calendarId: calId }, subject: ['entity', '/eventId'], label: 'subject' }),
    ev('calendar_event.response_changed', 'An attendee or the caller answered an invitation', { p: { eventId: cevId, email, response: t.enm('accepted', 'declined', 'tentative') }, subject: ['entity', '/eventId'], label: 'subject' }),
    ev('calendar.synced', 'A calendar finished a sync pass', { p: { calendarId: calId, upserted: t.int(), removed: t.int() }, subject: ['entity', '/calendarId'], vis: 'participants' }),
  ],
  capabilities: [
    read('calendar.list_calendars', 'List calendars: Work Google, Microsoft and the private Personal one, with colours', {
      in: { scope: t.opt(t.enm('mine', 'shared', 'all')) }, out: { calendars: t.arr(calendarRow) }, tool: 'inbox', label: 'filter',
    }),
    write('calendar.create_calendar', 'Create a local calendar (for example a private Personal one)', {
      in: { title: t.str(), color: t.opt(t.str()), personal: t.opt(t.bool()) }, out: { calendar: calendarRow }, idem: 'key', tool: 'inbox',
    }),
    write('calendar.update_calendar', 'Rename a calendar or change its colour', {
      in: { calendarId: calId, title: t.opt(t.str()), color: t.opt(t.str()) }, out: { calendar: calendarRow }, tool: 'inbox',
    }),
    write('calendar.delete_calendar', 'Delete a local calendar (provider calendars are disconnected, not deleted)', {
      in: { calendarId: calId }, out: { deleted: t.bool() }, tool: 'inbox', gate: { act: 'delete', when: "actor.kind != 'person'" },
    }),
    read('calendar.list_events', 'Events in a time range for chosen calendars (Day, Week and Month views)', {
      in: { from: t.ts(), to: t.ts(), calendarIds: t.opt(t.arr(calId)), query: t.opt(t.str()), ...pageIn }, out: { events: t.arr(eventRow), ...pageOut }, tool: 'inbox', label: 'filter',
    }),
    read('calendar.get_event', 'Read one event with attendees, agenda, linked records and meeting', { in: { eventId: cevId }, out: { event: eventRow }, tool: 'inbox', label: 'check' }),
    write('calendar.create_event', 'Create an event (drag in 15 minute steps); the provider invites attendees', {
      in: eventFields, out: { event: eventRow }, emits: ['calendar_event.created'], idem: 'key', gate: sendGate, tool: 'inbox', offline: 'queue', cli: 'vyre calendar create',
    }),
    write('calendar.update_event', 'Change, move or resize an event', {
      in: { eventId: cevId, title: t.opt(t.str()), startsAt: t.opt(t.ts()), endsAt: t.opt(t.ts()), allDay: t.opt(t.bool()), location: t.opt(t.str()), description: t.opt(t.str()), agenda: t.opt(t.str()), attendees: t.opt(t.arr(attendee)), joinProvider: t.opt(joinProvider) },
      out: { event: eventRow }, emits: ['calendar_event.updated'], gate: sendGate, tool: 'inbox', offline: 'patch',
    }),
    write('calendar.delete_event', 'Delete an event (Undo in the title bar restores it)', {
      in: { eventId: cevId }, out: { deleted: t.bool() }, emits: ['calendar_event.deleted'], gate: { act: 'send', when: "actor.kind != 'person'" }, tool: 'inbox', offline: 'queue',
    }),
    write('calendar.restore_event', 'Restore a deleted event', { in: { eventId: cevId }, out: { event: eventRow }, emits: ['calendar_event.restored'], tool: 'inbox' }),
    write('calendar.duplicate_event', 'Duplicate an event', { in: { eventId: cevId, startsAt: t.opt(t.ts()) }, out: { event: eventRow }, emits: ['calendar_event.created'], idem: 'key', tool: 'inbox' }),
    write('calendar.move_to_calendar', 'Move an event to another calendar', { in: { eventId: cevId, calendarId: calId }, out: { event: eventRow }, emits: ['calendar_event.updated'], tool: 'inbox' }),
    write('calendar.respond', 'Accept, decline or answer maybe to an invitation', {
      in: { eventId: cevId, response: t.enm('accepted', 'declined', 'tentative'), comment: t.opt(t.str()) }, out: { event: eventRow }, emits: ['calendar_event.response_changed'],
      gate: { act: 'send', when: "actor.kind != 'person'" }, tool: 'inbox',
    }),
    write('calendar.link_record', 'Link an event to records, or remove a link (Open Record, Open Conversation)', {
      in: { eventId: cevId, recordIds: t.arr(id.record), unlink: t.opt(t.bool()) }, out: { event: eventRow }, emits: ['calendar_event.updated'], tool: 'inbox',
    }),
    read('calendar.availability', 'Busy blocks for people over a range (the shaded stripes while adding people)', {
      in: { people: t.arr(t.str({ description: 'Member id or email' }), { minItems: 1 }), from: t.ts(), to: t.ts() },
      out: { busy: t.arr(t.obj({ who: t.str(), startsAt: t.ts(), endsAt: t.ts() })), unknown: t.arr(t.str()) }, tool: 'inbox',
    }),
    read('calendar.find_time', 'Find a time: the next free slots for a set of people', {
      in: { people: t.arr(t.str(), { minItems: 1 }), durationMinutes: t.int({ minimum: 5, maximum: 600 }), from: t.ts(), to: t.ts(), workingHoursOnly: t.opt(t.bool()), limit: t.opt(t.int({ minimum: 1, maximum: 20 })) },
      out: { slots: t.arr(t.obj({ startsAt: t.ts(), endsAt: t.ts() })) }, tool: 'inbox', cli: 'vyre calendar find-time',
    }),
    write('calendar.sync_now', 'Sync a calendar now', {
      in: { calendarId: calId }, out: { runId: id.run }, level: 'use', emits: ['calendar.synced'], run: { kind: 'calendar_sync', stoppable: true }, tool: 'inbox', idem: 'natural',
    }),
    write('calendar.ingest_event', 'Land one provider event: upsert by provider id, then merge with a meeting on time plus attendees or on link', {
      in: {
        source: t.enm('google', 'microsoft'), calendarId: calId, providerId: t.str(), deleted: t.opt(t.bool()), title: t.opt(t.str()), startsAt: t.opt(t.ts()), endsAt: t.opt(t.ts()),
        allDay: t.opt(t.bool()), location: t.opt(t.str()), joinUrl: t.opt(t.str()), organizer: t.opt(email), attendees: t.opt(t.arr(attendee)), description: t.opt(t.str()),
      },
      out: { eventId: cevId, meetingId: t.opt(id.record), merged: t.bool() }, emits: ['calendar_event.created', 'calendar_event.updated', 'calendar_event.deleted'], idem: 'natural',
    }),
    read('calendar.health', 'Calendar sync health: age of the last successful sync per calendar', { in: {}, out: healthOut }),
  ],
  health: [
    health('calendar.sync', 'Calendar sync', 'calendar.health', 'Open Settings, Connections and reconnect the Google or Microsoft calendar.', { pauses: ['sync'] }),
  ],
  screens: [
    screen('calendar.view', 'inbox', 'ui:Calendar', {
      q: {
        events: ['calendar.list_events', { from: '/state/from', to: '/state/to', calendarIds: '/state/calendarIds' }, true],
        calendars: ['calendar.list_calendars', {}, true],
        busy: ['calendar.availability', { people: '/state/people', from: '/state/from', to: '/state/to' }, true],
      },
      a: {
        create: ['calendar.create_event', { calendarId: '/state/calendarId', title: '/state/title', startsAt: '/state/startsAt', endsAt: '/state/endsAt', attendees: '/state/attendees' }],
        update: ['calendar.update_event', { eventId: '/state/eventId', startsAt: '/state/startsAt', endsAt: '/state/endsAt' }],
        delete: ['calendar.delete_event', { eventId: '/state/eventId' }],
        restore: ['calendar.restore_event', { eventId: '/state/eventId' }],
        findTime: ['calendar.find_time', { people: '/state/people', durationMinutes: '/state/durationMinutes', from: '/state/from', to: '/state/to' }],
        newCalendar: ['calendar.create_calendar', { title: '/state/title', color: '/state/color' }],
      },
      empty: 'No events in this range', primary: 'New event',
    }),
    screen('calendar.event-card', 'inbox', 'ui:EventCard', {
      slot: 'popover',
      q: { event: ['calendar.get_event', { eventId: '/state/eventId' }, true] },
      a: {
        respond: ['calendar.respond', { eventId: '/state/eventId', response: '/state/response' }],
        move: ['calendar.move_to_calendar', { eventId: '/state/eventId', calendarId: '/state/calendarId' }],
        duplicate: ['calendar.duplicate_event', { eventId: '/state/eventId' }],
        delete: ['calendar.delete_event', { eventId: '/state/eventId' }],
        link: ['calendar.link_record', { eventId: '/state/eventId', recordIds: '/state/recordIds' }],
      },
      empty: 'Event not found',
    }),
  ],
});
