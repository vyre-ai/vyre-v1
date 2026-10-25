// calendar module entry (lane L5). The host serves the generated stubs while manifests/calendar.ts says `status: 'stub'`; the flip to live is a one-line edit to
// host/modules.json (ruling 25) once P-CI_02 has landed. The module keeps calendars and events; meetings keeps the Meeting an event with guests becomes, and the
// google and microsoft modules answer the pull that calendar.sync_now asks for.
import type { Handler } from "../../host/src/invoke.ts";
import * as h from "./handlers/index.ts";
import { codecs, consumers, inline } from "./projections.ts";

export const handlers: Record<string, Handler> = {
  "calendar.list_calendars": (ctx, i) => h.listCalendars(ctx, i),
  "calendar.create_calendar": (ctx, i) => h.createCalendar(ctx, i),
  "calendar.update_calendar": (ctx, i) => h.updateCalendar(ctx, i),
  "calendar.delete_calendar": (ctx, i) => h.deleteCalendar(ctx, i),
  "calendar.list_events": (ctx, i) => h.listEvents(ctx, i),
  "calendar.get_event": (ctx, i) => h.getEvent(ctx, i),
  "calendar.create_event": (ctx, i) => h.createEvent(ctx, i),
  "calendar.update_event": (ctx, i) => h.updateEvent(ctx, i),
  "calendar.delete_event": (ctx, i) => h.deleteEvent(ctx, i),
  "calendar.restore_event": (ctx, i) => h.restoreEvent(ctx, i),
  "calendar.duplicate_event": (ctx, i) => h.duplicateEvent(ctx, i),
  "calendar.move_to_calendar": (ctx, i) => h.moveToCalendar(ctx, i),
  "calendar.respond": (ctx, i) => h.respond(ctx, i),
  "calendar.link_record": (ctx, i) => h.linkRecord(ctx, i),
  "calendar.availability": (ctx, i) => h.availability(ctx, i),
  "calendar.find_time": (ctx, i) => h.findTime(ctx, i),
  "calendar.sync_now": (ctx, i) => h.syncNow(ctx, i),
  "calendar.ingest_event": (ctx, i) => h.ingestEvent(ctx, i),
  "calendar.health": (ctx) => h.health(ctx),
};

export const projections = { inline, consumers };
export { codecs, inline, consumers };
