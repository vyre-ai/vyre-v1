// One handler per calendar capability (all 20 live in events.ts: calendars, events, availability, Find a time, the provider pull and the health read).
export {
  availability, connectProvider, createCalendar, createEvent, deleteCalendar, deleteEvent, duplicateEvent, findTime, fromGoogle, fromGraph, getEvent, health, ingestEvent, linkRecord, listCalendars, listEvents,
  moveToCalendar, respond, restoreEvent, syncNow, updateCalendar, updateEvent,
} from "./events.ts";
