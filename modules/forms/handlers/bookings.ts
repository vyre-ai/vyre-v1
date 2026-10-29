// forms: booking pages (spec 2.11 Booking pages; ARCH 7.6). A page has one host or a round-robin pool, a length and a buffer.
// Availability = the page's weekly hours minus the hosts' busy blocks (calendar.availability) minus bookings already made, widened by the buffer.
// A host whose calendar is disconnected is left out; when every host is out the page answers `available: false` and the owner gets a task.
// A booking writes or updates a record through the same match rule as a form, makes the calendar event, and keeps its own row.
// Slots are timestamps; `tz` is the visitor's zone, checked here and used by the renderer to print them.
// @reads ../migrations/0001_forms.sql

import type { Ctx } from "../../../packages/contracts/src/ctx.ts";
import type { Row } from "../projections.ts";
import {
  fail, formOut, insertForm, isNull, isRec, many, mustForm, nid, num, one, pageOf, parseJson, publishedBySlug, rec, reqInt, reqStr, str, strList,
} from "../projections.ts";
import { checkAnswers, typedAnswers, formPrincipal, principalOk, publicChecks, writeAnswers } from "./submit.ts";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const GRID_MINUTES = 15;
const MAX_RANGE_DAYS = 62;
const MAX_SLOTS = 500;
const ALERT_EVERY_MS = 12 * 60 * MINUTE;
const DEFAULT_HOURS = { days: [1, 2, 3, 4, 5], from: "09:00", to: "17:00", tz: "UTC" };

interface Hours { days: number[]; from: string; to: string; tz: string }
interface Slot { startsAt: number; endsAt: number; hostId: string }
interface BookingOut { bookingId: string; formId: string; recordId: string; startsAt: number; endsAt: number; hostId: string; state: "booked" | "cancelled" | "rescheduled" }

// ---- time -----------------------------------------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();

function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function zoneParts(ts: number, tz: string): { day: number; minutes: number } {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formatters.set(tz, f);
  }
  let weekday = "Sun";
  let hour = 0;
  let minute = 0;
  for (const p of f.formatToParts(new Date(ts))) {
    if (p.type === "weekday") weekday = p.value;
    else if (p.type === "hour") hour = Number(p.value) % 24;
    else if (p.type === "minute") minute = Number(p.value);
  }
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  return { day: day < 0 ? 0 : day, minutes: hour * 60 + minute };
}

function clock(text: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(text);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

function hoursOf(page: Row): Hours {
  const h = parseJson(page.hours);
  if (!isRec(h)) return DEFAULT_HOURS;
  const days = Array.isArray(h.days) ? h.days.filter((d): d is number => typeof d === "number" && d >= 0 && d <= 6) : DEFAULT_HOURS.days;
  return {
    days,
    from: typeof h.from === "string" ? h.from : DEFAULT_HOURS.from,
    to: typeof h.to === "string" ? h.to : DEFAULT_HOURS.to,
    tz: typeof h.tz === "string" && validZone(h.tz) ? h.tz : DEFAULT_HOURS.tz,
  };
}

function checkZone(ctx: Ctx, tz: string): void {
  if (tz.length === 0 || tz.length > 64 || !validZone(tz)) fail(ctx, "validation.bad_input", "That time zone is not known.", { field: "tz" });
}

// ---- availability ---------------------------------------------------------------------------------------------------

function mustPage(ctx: Ctx, formId: string): Row {
  const page = one(ctx, "SELECT * FROM forms_booking_page WHERE form_id = ?", formId);
  if (!page) fail(ctx, "validation.not_found", "That booking page does not exist.");
  return page;
}

interface Opening {
  slots: Slot[];
  available: boolean;
  unknownHosts: string[];
}

/** Open slots of a page between two times. A slot needs one host who is in hours, not busy and not booked, with the buffer around it. */
async function openSlots(ctx: Ctx, form: Row, page: Row, from: number, to: number): Promise<Opening> {
  const hosts = strList(page.host_ids);
  const length = num(page.length_minutes) * MINUTE;
  const buffer = num(page.buffer_minutes) * MINUTE;
  const hours = hoursOf(page);
  const fromMin = clock(hours.from);
  const toMin = clock(hours.to);

  let busy: { who: string; startsAt: number; endsAt: number }[] = [];
  let unknown: string[] = [];
  try {
    const res = (await ctx.call("calendar.availability", { people: hosts, from: from - buffer, to: to + buffer })) as { busy?: unknown; unknown?: unknown };
    busy = Array.isArray(res.busy)
      ? res.busy.filter(isRec).map((b) => ({ who: str(b.who), startsAt: num(b.startsAt), endsAt: num(b.endsAt) }))
      : [];
    unknown = Array.isArray(res.unknown) ? res.unknown.filter((u): u is string => typeof u === "string") : [];
  } catch (e) {
    ctx.log.warn("forms: calendar availability failed", { form: str(form.id), error: e instanceof Error ? e.message : String(e) });
    unknown = hosts;
  }
  const live = hosts.filter((h) => !unknown.includes(h));
  if (live.length === 0) return { slots: [], available: false, unknownHosts: hosts };

  const booked = new Map<string, { s: number; e: number }[]>();
  const counts = new Map<string, number>();
  for (const h of live) booked.set(h, []);
  for (const b of many(ctx, "SELECT * FROM forms_booking WHERE state = ?", "booked")) {
    const list = booked.get(str(b.host_id));
    if (list) list.push({ s: num(b.starts_at), e: num(b.ends_at) });
    if (b.form_id === form.id) counts.set(str(b.host_id), (counts.get(str(b.host_id)) ?? 0) + 1);
  }
  const blocks = new Map<string, { s: number; e: number }[]>();
  for (const h of live) blocks.set(h, [...(booked.get(h) ?? []), ...busy.filter((b) => b.who === h).map((b) => ({ s: b.startsAt, e: b.endsAt }))]);

  const earliest = Math.max(from, ctx.now() + num(page.notice_minutes) * MINUTE);
  const step = GRID_MINUTES * MINUTE;
  const slots: Slot[] = [];
  for (let s = Math.ceil(earliest / step) * step; s + length <= to && slots.length < MAX_SLOTS; s += step) {
    const local = zoneParts(s, hours.tz);
    if (!hours.days.includes(local.day) || local.minutes < fromMin || local.minutes + num(page.length_minutes) > toMin) continue;
    const e = s + length;
    const free = live.filter((h) => (blocks.get(h) ?? []).every((b) => !(b.s < e + buffer && b.e > s - buffer)));
    if (free.length === 0) continue;
    // Round robin: the free host with the fewest bookings on this page goes first; ties keep the order the owner gave.
    let pick = free[0] as string;
    for (const h of free) if ((counts.get(h) ?? 0) < (counts.get(pick) ?? 0)) pick = h;
    slots.push({ startsAt: s, endsAt: e, hostId: pick });
  }
  return { slots, available: true, unknownHosts: unknown };
}

async function alertOwner(ctx: Ctx, form: Row, page: Row, hosts: string[]): Promise<void> {
  const now = ctx.now();
  if (!isNull(page.alerted_at) && num(page.alerted_at) > now - ALERT_EVERY_MS) return;
  ctx.db.run("UPDATE forms_booking_page SET alerted_at = ? WHERE form_id = ?", now, str(form.id));
  try {
    await ctx.call("tasks.create", {
      idempotencyKey: `forms.booking_alert:${str(form.id)}:${Math.floor(now / ALERT_EVERY_MS)}`,
      title: `The booking page ${str(form.name)} shows unavailable`,
      summary: `No host calendar is connected (${hosts.join(", ")}). Reconnect a calendar so visitors can book again.`,
      assigned: { kind: "person", id: str(form.created_by) },
      source: { kind: "manual", id: str(form.id) },
    });
  } catch (e) {
    ctx.log.warn("forms: could not alert the owner of a booking page", { form: str(form.id), error: e instanceof Error ? e.message : String(e) });
  }
}

function rangeOf(ctx: Ctx, o: Record<string, unknown>): { from: number; to: number } {
  const from = reqInt(ctx, o, "from", 0);
  const to = reqInt(ctx, o, "to", 0);
  if (to <= from || to - from > MAX_RANGE_DAYS * DAY) fail(ctx, "validation.bad_input", `Ask for a range of up to ${MAX_RANGE_DAYS} days.`, { field: "to" });
  return { from, to };
}

async function availability(ctx: Ctx, input: unknown): Promise<{ slots: Slot[]; available: boolean }> {
  const o = rec(ctx, input);
  const form = publishedBySlug(ctx, reqStr(ctx, o, "slug"), ["booking"]);
  checkZone(ctx, reqStr(ctx, o, "tz"));
  const { from, to } = rangeOf(ctx, o);
  const page = mustPage(ctx, str(form.id));
  const w = await openSlots(ctx, form, page, from, to);
  if (!w.available) await alertOwner(ctx, form, page, w.unknownHosts);
  return { slots: w.slots, available: w.available };
}

// ---- pages, bookings --------------------------------------------------------------------------------------------------

function bookingOut(b: Row): BookingOut {
  return {
    bookingId: str(b.id),
    formId: str(b.form_id),
    recordId: str(b.record_id),
    startsAt: num(b.starts_at),
    endsAt: num(b.ends_at),
    hostId: str(b.host_id),
    state: str(b.state) as BookingOut["state"],
  };
}

async function pageCreate(ctx: Ctx, input: unknown): Promise<{ form: ReturnType<typeof formOut> }> {
  const o = rec(ctx, input);
  const name = reqStr(ctx, o, "name").trim();
  const hostIds = o.hostIds;
  if (name.length === 0 || name.length > 120) fail(ctx, "validation.bad_input", "Give the page a name.", { field: "name" });
  if (!Array.isArray(hostIds) || hostIds.length === 0 || hostIds.length > 50 || !hostIds.every((h) => typeof h === "string" && h.length > 0)) {
    fail(ctx, "validation.bad_input", "Pick at least one host.", { field: "hostIds" });
  }
  const hosts = [...new Set(hostIds as string[])];
  const length = reqInt(ctx, o, "lengthMinutes", 5, 480);
  const buffer = o.bufferMinutes === undefined || o.bufferMinutes === null ? 0 : reqInt(ctx, o, "bufferMinutes", 0, 240);
  const recordType = reqStr(ctx, o, "recordType");
  if (!/^[a-z][a-z0-9_]*$/.test(recordType)) fail(ctx, "validation.bad_input", "That record type is not valid.", { field: "recordType" });
  const form = insertForm(ctx, { name, recordType, kind: "booking" });
  ctx.emit("form.created", `form/${str(form.id)}`, { formId: str(form.id), name, kind: "booking" });
  ctx.db.run(
    "INSERT INTO forms_booking_page (form_id, host_ids, length_minutes, buffer_minutes, hours, notice_minutes, alerted_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    str(form.id), JSON.stringify(hosts), length, buffer, JSON.stringify(DEFAULT_HOURS), 60, null,
  );
  // Every booking needs an email: it matches the person to a record and invites them to the meeting.
  ctx.db.run("INSERT INTO forms_field (form_id, field, mode, prefill_key, step, position) VALUES (?, ?, ?, ?, ?, ?)", str(form.id), "email", "ask", null, null, 0);
  return { form: formOut(ctx, form) };
}

/** True when the host has a booking that overlaps [s, e) once the buffer is added. */
function hostConflict(ctx: Ctx, hostId: string, s: number, e: number, buffer: number): boolean {
  return many(ctx, "SELECT * FROM forms_booking WHERE host_id = ?", hostId).some((b) => b.state === "booked" && num(b.starts_at) < e + buffer && num(b.ends_at) > s - buffer);
}

async function hostCalendar(ctx: Ctx, hostId: string): Promise<string | undefined> {
  try {
    const res = (await ctx.call("calendar.list_calendars", { scope: "all" })) as { calendars?: unknown };
    const list = Array.isArray(res.calendars) ? res.calendars.filter(isRec).filter((c) => c.ownerId === hostId) : [];
    const pick = list.find((c) => c.personal !== true) ?? list[0];
    return pick && typeof pick.id === "string" ? pick.id : undefined;
  } catch (e) {
    ctx.log.warn("forms: could not list calendars", { error: e instanceof Error ? e.message : String(e) });
    return undefined;
  }
}

async function book(ctx: Ctx, input: unknown): Promise<{ booking: BookingOut }> {
  const o = rec(ctx, input);
  const form = publishedBySlug(ctx, reqStr(ctx, o, "slug"), ["booking"]);
  const formId = str(form.id);
  principalOk(ctx, form);
  const tz = reqStr(ctx, o, "tz");
  checkZone(ctx, tz);
  const startsAt = reqInt(ctx, o, "startsAt", 0);
  const rawAnswers = o.answers;
  if (!isRec(rawAnswers)) fail(ctx, "validation.bad_input", "The answers are not valid.", { field: "answers" });
  const page = mustPage(ctx, formId);

  const consent = await publicChecks(ctx, form, rawAnswers, o, "book");
  const answers = await typedAnswers(ctx, form, checkAnswers(ctx, form, null, rawAnswers));
  const email = typeof answers.email === "string" ? answers.email : "";
  if (email.length === 0) fail(ctx, "validation.bad_input", "An email address is needed to book.", { field: "answers.email" });

  const length = num(page.length_minutes) * MINUTE;
  const buffer = num(page.buffer_minutes) * MINUTE;
  const endsAt = startsAt + length;
  const w = await openSlots(ctx, form, page, startsAt, endsAt);
  if (!w.available) {
    await alertOwner(ctx, form, page, w.unknownHosts);
    fail(ctx, "validation.precondition_failed", "This page cannot take bookings right now.");
  }
  const slot = w.slots.find((s) => s.startsAt === startsAt);
  if (!slot) fail(ctx, "validation.precondition_failed", "That time is no longer available. Pick another.");

  const bookKey = `forms.book:${formId}:${startsAt}:${email}:${ctx.trace.traceId}`;
  const written = await writeAnswers(ctx, form, answers, null, bookKey);

  const calendarId = await hostCalendar(ctx, slot.hostId);
  let eventId: string | null = null;
  if (calendarId) {
    const name = typeof answers.name === "string" && answers.name.length > 0 ? answers.name : email;
    const res = (await ctx.call("calendar.create_event", {
      idempotencyKey: `${bookKey}:event`, calendarId, title: `${str(form.name)}: ${name}`, startsAt, endsAt, attendees: [{ email }], recordIds: [written.recordId], fromBookingPage: formId,
    })) as { event?: { id?: unknown } };
    eventId = res.event && typeof res.event.id === "string" ? res.event.id : null;
  } else {
    ctx.log.warn("forms: the host has no calendar, the booking has no event", { form: formId, host: slot.hostId });
  }

  // Another call may have booked the slot while the calendar answered; the check and the insert run with no await between them.
  if (hostConflict(ctx, slot.hostId, startsAt, endsAt, buffer)) {
    if (eventId) {
      try {
        await ctx.call("calendar.delete_event", { eventId });
      } catch (e) {
        ctx.log.warn("forms: could not remove the event of a lost slot", { eventId, error: e instanceof Error ? e.message : String(e) });
      }
    }
    fail(ctx, "validation.precondition_failed", "That time was just taken. Pick another.");
  }
  const id = nid(ctx, "bkg");
  const now = ctx.now();
  ctx.db.run(
    "INSERT INTO forms_booking (id, form_id, record_id, host_id, starts_at, ends_at, state, tz, event_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id, formId, written.recordId, slot.hostId, startsAt, endsAt, "booked", tz, eventId, now,
  );
  ctx.db.run(
    "INSERT INTO forms_submission (id, form_id, record_id, at, matched, principal, link_id, consent, digest, answers) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    nid(ctx, "sub"), formId, written.recordId, now, written.matched ? 1 : 0, formPrincipal(formId), null, consent ? 1 : 0, id, null,
  );
  ctx.emit("booking.created", `form/${formId}`, { bookingId: id, formId, recordId: written.recordId });
  return { booking: bookingOut(mustBooking(ctx, id)) };
}

function mustBooking(ctx: Ctx, bookingId: string): Row {
  const b = one(ctx, "SELECT * FROM forms_booking WHERE id = ?", bookingId);
  if (!b) fail(ctx, "validation.not_found", "That booking does not exist.");
  return b;
}

async function cancel(ctx: Ctx, input: unknown): Promise<{ booking: BookingOut }> {
  const o = rec(ctx, input);
  const b = mustBooking(ctx, reqStr(ctx, o, "bookingId"));
  if (b.state !== "booked") return { booking: bookingOut(b) };
  ctx.db.run("UPDATE forms_booking SET state = ? WHERE id = ?", "cancelled", str(b.id));
  if (!isNull(b.event_id)) {
    try {
      await ctx.call("calendar.delete_event", { eventId: str(b.event_id) });
    } catch (e) {
      ctx.log.warn("forms: could not remove the event of a cancelled booking", { booking: str(b.id), error: e instanceof Error ? e.message : String(e) });
    }
  }
  ctx.emit("booking.cancelled", `form/${str(b.form_id)}`, { bookingId: str(b.id), formId: str(b.form_id) });
  return { booking: bookingOut(mustBooking(ctx, str(b.id))) };
}

async function list(ctx: Ctx, input: unknown): Promise<{ bookings: BookingOut[]; next?: string; total: number }> {
  const o = rec(ctx, input);
  const form = mustForm(ctx, reqStr(ctx, o, "formId"));
  const { offset, limit } = pageOf(ctx, o);
  const rows = many(ctx, "SELECT * FROM forms_booking WHERE form_id = ?", str(form.id)).sort((a, b) => num(a.starts_at) - num(b.starts_at) || str(a.id).localeCompare(str(b.id)));
  const out: { bookings: BookingOut[]; next?: string; total: number } = { bookings: rows.slice(offset, offset + limit).map(bookingOut), total: rows.length };
  if (offset + limit < rows.length) out.next = String(offset + limit);
  return out;
}

export const bookingHandlers = {
  "bookings.page_create": (ctx: Ctx, input: unknown) => pageCreate(ctx, input),
  "bookings.availability": (ctx: Ctx, input: unknown) => availability(ctx, input),
  "bookings.book": (ctx: Ctx, input: unknown) => book(ctx, input),
  "bookings.cancel": (ctx: Ctx, input: unknown) => cancel(ctx, input),
  "bookings.list": (ctx: Ctx, input: unknown) => list(ctx, input),
};
