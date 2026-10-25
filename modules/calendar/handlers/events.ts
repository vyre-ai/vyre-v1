// The calendar capabilities (spec 3.3 flow 4, 2.18 Calendar, 2.10 calendar sync): calendars, events, availability stripes, Find a time, the merge of an event with a
// meeting, and the provider pull. Calendar is a view in Inbox; its rows live here and nowhere else.
//
// DECISION: create, update, delete and respond are plain local writes. The provider sends invitations when the outbox syncs (the manifest says so); for agents,
// automations and campaigns the host holds the call at the Gate act `send` when the event has attendees, before these handlers run.
// DECISION: the 15 minute step belongs to the view and to Find a time. A drag in the Calendar view snaps to STEP_MS (snapToStep) before it calls create_event or
// update_event; the server stores the times it is given, because events that arrive from Google and Microsoft are not on the grid. Find a time answers on the grid.
// DECISION: a person is a member id (usr_) or an email address. A member's calendars are the ones they own; their addresses are those of their personal mailboxes
// (mail.mailbox.list). An address that no member owns is known only through events that list it as a guest. A person with neither is reported in `unknown`.
// DECISION: availability shows busy blocks of every calendar, whoever may read the event itself: only start and end leave this module. All-day events, cancelled
// events and events the person declined do not block time.
// DECISION: an event with at least one guest becomes (or joins) a Meeting through meetings.ingest, which merges on time plus guests or on the join link. A failure
// there never fails the event. Deleting an event leaves its Meeting alone: the Meeting may hold a recording.
// DECISION: Find a time uses the caller's own working hours and time zone (settings profile.working_hours, profile.timezone) when workingHoursOnly is not false;
// UTC, Monday to Friday, 09:00 to 17:00 when the settings cannot be read.
import {
  allow, bad, can, cleanAttendees, codeOf, DAY_MS, DEFAULT_HOURS, ensure, first, freeSlots, googleTime, graphTime, isId, list, mergeSpans, MINUTE_MS, missing,
  newId, normalizeEmail, num, obj, readAttendees, readStrings, refuse, rowsOf, str, strOrNull, text, toCalendar, toEvent, EMAIL,
} from "../projections.ts";
import type { Attendee, CalCtx, CalendarOut, EventOut, Hours, JoinProvider, Json, Response, Row, Span } from "../projections.ts";

const MAX_SPAN = 366 * DAY_MS;
const MAX_RANGE = 62 * DAY_MS;
const COLORS = ["#4f6bed", "#16a085", "#d35400", "#8e44ad", "#c0392b", "#2c3e50"];
const STALE_MS = 6 * 3_600_000;
const PULL_BEHIND = 30 * DAY_MS;
const PULL_AHEAD = 90 * DAY_MS;
const MAX_PAGES = 50;
const DEFAULT_LIMIT = 200;

// ---- who is calling, which rows they may touch

function personOf(ctx: CalCtx): string {
  const id = ctx.actingFor ?? ctx.principal.id;
  if (!isId("usr", id)) bad(ctx, "A calendar belongs to a person. Ask a person to do this, or act for one.");
  return id;
}

const ownerOnly = (ctx: CalCtx, row: Row): boolean => strOrNull(row, "ownerId") === (ctx.actingFor ?? ctx.principal.id);

function calendarRow(ctx: CalCtx, id: string, level: "view" | "use" | "edit" | "manage"): Row {
  if (!isId("cld", id)) bad(ctx, "That is not a calendar id.");
  const row = first(ctx.db.all(`SELECT * FROM calendar_list WHERE id = ? AND deleted_at IS NULL`, id)) ?? missing(ctx, "There is no such calendar.");
  if (ownerOnly(ctx, row)) return row;
  if (!can(ctx, level, { type: "calendar", id })) {
    if (level === "view") missing(ctx, "There is no such calendar.");   // a private calendar does not say it exists
    allow(ctx, level, { type: "calendar", id });
  }
  return row;
}

function canView(ctx: CalCtx, row: Row): boolean {
  return ownerOnly(ctx, row) || can(ctx, "view", { type: "calendar", id: str(row, "id") });
}

/** A live event the caller may see (and `level` on its calendar). */
function eventRow(ctx: CalCtx, id: string, level: "view" | "edit" = "view", deleted = false): Row {
  if (!isId("cev", id)) bad(ctx, "That is not an event id.");
  const row = first(ctx.db.all(`SELECT * FROM calendar_event WHERE id = ?`, id)) ?? missing(ctx, "There is no such event.");
  if ((num(row, "deleted_at") > 0) !== deleted) missing(ctx, deleted ? "That event is not deleted." : "There is no such event.");
  calendarRow(ctx, str(row, "calendarId"), level);
  return row;
}

// ---- input checks

function clean(ctx: CalCtx, value: unknown, what: string, max: number, required = false): string | undefined {
  if (value === undefined) {
    if (required) bad(ctx, `${what} is required.`);
    return undefined;
  }
  if (typeof value !== "string") bad(ctx, `${what} must be text.`);
  const v = value.trim();
  if (required && !v) bad(ctx, `${what} is required.`);
  if (v.length > max) bad(ctx, `${what} is at most ${max} characters.`);
  return v;
}

function checkTimes(ctx: CalCtx, startsAt: unknown, endsAt: unknown): { startsAt: number; endsAt: number } {
  if (!Number.isSafeInteger(startsAt) || !Number.isSafeInteger(endsAt) || (startsAt as number) < 0 || (endsAt as number) < 0) bad(ctx, "Times are milliseconds since the epoch.");
  const s = startsAt as number;
  const e = endsAt as number;
  if (e <= s) bad(ctx, "An event ends after it starts.");
  if (e - s > MAX_SPAN) bad(ctx, "An event is at most a year long.");
  return { startsAt: s, endsAt: e };
}

function checkRange(ctx: CalCtx, from: unknown, to: unknown): { startsAt: number; endsAt: number } {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || (from as number) < 0) bad(ctx, "Times are milliseconds since the epoch.");
  if ((to as number) <= (from as number)) bad(ctx, "The range ends after it starts.");
  return { startsAt: from as number, endsAt: to as number };
}

function checkJoin(ctx: CalCtx, value: unknown): JoinProvider {
  if (value === undefined) return "none";
  if (value !== "zoom" && value !== "meet" && value !== "teams" && value !== "none") bad(ctx, "The meeting link is zoom, meet, teams or none.");
  return value;
}

function checkRecords(ctx: CalCtx, value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) bad(ctx, "Records are a list of record ids.");
  const out: string[] = [];
  for (const id of value) {
    if (!isId("rec", id)) bad(ctx, "That is not a record id.");
    if (!out.includes(id)) out.push(id);
  }
  if (out.length > 100) bad(ctx, "An event links at most 100 records.");
  return out;
}

function checkId(ctx: CalCtx, prefix: string, value: unknown, what: string): string | undefined {
  if (value === undefined) return undefined;
  if (!isId(prefix, value)) bad(ctx, `${what} is not valid.`);
  return value;
}

// ---- calendars

export async function listCalendars(ctx: CalCtx, input: { scope?: "mine" | "shared" | "all" }): Promise<{ calendars: CalendarOut[] }> {
  ensure(ctx);
  const scope = input.scope ?? "all";
  if (scope !== "mine" && scope !== "shared" && scope !== "all") bad(ctx, "The scope is mine, shared or all.");
  const rows = rowsOf(ctx.db.all(`SELECT * FROM calendar_list WHERE deleted_at IS NULL`));
  const out = rows
    .filter((r) => (ownerOnly(ctx, r) ? scope !== "shared" : scope !== "mine" && canView(ctx, r)))
    .sort((a, b) => Number(ownerOnly(ctx, b)) - Number(ownerOnly(ctx, a)) || str(a, "title").localeCompare(str(b, "title")) || str(a, "id").localeCompare(str(b, "id")));
  return { calendars: out.map(toCalendar) };
}

export async function createCalendar(ctx: CalCtx, input: { title: string; color?: string; personal?: boolean }): Promise<{ calendar: CalendarOut }> {
  ensure(ctx);
  const owner = personOf(ctx);
  const title = clean(ctx, input.title, "The title", 100, true) ?? "";
  const color = input.color ?? COLORS[rowsOf(ctx.db.all(`SELECT id FROM calendar_list WHERE "ownerId" = ?`, owner)).length % COLORS.length] ?? "#4f6bed";
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) bad(ctx, "A colour is a hex value such as #4f6bed.");
  if (input.personal !== undefined && typeof input.personal !== "boolean") bad(ctx, "Personal is true or false.");
  const id = newId("cld", ctx.now());
  const personal = input.personal === true;
  ctx.db.run(
    `INSERT INTO calendar_list (id, title, color, provider, "connectionId", "remoteId", "ownerId", personal, state, version, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, title, color, "local", null, null, owner, personal ? 1 : 0, "syncing", 1, ctx.now(), null,
  );
  return { calendar: toCalendar(calendarRow(ctx, id, "view")) };
}

export async function updateCalendar(ctx: CalCtx, input: { calendarId: string; title?: string; color?: string }): Promise<{ calendar: CalendarOut }> {
  ensure(ctx);
  const row = calendarRow(ctx, input.calendarId, "edit");
  const title = clean(ctx, input.title, "The title", 100, false);
  if (title === "") bad(ctx, "The title is required.");
  if (input.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(input.color)) bad(ctx, "A colour is a hex value such as #4f6bed.");
  if (title === undefined && input.color === undefined) bad(ctx, "Give a new title or colour.");
  ctx.db.run(`UPDATE calendar_list SET title = ?, color = ?, version = ?, updated_at = ? WHERE id = ?`, title ?? str(row, "title"), input.color ?? str(row, "color"), num(row, "version") + 1, ctx.now(), input.calendarId);
  return { calendar: toCalendar(calendarRow(ctx, input.calendarId, "view")) };
}

export async function deleteCalendar(ctx: CalCtx, input: { calendarId: string }): Promise<{ deleted: boolean }> {
  ensure(ctx);
  const row = calendarRow(ctx, input.calendarId, "manage");
  if (str(row, "provider") !== "local") refuse(ctx, "A Google or Microsoft calendar is disconnected in Settings, Connections, not deleted here.");
  const now = ctx.now();
  for (const e of rowsOf(ctx.db.all(`SELECT * FROM calendar_event WHERE "calendarId" = ? AND deleted_at IS NULL`, input.calendarId))) {
    ctx.db.run(`UPDATE calendar_event SET "deletedAt" = ?, deleted_at = ?, version = ?, updated_at = ? WHERE id = ?`, now, now, num(e, "version") + 1, now, str(e, "id"));
    ctx.emit("calendar_event.deleted", `entity/${str(e, "id")}`, { eventId: str(e, "id"), calendarId: input.calendarId });
  }
  ctx.db.run(`UPDATE calendar_list SET deleted_at = ?, version = ?, updated_at = ? WHERE id = ?`, now, num(row, "version") + 1, now, input.calendarId);
  return { deleted: true };
}

// ---- reading events

export async function listEvents(
  ctx: CalCtx, input: { from: number; to: number; calendarIds?: string[]; query?: string; cursor?: string; limit?: number },
): Promise<{ events: EventOut[]; next?: string; total: number }> {
  ensure(ctx);
  const { startsAt: from, endsAt: to } = checkRange(ctx, input.from, input.to);
  if (to - from > MAX_RANGE) bad(ctx, "Ask for at most two months at a time.");
  const limit = input.limit ?? DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) bad(ctx, "The limit is 1 to 500.");
  const offset = input.cursor === undefined ? 0 : Number(input.cursor);
  if (!Number.isSafeInteger(offset) || offset < 0) bad(ctx, "That cursor is not one this list gave.");
  if (input.query !== undefined && typeof input.query !== "string") bad(ctx, "Search text must be text.");
  let calendars: Row[];
  if (input.calendarIds) {
    if (!Array.isArray(input.calendarIds)) bad(ctx, "Calendars are a list of calendar ids.");
    calendars = [...new Set(input.calendarIds)].map((id) => calendarRow(ctx, id, "view"));
  } else {
    calendars = rowsOf(ctx.db.all(`SELECT * FROM calendar_list WHERE deleted_at IS NULL`)).filter((r) => canView(ctx, r));
  }
  const q = input.query?.trim().toLowerCase();
  const found: Row[] = [];
  for (const c of calendars) {
    for (const e of rowsOf(ctx.db.all(`SELECT * FROM calendar_event WHERE "calendarId" = ? AND "startsAt" < ? AND "endsAt" > ? AND deleted_at IS NULL`, str(c, "id"), to, from))) {
      if (q && ![str(e, "title"), str(e, "location"), str(e, "description")].some((s) => s.toLowerCase().includes(q))) continue;
      found.push(e);
    }
  }
  found.sort((a, b) => num(a, "startsAt") - num(b, "startsAt") || num(a, "endsAt") - num(b, "endsAt") || str(a, "id").localeCompare(str(b, "id")));
  const page = found.slice(offset, offset + limit).map(toEvent);
  const end = offset + page.length;
  return end < found.length ? { events: page, next: String(end), total: found.length } : { events: page, total: found.length };
}

export async function getEvent(ctx: CalCtx, input: { eventId: string }): Promise<{ event: EventOut }> {
  ensure(ctx);
  return { event: toEvent(eventRow(ctx, input.eventId)) };
}

// ---- writing events

interface NewEvent {
  calendarId: string;
  title: string;
  startsAt: number;
  endsAt: number;
  allDay: boolean;
  location: string | null;
  joinUrl: string | null;
  joinProvider: JoinProvider;
  description: string | null;
  agenda: string | null;
  attendees: Attendee[];
  organizer: string | null;
  recordIds: string[];
  meetingId: string | null;
  providerId: string | null;
  status: "confirmed" | "tentative" | "canceled";
  bookedByAgentId: string | null;
  fromBookingPage: string | null;
}

function insertEvent(ctx: CalCtx, e: NewEvent): string {
  const id = newId("cev", ctx.now());
  ctx.db.run(
    `INSERT INTO calendar_event (id, "calendarId", title, "startsAt", "endsAt", "allDay", location, "joinUrl", "joinProvider", description, agenda, attendees, organizer, "recordIds", "meetingId", "providerId", status, "bookedByAgentId", "fromBookingPage", "deletedAt", version, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, e.calendarId, e.title, e.startsAt, e.endsAt, e.allDay ? 1 : 0, e.location, e.joinUrl, e.joinProvider, e.description, e.agenda, JSON.stringify(e.attendees), e.organizer,
    JSON.stringify(e.recordIds), e.meetingId, e.providerId, e.status, e.bookedByAgentId, e.fromBookingPage, null, 1, ctx.now(), null,
  );
  return id;
}

function created(ctx: CalCtx, id: string, calendarId: string, startsAt: number, attendeeCount: number, source: "vyre" | "google" | "microsoft" | "booking"): void {
  ctx.emit("calendar_event.created", `entity/${id}`, { eventId: id, calendarId, startsAt, attendeeCount, source });
}

export async function createEvent(
  ctx: CalCtx,
  input: {
    calendarId: string; title: string; startsAt: number; endsAt: number; allDay?: boolean; location?: string; description?: string; agenda?: string; attendees?: unknown[];
    recordIds?: string[]; joinProvider?: JoinProvider; bookedByAgentId?: string; fromBookingPage?: string;
  },
): Promise<{ event: EventOut }> {
  ensure(ctx);
  calendarRow(ctx, input.calendarId, "edit");
  const title = clean(ctx, input.title, "The title", 500, true) ?? "";
  const { startsAt, endsAt } = checkTimes(ctx, input.startsAt, input.endsAt);
  if (input.allDay !== undefined && typeof input.allDay !== "boolean") bad(ctx, "All day is true or false.");
  const bookedBy = checkId(ctx, "agt", input.bookedByAgentId, "The agent");
  const booking = checkId(ctx, "frm", input.fromBookingPage, "The booking page");
  const attendees = input.attendees === undefined ? [] : cleanAttendees(ctx, input.attendees);
  const row: NewEvent = {
    calendarId: input.calendarId, title, startsAt, endsAt, allDay: input.allDay === true, location: clean(ctx, input.location, "The location", 500) || null,
    joinUrl: null, joinProvider: checkJoin(ctx, input.joinProvider), description: clean(ctx, input.description, "The description", 20_000) || null,
    agenda: clean(ctx, input.agenda, "The agenda", 20_000) || null, attendees, organizer: null, recordIds: checkRecords(ctx, input.recordIds), meetingId: null, providerId: null,
    status: "confirmed", bookedByAgentId: bookedBy ?? null, fromBookingPage: booking ?? null,
  };
  const id = insertEvent(ctx, row);
  created(ctx, id, input.calendarId, startsAt, attendees.length, booking ? "booking" : "vyre");
  await joinMeeting(ctx, id);
  return { event: toEvent(eventRow(ctx, id)) };
}

/** The fields a Meeting copies from its event: a change to one of them is sent on to meetings.ingest. */
const MEETING_FIELDS = new Set(["title", "startsAt", "endsAt", "allDay", "attendees", "joinProvider"]);

export async function updateEvent(
  ctx: CalCtx,
  input: {
    eventId: string; title?: string; startsAt?: number; endsAt?: number; allDay?: boolean; location?: string; description?: string; agenda?: string; attendees?: unknown[];
    joinProvider?: JoinProvider;
  },
): Promise<{ event: EventOut }> {
  ensure(ctx);
  const row = eventRow(ctx, input.eventId, "edit");
  const set = new Map<string, string | number | null>();
  const changed: string[] = [];
  const put = (field: string, value: string | number | null, have: string | number | null): void => {
    if (value === have) return;
    set.set(field, value);
    changed.push(field);
  };
  if (input.title !== undefined) put("title", clean(ctx, input.title, "The title", 500, true) ?? "", str(row, "title"));
  if (input.startsAt !== undefined || input.endsAt !== undefined) {
    const t = checkTimes(ctx, input.startsAt ?? num(row, "startsAt"), input.endsAt ?? num(row, "endsAt"));
    put("startsAt", t.startsAt, num(row, "startsAt"));
    put("endsAt", t.endsAt, num(row, "endsAt"));
  }
  if (input.allDay !== undefined) {
    if (typeof input.allDay !== "boolean") bad(ctx, "All day is true or false.");
    put("allDay", input.allDay ? 1 : 0, num(row, "allDay"));
  }
  if (input.location !== undefined) put("location", clean(ctx, input.location, "The location", 500) || null, strOrNull(row, "location"));
  if (input.description !== undefined) put("description", clean(ctx, input.description, "The description", 20_000) || null, strOrNull(row, "description"));
  if (input.agenda !== undefined) put("agenda", clean(ctx, input.agenda, "The agenda", 20_000) || null, strOrNull(row, "agenda"));
  if (input.joinProvider !== undefined) put("joinProvider", checkJoin(ctx, input.joinProvider), str(row, "joinProvider") || "none");
  if (input.attendees !== undefined) {
    const next = JSON.stringify(cleanAttendees(ctx, input.attendees, readAttendees(row.attendees)));
    put("attendees", next, JSON.stringify(readAttendees(row.attendees)));
  }
  if (!changed.length) return { event: toEvent(row) };
  const names = [...set.keys()];
  ctx.db.run(`UPDATE calendar_event SET ${names.map((n) => `${quoted(n)} = ?`).join(", ")}, version = ?, updated_at = ? WHERE id = ?`, ...names.map((n) => set.get(n) ?? null), num(row, "version") + 1, ctx.now(), input.eventId);
  ctx.emit("calendar_event.updated", `entity/${input.eventId}`, { eventId: input.eventId, calendarId: str(row, "calendarId"), fields: changed });
  if (changed.some((f) => MEETING_FIELDS.has(f))) await joinMeeting(ctx, input.eventId);
  return { event: toEvent(eventRow(ctx, input.eventId)) };
}

/** Column names that are not plain lower-case words are quoted, as the generated schema spells them. */
const quoted = (name: string): string => (/^[a-z]+$/.test(name) ? name : `"${name}"`);

export async function deleteEvent(ctx: CalCtx, input: { eventId: string }): Promise<{ deleted: boolean }> {
  ensure(ctx);
  if (!isId("cev", input.eventId)) bad(ctx, "That is not an event id.");
  const row = first(ctx.db.all(`SELECT * FROM calendar_event WHERE id = ?`, input.eventId)) ?? missing(ctx, "There is no such event.");
  calendarRow(ctx, str(row, "calendarId"), "edit");
  if (num(row, "deleted_at") > 0) return { deleted: true };   // Delete twice is one delete
  const now = ctx.now();
  ctx.db.run(`UPDATE calendar_event SET "deletedAt" = ?, deleted_at = ?, version = ?, updated_at = ? WHERE id = ?`, now, now, num(row, "version") + 1, now, input.eventId);
  ctx.emit("calendar_event.deleted", `entity/${input.eventId}`, { eventId: input.eventId, calendarId: str(row, "calendarId") });
  return { deleted: true };
}

export async function restoreEvent(ctx: CalCtx, input: { eventId: string }): Promise<{ event: EventOut }> {
  ensure(ctx);
  if (!isId("cev", input.eventId)) bad(ctx, "That is not an event id.");
  const row = first(ctx.db.all(`SELECT * FROM calendar_event WHERE id = ?`, input.eventId)) ?? missing(ctx, "There is no such event.");
  calendarRow(ctx, str(row, "calendarId"), "edit");
  if (num(row, "deleted_at") > 0) {
    ctx.db.run(`UPDATE calendar_event SET "deletedAt" = ?, deleted_at = ?, version = ?, updated_at = ? WHERE id = ?`, null, null, num(row, "version") + 1, ctx.now(), input.eventId);
    ctx.emit("calendar_event.restored", `entity/${input.eventId}`, { eventId: input.eventId, calendarId: str(row, "calendarId") });
  }
  return { event: toEvent(eventRow(ctx, input.eventId)) };
}

export async function duplicateEvent(ctx: CalCtx, input: { eventId: string; startsAt?: number }): Promise<{ event: EventOut }> {
  ensure(ctx);
  const row = eventRow(ctx, input.eventId, "edit");
  const length = num(row, "endsAt") - num(row, "startsAt");
  let startsAt = num(row, "startsAt");
  if (input.startsAt !== undefined) {
    if (!Number.isSafeInteger(input.startsAt) || input.startsAt < 0) bad(ctx, "Times are milliseconds since the epoch.");
    startsAt = input.startsAt;
  }
  const attendees = readAttendees(row.attendees).map((a) => ({ ...a, response: "needs_action" as Response }));
  const id = insertEvent(ctx, {
    calendarId: str(row, "calendarId"), title: str(row, "title"), startsAt, endsAt: startsAt + length, allDay: num(row, "allDay") === 1, location: strOrNull(row, "location"), joinUrl: null,
    joinProvider: toEvent(row).joinProvider, description: strOrNull(row, "description"), agenda: strOrNull(row, "agenda"), attendees, organizer: null, recordIds: readStrings(row.recordIds),
    meetingId: null, providerId: null, status: "confirmed", bookedByAgentId: null, fromBookingPage: null,
  });
  created(ctx, id, str(row, "calendarId"), startsAt, attendees.length, "vyre");
  await joinMeeting(ctx, id);
  return { event: toEvent(eventRow(ctx, id)) };
}

export async function moveToCalendar(ctx: CalCtx, input: { eventId: string; calendarId: string }): Promise<{ event: EventOut }> {
  ensure(ctx);
  const row = eventRow(ctx, input.eventId, "edit");
  const target = calendarRow(ctx, input.calendarId, "edit");
  if (str(row, "calendarId") === input.calendarId) return { event: toEvent(row) };
  // The provider knows the event under the old calendar; on the new one it is a new event, so the old provider id goes.
  ctx.db.run(`UPDATE calendar_event SET "calendarId" = ?, "providerId" = ?, version = ?, updated_at = ? WHERE id = ?`, str(target, "id"), null, num(row, "version") + 1, ctx.now(), input.eventId);
  ctx.emit("calendar_event.updated", `entity/${input.eventId}`, { eventId: input.eventId, calendarId: input.calendarId, fields: ["calendarId"] });
  return { event: toEvent(eventRow(ctx, input.eventId)) };
}

export async function respond(ctx: CalCtx, input: { eventId: string; response: "accepted" | "declined" | "tentative"; comment?: string }): Promise<{ event: EventOut }> {
  ensure(ctx);
  const row = eventRow(ctx, input.eventId, "view");
  if (input.response !== "accepted" && input.response !== "declined" && input.response !== "tentative") bad(ctx, "Answer accepted, declined or tentative.");
  if (input.comment !== undefined && typeof input.comment !== "string") bad(ctx, "The comment must be text.");
  const mine = new Set((await addressesOf(ctx)).filter((a) => a.owner === personOf(ctx)).map((a) => a.address));
  const attendees = readAttendees(row.attendees);
  const at = attendees.findIndex((a) => mine.has(normalizeEmail(a.email)));
  if (at < 0) refuse(ctx, "You are not on this event's guest list, so there is no invitation to answer.");
  const guest = attendees[at] as Attendee;
  if (guest.response !== input.response) {
    attendees[at] = { ...guest, response: input.response };
    ctx.db.run(`UPDATE calendar_event SET attendees = ?, version = ?, updated_at = ? WHERE id = ?`, JSON.stringify(attendees), num(row, "version") + 1, ctx.now(), input.eventId);
    ctx.emit("calendar_event.response_changed", `entity/${input.eventId}`, { eventId: input.eventId, email: normalizeEmail(guest.email), response: input.response });
  }
  return { event: toEvent(eventRow(ctx, input.eventId)) };
}

export async function linkRecord(ctx: CalCtx, input: { eventId: string; recordIds: string[]; unlink?: boolean }): Promise<{ event: EventOut }> {
  ensure(ctx);
  const row = eventRow(ctx, input.eventId, "edit");
  const ids = checkRecords(ctx, input.recordIds);
  if (!ids.length) bad(ctx, "Give at least one record.");
  const have = readStrings(row.recordIds);
  const next = input.unlink === true ? have.filter((id) => !ids.includes(id)) : [...have, ...ids.filter((id) => !have.includes(id))];
  if (next.length > 100) bad(ctx, "An event links at most 100 records.");
  if (JSON.stringify(next) !== JSON.stringify(have)) {
    ctx.db.run(`UPDATE calendar_event SET "recordIds" = ?, version = ?, updated_at = ? WHERE id = ?`, JSON.stringify(next), num(row, "version") + 1, ctx.now(), input.eventId);
    ctx.emit("calendar_event.updated", `entity/${input.eventId}`, { eventId: input.eventId, calendarId: str(row, "calendarId"), fields: ["recordIds"] });
  }
  return { event: toEvent(eventRow(ctx, input.eventId)) };
}

// ---- the merge with meetings

/** Make the event a Meeting, or join the one that already describes this call. An event with no guests is a block of time, not a meeting. */
async function joinMeeting(ctx: CalCtx, eventId: string): Promise<{ meetingId?: string; merged: boolean }> {
  const row = first(ctx.db.all(`SELECT * FROM calendar_event WHERE id = ?`, eventId));
  if (!row) return { merged: false };
  const ev = toEvent(row);
  const known = ev.meetingId;
  if (ev.status === "canceled" || ev.allDay || !ev.attendees.length || num(row, "deleted_at") > 0) return known ? { meetingId: known, merged: false } : { merged: false };
  const body: Json = {
    source: "calendar", providerRef: strOrNull(row, "providerId") ?? eventId, calendarEventId: eventId, title: ev.title, startsAt: ev.startsAt, endsAt: ev.endsAt,
    attendees: ev.attendees.map((a) => ({ email: a.email, ...(a.name ? { name: a.name } : {}), ...(a.contactId ? { contactId: a.contactId } : {}) })),
  };
  if (ev.joinUrl) body.joinUrl = ev.joinUrl;
  try {
    const res = obj(await ctx.call("meetings.ingest", body));
    const meetingId = text(res.meetingId);
    if (meetingId && meetingId !== known) ctx.db.run(`UPDATE calendar_event SET "meetingId" = ?, version = ?, updated_at = ? WHERE id = ?`, meetingId, num(row, "version") + 1, ctx.now(), eventId);
    return meetingId ? { meetingId, merged: res.merged === true } : { merged: false };
  } catch (e) {
    ctx.log.warn("calendar: could not join the event to a meeting", { code: codeOf(e) });
    return known ? { meetingId: known, merged: false } : { merged: false };
  }
}

// ---- people, availability and Find a time

interface Address { owner: string; address: string }

/** Every member's personal mailbox address: the way to go from a member to an email and back. A mail module that is down gives an empty answer. */
async function addressesOf(ctx: CalCtx): Promise<Address[]> {
  try {
    const res = obj(await ctx.call("mail.mailbox.list", { scope: "all", kind: "personal", limit: 500 }));
    const out: Address[] = [];
    for (const m of list(res.mailboxes).map(obj)) {
      const owner = text(m.ownerId);
      const address = normalizeEmail(text(m.address));
      if (owner && EMAIL.test(address)) out.push({ owner, address });
    }
    return out;
  } catch (e) {
    ctx.log.warn("calendar: could not read member addresses", { code: codeOf(e) });
    return [];
  }
}

interface Busy { who: string; startsAt: number; endsAt: number }

async function busyOf(ctx: CalCtx, people: unknown, from: number, to: number): Promise<{ busy: Busy[]; unknown: string[] }> {
  if (!Array.isArray(people) || people.length < 1 || people.length > 50) bad(ctx, "Ask about 1 to 50 people.");
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || to <= from) bad(ctx, "The range ends after it starts.");
  if (to - from > MAX_RANGE) bad(ctx, "Ask for at most two months at a time.");
  const who = [...new Set(people)].map((p) => {
    if (typeof p !== "string") bad(ctx, "A person is a member id or an email address.");
    return p.trim();
  });
  const addresses = await addressesOf(ctx);
  const events = rowsOf(ctx.db.all(`SELECT * FROM calendar_event WHERE "startsAt" < ? AND "endsAt" > ? AND deleted_at IS NULL`, to, from))
    .filter((e) => num(e, "allDay") !== 1 && str(e, "status") !== "canceled");
  const calendars = rowsOf(ctx.db.all(`SELECT id, "ownerId" FROM calendar_list WHERE deleted_at IS NULL`));
  const busy: Busy[] = [];
  const unknown: string[] = [];
  for (const p of who) {
    let owner: string | undefined;
    const mails = new Set<string>();
    if (isId("usr", p)) {
      owner = p;
      for (const a of addresses) if (a.owner === p) mails.add(a.address);
    } else if (EMAIL.test(p)) {
      const email = normalizeEmail(p);
      mails.add(email);
      owner = addresses.find((a) => a.address === email)?.owner;
      if (owner) for (const a of addresses) if (a.owner === owner) mails.add(a.address);
    } else {
      bad(ctx, "A person is a member id or an email address.");
    }
    const own = new Set(calendars.filter((c) => owner && str(c, "ownerId") === owner).map((c) => str(c, "id")));
    let known = own.size > 0;
    const spans: Span[] = [];
    for (const e of events) {
      const guest = readAttendees(e.attendees).find((a) => mails.has(normalizeEmail(a.email)));
      const onOwn = own.has(str(e, "calendarId"));
      if (!guest && !onOwn) continue;
      known = true;
      if (guest?.response === "declined") continue;
      spans.push({ s: Math.max(num(e, "startsAt"), from), e: Math.min(num(e, "endsAt"), to) });
    }
    if (!known) unknown.push(p);
    for (const s of mergeSpans(spans)) busy.push({ who: p, startsAt: s.s, endsAt: s.e });
  }
  return { busy, unknown };
}

export async function availability(ctx: CalCtx, input: { people: string[]; from: number; to: number }): Promise<{ busy: Busy[]; unknown: string[] }> {
  ensure(ctx);
  return busyOf(ctx, input.people, input.from, input.to);
}

/** The caller's working hours and time zone from their settings; the default week when the settings cannot be read. */
async function hoursOf(ctx: CalCtx): Promise<Hours> {
  const hours: Hours = { ...DEFAULT_HOURS, days: [...DEFAULT_HOURS.days] };
  const read = async (key: string): Promise<unknown> => {
    try {
      return obj(obj(await ctx.call("settings.get", { key })).row).value;
    } catch (e) {
      ctx.log.warn("calendar: could not read a setting", { key, code: codeOf(e) });
      return undefined;
    }
  };
  const wh = obj(await read("profile.working_hours"));
  const days = list(wh.days).filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6);
  if (days.length) hours.days = days;
  if (/^[0-2]\d:[0-5]\d$/.test(text(wh.from))) hours.from = text(wh.from);
  if (/^[0-2]\d:[0-5]\d$/.test(text(wh.to))) hours.to = text(wh.to);
  const tz = await read("profile.timezone");
  if (typeof tz === "string" && tz) hours.timeZone = tz;
  return hours;
}

export async function findTime(
  ctx: CalCtx, input: { people: string[]; durationMinutes: number; from: number; to: number; workingHoursOnly?: boolean; limit?: number },
): Promise<{ slots: { startsAt: number; endsAt: number }[] }> {
  ensure(ctx);
  if (!Number.isSafeInteger(input.durationMinutes) || input.durationMinutes < 5 || input.durationMinutes > 600) bad(ctx, "A meeting is 5 to 600 minutes long.");
  const limit = input.limit ?? 5;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) bad(ctx, "The limit is 1 to 20.");
  if (input.workingHoursOnly !== undefined && typeof input.workingHoursOnly !== "boolean") bad(ctx, "Working hours only is true or false.");
  const { busy } = await busyOf(ctx, input.people, input.from, input.to);
  const hours = input.workingHoursOnly === false ? null : await hoursOf(ctx);
  const slots = freeSlots(mergeSpans(busy.map((b) => ({ s: b.startsAt, e: b.endsAt }))), input.from, input.to, input.durationMinutes * MINUTE_MS, limit, hours);
  return { slots: slots.map((s) => ({ startsAt: s.s, endsAt: s.e })) };
}

// ---- provider events

export interface IngestIn {
  source: "google" | "microsoft";
  calendarId: string;
  providerId: string;
  deleted?: boolean;
  title?: string;
  startsAt?: number;
  endsAt?: number;
  allDay?: boolean;
  location?: string;
  joinUrl?: string;
  organizer?: string;
  attendees?: unknown[];
  description?: string;
}

/** Land one provider event: upsert by provider id, then merge with a meeting on time plus guests or on the join link. */
export async function ingestEvent(ctx: CalCtx, input: IngestIn): Promise<{ eventId: string; meetingId?: string; merged: boolean }> {
  ensure(ctx);
  if (input.source !== "google" && input.source !== "microsoft") bad(ctx, "The source is google or microsoft.");
  if (!isId("cld", input.calendarId)) bad(ctx, "That is not a calendar id.");
  const providerId = clean(ctx, input.providerId, "The provider id", 1000, true) ?? "";
  if (!first(ctx.db.all(`SELECT id FROM calendar_list WHERE id = ? AND deleted_at IS NULL`, input.calendarId))) missing(ctx, "There is no such calendar.");
  const have = first(ctx.db.all(`SELECT * FROM calendar_event WHERE "calendarId" = ? AND "providerId" = ?`, input.calendarId, providerId));
  const now = ctx.now();
  if (input.deleted === true) {
    if (!have) {
      // Nothing to remove, but the provider told us: keep a deleted row so the same notice lands on the same event id.
      const id = insertEvent(ctx, blank(input.calendarId, providerId));
      ctx.db.run(`UPDATE calendar_event SET "deletedAt" = ?, deleted_at = ? WHERE id = ?`, now, now, id);
      return { eventId: id, merged: false };
    }
    if (num(have, "deleted_at") === 0) {
      ctx.db.run(`UPDATE calendar_event SET "deletedAt" = ?, deleted_at = ?, version = ?, updated_at = ? WHERE id = ?`, now, now, num(have, "version") + 1, now, str(have, "id"));
      ctx.emit("calendar_event.deleted", `entity/${str(have, "id")}`, { eventId: str(have, "id"), calendarId: input.calendarId });
    }
    return { eventId: str(have, "id"), ...(strOrNull(have, "meetingId") ? { meetingId: str(have, "meetingId") } : {}), merged: false };
  }
  const title = input.title === undefined ? undefined : (clean(ctx, input.title, "The title", 500) ?? "") || "(No title)";
  const times = input.startsAt !== undefined || input.endsAt !== undefined || !have ? checkTimes(ctx, input.startsAt ?? (have ? num(have, "startsAt") : undefined), input.endsAt ?? (have ? num(have, "endsAt") : undefined)) : undefined;
  const organizer = typeof input.organizer === "string" && EMAIL.test(normalizeEmail(input.organizer)) ? normalizeEmail(input.organizer) : undefined;
  const attendees = input.attendees === undefined ? undefined : cleanAttendees(ctx, input.attendees, have ? readAttendees(have.attendees) : []);
  let eventId: string;
  // An event the person deleted here stays deleted: their delete is on its way to the provider, and a pull that still shows it must not bring it back.
  if (have && num(have, "deleted_at") > 0) return { eventId: str(have, "id"), merged: false };
  if (!have) {
    eventId = insertEvent(ctx, {
      ...blank(input.calendarId, providerId), title: title ?? "(No title)", startsAt: times?.startsAt ?? 0, endsAt: times?.endsAt ?? 0, allDay: input.allDay === true,
      location: clean(ctx, input.location, "The location", 500) || null, joinUrl: clean(ctx, input.joinUrl, "The join link", 2000) || null,
      description: clean(ctx, input.description, "The description", 20_000) || null, attendees: attendees ?? [], organizer: organizer ?? null,
      joinProvider: joinKind(input.joinUrl, input.source),
    });
    created(ctx, eventId, input.calendarId, times?.startsAt ?? 0, (attendees ?? []).length, input.source);
  } else {
    eventId = str(have, "id");
    const set = new Map<string, string | number | null>();
    const changed: string[] = [];
    const put = (field: string, value: string | number | null, was: string | number | null): void => {
      if (value === was) return;
      set.set(field, value);
      changed.push(field);
    };
    if (title !== undefined) put("title", title, str(have, "title"));
    if (times) {
      put("startsAt", times.startsAt, num(have, "startsAt"));
      put("endsAt", times.endsAt, num(have, "endsAt"));
    }
    if (input.allDay !== undefined) put("allDay", input.allDay ? 1 : 0, num(have, "allDay"));
    if (input.location !== undefined) put("location", clean(ctx, input.location, "The location", 500) || null, strOrNull(have, "location"));
    if (input.joinUrl !== undefined) {
      put("joinUrl", clean(ctx, input.joinUrl, "The join link", 2000) || null, strOrNull(have, "joinUrl"));
      put("joinProvider", joinKind(input.joinUrl, input.source), str(have, "joinProvider") || "none");
    }
    if (input.description !== undefined) put("description", clean(ctx, input.description, "The description", 20_000) || null, strOrNull(have, "description"));
    if (organizer !== undefined) put("organizer", organizer, strOrNull(have, "organizer"));
    if (attendees !== undefined) put("attendees", JSON.stringify(attendees), JSON.stringify(readAttendees(have.attendees)));
    if (set.size) {
      const names = [...set.keys()];
      ctx.db.run(`UPDATE calendar_event SET ${names.map((n) => `${quoted(n)} = ?`).join(", ")}, version = ?, updated_at = ? WHERE id = ?`, ...names.map((n) => set.get(n) ?? null), num(have, "version") + 1, now, eventId);
    }
    if (changed.length) ctx.emit("calendar_event.updated", `entity/${eventId}`, { eventId, calendarId: input.calendarId, fields: changed });
  }
  const meeting = await joinMeeting(ctx, eventId);
  return { eventId, ...(meeting.meetingId ? { meetingId: meeting.meetingId } : {}), merged: meeting.merged };
}

function blank(calendarId: string, providerId: string): NewEvent {
  return {
    calendarId, title: "(No title)", startsAt: 0, endsAt: 0, allDay: false, location: null, joinUrl: null, joinProvider: "none", description: null, agenda: null, attendees: [],
    organizer: null, recordIds: [], meetingId: null, providerId, status: "confirmed", bookedByAgentId: null, fromBookingPage: null,
  };
}

/** The kind of conference a join link belongs to. */
function joinKind(link: string | undefined, source: "google" | "microsoft"): JoinProvider {
  if (!link) return "none";
  const host = (() => {
    try {
      return new URL(link).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (host.endsWith("zoom.us") || host.endsWith("zoom.com")) return "zoom";
  if (host === "meet.google.com") return "meet";
  if (host.endsWith("teams.microsoft.com") || host.endsWith("teams.live.com")) return "teams";
  return source === "google" ? "meet" : "teams";
}

// ---- provider pull (calendar.sync_now)

const GOOGLE_RESPONSE: Record<string, Response> = { accepted: "accepted", declined: "declined", tentative: "tentative", needsAction: "needs_action" };
const GRAPH_RESPONSE: Record<string, Response> = { accepted: "accepted", organizer: "accepted", declined: "declined", tentativelyAccepted: "tentative", notResponded: "needs_action", none: "needs_action" };

/** A Google Calendar event as the ingest input, or null when it has no usable id or times. */
export function fromGoogle(calendarId: string, e: Json): IngestIn | null {
  const providerId = text(e.id);
  if (!providerId) return null;
  const base: IngestIn = { source: "google", calendarId, providerId };
  if (text(e.status) === "cancelled") return { ...base, deleted: true };
  const s = googleTime(e.start);
  const en = googleTime(e.end);
  if (!s || !en) return null;
  const out: IngestIn = { ...base, title: text(e.summary) || "(No title)", startsAt: s.ts, endsAt: en.ts, allDay: s.allDay };
  if (text(e.location)) out.location = text(e.location);
  if (text(e.hangoutLink)) out.joinUrl = text(e.hangoutLink);
  const organizer = text(obj(e.organizer).email);
  if (organizer) out.organizer = organizer;
  if (Array.isArray(e.attendees)) {
    out.attendees = e.attendees.map(obj).filter((a) => text(a.email)).map((a) => ({
      email: text(a.email), response: GOOGLE_RESPONSE[text(a.responseStatus)] ?? "needs_action", ...(a.optional === true ? { optional: true } : {}),
    }));
  }
  return out;
}

/** A Graph event as the ingest input, or null when it has no usable id or times. */
export function fromGraph(calendarId: string, e: Json): IngestIn | null {
  const providerId = text(e.id);
  if (!providerId) return null;
  const base: IngestIn = { source: "microsoft", calendarId, providerId };
  if (e.isCancelled === true) return { ...base, deleted: true };
  const s = graphTime(e.start);
  const en = graphTime(e.end);
  if (s === undefined || en === undefined) return null;
  const out: IngestIn = { ...base, title: text(e.subject) || "(No title)", startsAt: s, endsAt: en };
  const location = text(obj(e.location).displayName);
  if (location) out.location = location;
  const join = text(obj(e.onlineMeeting).joinUrl);
  if (join) out.joinUrl = join;
  const organizer = text(obj(obj(e.organizer).emailAddress).address) || text(obj(e.organizer).email);
  if (organizer) out.organizer = organizer;
  if (Array.isArray(e.attendees)) {
    out.attendees = e.attendees.map(obj).filter((a) => text(a.email)).map((a) => ({
      email: text(a.email), response: GRAPH_RESPONSE[text(a.response)] ?? "needs_action", ...(text(a.type) === "optional" ? { optional: true } : {}),
    }));
  }
  return out;
}

interface Pulled { upserted: number; removed: number; cursor: string | null }

export async function syncNow(ctx: CalCtx, input: { calendarId: string }): Promise<{ runId: string }> {
  ensure(ctx);
  const cal = calendarRow(ctx, input.calendarId, "use");
  const runId = ctx.run && isId("run", ctx.run) ? ctx.run : newId("run", ctx.now());
  const provider = str(cal, "provider");
  const now = ctx.now();
  if (provider === "local") {
    ctx.emit("calendar.synced", `entity/${input.calendarId}`, { calendarId: input.calendarId, upserted: 0, removed: 0 }, { vis: "participants" });
    return { runId };
  }
  if (str(cal, "state") === "paused") return { runId };   // paused means paused: no pull, no failure
  const connectionId = strOrNull(cal, "connectionId");
  const remoteId = strOrNull(cal, "remoteId");
  const sync = first(ctx.db.all(`SELECT * FROM calendar_sync WHERE "calendarId" = ?`, input.calendarId));
  if (!sync) ctx.db.run(`INSERT INTO calendar_sync ("calendarId", cursor, "lastTryAt", "lastOkAt", "lastError") VALUES (?, ?, ?, ?, ?)`, input.calendarId, null, now, null, null);
  ctx.db.run(`UPDATE calendar_sync SET "lastTryAt" = ? WHERE "calendarId" = ?`, now, input.calendarId);
  try {
    if (!connectionId || !remoteId) refuse(ctx, "This calendar has no connection to pull from. Reconnect it in Settings, Connections.");
    const cursor = strOrNull(sync, "cursor");
    const pulled = provider === "google" ? await pullGoogle(ctx, input.calendarId, connectionId, remoteId, cursor) : await pullGraph(ctx, input.calendarId, connectionId, remoteId, cursor);
    ctx.db.run(`UPDATE calendar_sync SET cursor = ?, "lastOkAt" = ?, "lastError" = ? WHERE "calendarId" = ?`, pulled.cursor, ctx.now(), null, input.calendarId);
    ctx.db.run(`UPDATE calendar_list SET state = ?, version = ?, updated_at = ? WHERE id = ?`, "syncing", num(cal, "version") + 1, ctx.now(), input.calendarId);
    ctx.emit("calendar.synced", `entity/${input.calendarId}`, { calendarId: input.calendarId, upserted: pulled.upserted, removed: pulled.removed }, { vis: "participants" });
  } catch (e) {
    const code = codeOf(e);
    ctx.db.run(`UPDATE calendar_sync SET "lastError" = ? WHERE "calendarId" = ?`, code || "sync_failed", input.calendarId);
    ctx.db.run(`UPDATE calendar_list SET state = ?, version = ?, updated_at = ? WHERE id = ?`, "error", num(cal, "version") + 1, ctx.now(), input.calendarId);
    ctx.log.warn("calendar sync failed", { calendarId: input.calendarId, code });
  }
  return { runId };
}

const isoOf = (ts: number): string => new Date(ts).toISOString();

async function pullGoogle(ctx: CalCtx, calendarId: string, connectionId: string, remoteId: string, cursor: string | null): Promise<Pulled> {
  const run = async (token: string | null): Promise<Pulled> => {
    let upserted = 0;
    let removed = 0;
    let pageToken: string | undefined;
    let next: string | null = null;
    const now = ctx.now();
    for (let page = 0; page < MAX_PAGES; page++) {
      const query: Json = token ? { syncToken: token } : { timeMin: isoOf(now - PULL_BEHIND), timeMax: isoOf(now + PULL_AHEAD) };
      const res = obj(await ctx.call("google.calendar.list_events", { connectionId, calendarId: remoteId, ...query, ...(pageToken ? { pageToken } : {}) }));
      for (const raw of list(res.events).map(obj)) {
        const ing = fromGoogle(calendarId, raw);
        if (!ing) continue;
        await ingestEvent(ctx, ing);
        if (ing.deleted) removed++;
        else upserted++;
      }
      pageToken = text(res.nextPageToken) || undefined;
      if (text(res.nextSyncToken)) next = text(res.nextSyncToken);
      if (!pageToken) break;
    }
    return { upserted, removed, cursor: next };
  };
  if (!cursor) return run(null);
  try {
    return await run(cursor);
  } catch (e) {
    ctx.log.warn("calendar: sync token refused, reading the window again", { calendarId, code: codeOf(e) });
    return run(null);   // an expired token means read everything in the window once; ingest is idempotent
  }
}

async function pullGraph(ctx: CalCtx, calendarId: string, connectionId: string, remoteId: string, cursor: string | null): Promise<Pulled> {
  const run = async (link: string | null): Promise<Pulled> => {
    const now = ctx.now();
    const res = obj(await ctx.call("ms.calendar.delta", { connectionId, calendarId: remoteId, start: isoOf(now - PULL_BEHIND), end: isoOf(now + PULL_AHEAD), ...(link ? { deltaLink: link } : {}) }));
    let upserted = 0;
    let removed = 0;
    for (const raw of list(res.changed).map(obj)) {
      const ing = fromGraph(calendarId, raw);
      if (!ing) continue;
      await ingestEvent(ctx, ing);
      if (ing.deleted) removed++;
      else upserted++;
    }
    for (const id of list(res.removed)) {
      if (typeof id !== "string" || !id) continue;
      await ingestEvent(ctx, { source: "microsoft", calendarId, providerId: id, deleted: true });
      removed++;
    }
    return { upserted, removed, cursor: text(res.deltaLink) || null };
  };
  if (!cursor) return run(null);
  try {
    return await run(cursor);
  } catch (e) {
    ctx.log.warn("calendar: delta link refused, reading the window again", { calendarId, code: codeOf(e) });
    return run(null);
  }
}

// ---- health

export async function health(ctx: CalCtx): Promise<{ state: "healthy" | "degraded" | "down"; detail?: string }> {
  ensure(ctx);
  const now = ctx.now();
  const provider = rowsOf(ctx.db.all(`SELECT * FROM calendar_list WHERE deleted_at IS NULL`)).filter((c) => str(c, "provider") !== "local" && str(c, "state") !== "paused");
  if (!provider.length) return { state: "healthy", detail: "No Google or Microsoft calendar is connected." };
  const problems: string[] = [];
  for (const c of provider) {
    const sync = first(ctx.db.all(`SELECT * FROM calendar_sync WHERE "calendarId" = ?`, str(c, "id")));
    const ok = sync ? num(sync, "lastOkAt") : 0;
    const title = str(c, "title") || str(c, "id");
    if (str(c, "state") === "error") problems.push(`${title} could not sync`);
    else if (ok === 0) continue;   // connected and never pulled yet: nothing to age
    else if (now - ok > STALE_MS) problems.push(`${title} last synced ${ageOf(now - ok)} ago`);
  }
  if (!problems.length) return { state: "healthy" };
  return { state: problems.length >= provider.length ? "down" : "degraded", detail: problems.join(". ") + "." };
}

function ageOf(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  return hours >= 48 ? `${Math.floor(hours / 24)} days` : `${hours} hours`;
}

