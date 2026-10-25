// The calendar capabilities against an in-memory store (spec 3.3 flow 4, 2.18 Calendar): calendars, events, Today, the 15 minute grid, availability stripes, Find a time and
// the merge of an event with a meeting. The scripted stand-ins answer in the frozen shapes; every call a handler makes is checked against the frozen input schema.
import test from "node:test";
import assert from "node:assert/strict";
import {
  availability, createCalendar, createEvent, deleteCalendar, deleteEvent, duplicateEvent, findTime, getEvent, ingestEvent, linkRecord, listCalendars, listEvents, moveToCalendar,
  respond, restoreEvent, updateCalendar, updateEvent,
} from "../handlers/index.ts";
import { ceilToStep, snapToStep, STEP_MS } from "../projections.ts";
import { at, codeOf, contractErrors, DAY, harness, MIN, NOW, seedCalendar, seedEvent } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

async function refused(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e: unknown) => {
    assert.equal(codeOf(e), code);
    return true;
  });
}

const OMAR = { kind: "person", id: "usr_omar01" } as const;
const key = (n: number): string => `idem_${n}`;

function world(): Harness {
  const h = harness();
  seedCalendar(h, "cld_work01", { title: "Work" });
  seedCalendar(h, "cld_omar01", { title: "Omar", owner: "usr_omar01" });
  return h;
}

// ---- calendars

test("a calendar is created for the caller, coloured, listed first among theirs, and a personal one stays private", async () => {
  const h = world();
  const out = await createCalendar(h.ctx, { title: "  Personal ", personal: true, idempotencyKey: key(1) } as never);
  assert.deepEqual(contractErrors("calendar.create_calendar", "out", out), []);
  assert.deepEqual([out.calendar.title, out.calendar.provider, out.calendar.personal, out.calendar.ownerId, out.calendar.state], ["Personal", "local", true, "usr_maya01", "syncing"]);
  assert.match(out.calendar.color, /^#[0-9a-f]{6}$/);
  h.denied.add(`calendar:${out.calendar.id}`);
  const mine = await listCalendars(h.ctx, {});
  assert.deepEqual(contractErrors("calendar.list_calendars", "out", mine), []);
  assert.deepEqual(mine.calendars.map((c) => c.title), ["Personal", "Work", "Omar"], "the caller's own first, then the others by title");
  const omars = await listCalendars(h.as(OMAR), {});
  assert.deepEqual(omars.calendars.map((c) => c.title), ["Omar", "Work"], "someone else's private calendar is not listed");
  assert.deepEqual((await listCalendars(h.ctx, { scope: "mine" })).calendars.map((c) => c.title), ["Personal", "Work"]);
  assert.deepEqual((await listCalendars(h.ctx, { scope: "shared" })).calendars.map((c) => c.title), ["Omar"]);
});

test("a calendar needs a title and a hex colour; an agent with no person behind it cannot own one", async () => {
  const h = world();
  await refused(createCalendar(h.ctx, { title: "   " }), "validation.bad_input");
  await refused(createCalendar(h.ctx, { title: "x", color: "red" }), "validation.bad_input");
  await refused(createCalendar(h.ctx, { title: "x", personal: "yes" as never }), "validation.bad_input");
  await refused(createCalendar(h.as({ kind: "agent", id: "agt_helper1" }), { title: "x" }), "validation.bad_input");
  const acting = h.as({ kind: "agent", id: "agt_helper1" });
  (acting as { actingFor?: string }).actingFor = "usr_maya01";
  assert.equal((await createCalendar(acting, { title: "On behalf" })).calendar.ownerId, "usr_maya01");
});

test("a calendar is renamed and recoloured; only its owner or a grant may, and nothing to change is refused", async () => {
  const h = world();
  const out = await updateCalendar(h.ctx, { calendarId: "cld_work01", title: "Firm", color: "#112233" });
  assert.deepEqual([out.calendar.title, out.calendar.color], ["Firm", "#112233"]);
  await refused(updateCalendar(h.ctx, { calendarId: "cld_work01" }), "validation.bad_input");
  await refused(updateCalendar(h.ctx, { calendarId: "cld_work01", title: "" }), "validation.bad_input");
  h.denied.add("calendar:cld_omar01");
  await refused(updateCalendar(h.ctx, { calendarId: "cld_omar01", title: "Mine now" }), "permission.no_grant");
  await refused(updateCalendar(h.ctx, { calendarId: "cld_nothing1", title: "x" }), "validation.not_found");
});

test("deleting a local calendar deletes its events one by one; a provider calendar is disconnected, not deleted", async () => {
  const h = world();
  seedCalendar(h, "cld_goog01", { provider: "google", title: "Google", connectionId: "con_g01", remoteId: "primary" });
  const a = seedEvent(h, "cev_a0001", "cld_work01", at(1, 9), at(1, 10));
  const b = seedEvent(h, "cev_b0001", "cld_work01", at(1, 11), at(1, 12));
  await refused(deleteCalendar(h.ctx, { calendarId: "cld_goog01" }), "validation.precondition_failed");
  assert.deepEqual(await deleteCalendar(h.ctx, { calendarId: "cld_work01" }), { deleted: true });
  assert.deepEqual(h.named("calendar_event.deleted").map((e) => e.payload.eventId).sort(), [a, b]);
  assert.deepEqual((await listCalendars(h.ctx, {})).calendars.map((c) => c.id).sort(), ["cld_goog01", "cld_omar01"]);
  await refused(getEvent(h.ctx, { eventId: a }), "validation.not_found");
});

// ---- creating, changing and deleting events

test("an event is created on a calendar with its guests, links and a created event", async () => {
  const h = world();
  const input = {
    calendarId: "cld_work01", title: "  Intake call ", startsAt: at(1, 10), endsAt: at(1, 11), location: "Room 2", agenda: "Review the file",
    attendees: [{ email: "Pat@Acme.test", name: "Pat Lee", contactId: "rec_lee01" }, { email: "pat@acme.test" }, { email: "sam@acme.test", optional: true }],
    recordIds: ["rec_lee01", "rec_lee01"], joinProvider: "zoom", idempotencyKey: key(2),
  } as const;
  assert.deepEqual(contractErrors("calendar.create_event", "in", input), []);
  const out = await createEvent(h.ctx, { ...input, attendees: [...input.attendees], recordIds: [...input.recordIds] });
  assert.deepEqual(contractErrors("calendar.create_event", "out", out), []);
  const e = out.event;
  assert.deepEqual([e.title, e.startsAt, e.endsAt, e.allDay, e.location, e.agenda, e.joinProvider, e.status], ["Intake call", at(1, 10), at(1, 11), false, "Room 2", "Review the file", "zoom", "confirmed"]);
  assert.deepEqual(e.attendees, [
    { email: "pat@acme.test", name: "Pat Lee", contactId: "rec_lee01", response: "needs_action" },
    { email: "sam@acme.test", optional: true, response: "needs_action" },
  ], "addresses are lower case, one row per address");
  assert.deepEqual(e.recordIds, ["rec_lee01"]);
  const made = h.named("calendar_event.created");
  assert.equal(made.length, 1);
  assert.deepEqual(made[0]!.payload, { eventId: e.id, calendarId: "cld_work01", startsAt: at(1, 10), attendeeCount: 2, source: "vyre" });
  assert.equal(made[0]!.subject, `entity/${e.id}`);
});

test("an event made from a booking page says so, and carries the agent that booked it", async () => {
  const h = world();
  const out = await createEvent(h.ctx, { calendarId: "cld_work01", title: "Consult", startsAt: at(1, 9), endsAt: at(1, 9, 30), fromBookingPage: "frm_book01", bookedByAgentId: "agt_scout01" });
  assert.deepEqual([out.event.fromBookingPage, out.event.bookedByAgentId], ["frm_book01", "agt_scout01"]);
  assert.equal(h.named("calendar_event.created")[0]!.payload.source, "booking");
});

test("an event needs a calendar the caller may edit, a title, and an end after its start no more than a year later", async () => {
  const h = world();
  const ok = { calendarId: "cld_work01", title: "x", startsAt: at(1, 9), endsAt: at(1, 10) };
  await refused(createEvent(h.ctx, { ...ok, calendarId: "cld_nothing1" }), "validation.not_found");
  await refused(createEvent(h.ctx, { ...ok, calendarId: "nope" }), "validation.bad_input");
  await refused(createEvent(h.ctx, { ...ok, title: " " }), "validation.bad_input");
  await refused(createEvent(h.ctx, { ...ok, endsAt: ok.startsAt }), "validation.bad_input");
  await refused(createEvent(h.ctx, { ...ok, endsAt: ok.startsAt + 367 * DAY }), "validation.bad_input");
  await refused(createEvent(h.ctx, { ...ok, startsAt: 1.5 }), "validation.bad_input");
  await refused(createEvent(h.ctx, { ...ok, attendees: [{ email: "not-an-address" }] }), "validation.bad_input");
  await refused(createEvent(h.ctx, { ...ok, recordIds: ["bad"] }), "validation.bad_input");
  await refused(createEvent(h.ctx, { ...ok, joinProvider: "skype" as never }), "validation.bad_input");
  h.denied.add("calendar:cld_omar01");
  await refused(createEvent(h.ctx, { ...ok, calendarId: "cld_omar01" }), "permission.no_grant");
  assert.equal(h.rows(`SELECT id FROM calendar_event`).length, 0, "nothing was written by a refused create");
});

test("moving and resizing an event changes its times and says which fields changed; the same values change nothing", async () => {
  const h = world();
  const { event } = await createEvent(h.ctx, { calendarId: "cld_work01", title: "Call", startsAt: at(1, 10), endsAt: at(1, 11) });
  const moved = await updateEvent(h.ctx, { eventId: event.id, startsAt: at(1, 10, 30), endsAt: at(1, 11, 30) });
  assert.deepEqual(contractErrors("calendar.update_event", "out", moved), []);
  assert.deepEqual([moved.event.startsAt, moved.event.endsAt], [at(1, 10, 30), at(1, 11, 30)]);
  assert.deepEqual(h.named("calendar_event.updated").map((e) => e.payload.fields), [["startsAt", "endsAt"]]);
  await updateEvent(h.ctx, { eventId: event.id, startsAt: at(1, 10, 30), endsAt: at(1, 11, 30), title: "Call" });
  assert.equal(h.named("calendar_event.updated").length, 1, "an update that changes nothing emits nothing");
  const resized = await updateEvent(h.ctx, { eventId: event.id, endsAt: at(1, 12) });
  assert.equal(resized.event.endsAt, at(1, 12));
  await refused(updateEvent(h.ctx, { eventId: event.id, endsAt: at(1, 10) }), "validation.bad_input");
  await refused(updateEvent(h.ctx, { eventId: event.id, title: "" }), "validation.bad_input");
  await refused(updateEvent(h.ctx, { eventId: "cev_nothing1", title: "x" }), "validation.not_found");
});

test("changing the guests keeps the answers of those who stay and starts the others at needs_action", async () => {
  const h = world();
  const { event } = await createEvent(h.ctx, {
    calendarId: "cld_work01", title: "Call", startsAt: at(1, 10), endsAt: at(1, 11), attendees: [{ email: "pat@acme.test", response: "accepted" }],
  });
  const out = await updateEvent(h.ctx, { eventId: event.id, attendees: [{ email: "pat@acme.test" }, { email: "sam@acme.test" }] });
  assert.deepEqual(out.event.attendees.map((a) => [a.email, a.response]), [["pat@acme.test", "accepted"], ["sam@acme.test", "needs_action"]]);
  assert.deepEqual(h.named("calendar_event.updated").at(-1)!.payload.fields, ["attendees"]);
});

test("Delete hides an event, Undo brings it back, and a second delete or restore says nothing new", async () => {
  const h = world();
  const { event } = await createEvent(h.ctx, { calendarId: "cld_work01", title: "Call", startsAt: at(1, 10), endsAt: at(1, 11) });
  assert.deepEqual(await deleteEvent(h.ctx, { eventId: event.id }), { deleted: true });
  assert.deepEqual(await deleteEvent(h.ctx, { eventId: event.id }), { deleted: true });
  assert.equal(h.named("calendar_event.deleted").length, 1);
  assert.equal((await listEvents(h.ctx, { from: at(1, 0), to: at(2, 0) })).events.length, 0);
  await refused(getEvent(h.ctx, { eventId: event.id }), "validation.not_found");
  await refused(updateEvent(h.ctx, { eventId: event.id, title: "x" }), "validation.not_found");
  const back = await restoreEvent(h.ctx, { eventId: event.id });
  assert.deepEqual(contractErrors("calendar.restore_event", "out", back), []);
  assert.equal(back.event.title, "Call");
  await restoreEvent(h.ctx, { eventId: event.id });
  assert.equal(h.named("calendar_event.restored").length, 1);
  assert.equal((await listEvents(h.ctx, { from: at(1, 0), to: at(2, 0) })).events.length, 1);
  await refused(deleteEvent(h.ctx, { eventId: "cev_nothing1" }), "validation.not_found");
});

test("Duplicate makes a new event at the same or a given time, with guests who have not answered and no meeting", async () => {
  const h = world();
  const { event } = await createEvent(h.ctx, {
    calendarId: "cld_work01", title: "Weekly", startsAt: at(1, 10), endsAt: at(1, 10, 45), attendees: [{ email: "pat@acme.test", response: "accepted" }], recordIds: ["rec_lee01"],
  });
  const same = await duplicateEvent(h.ctx, { eventId: event.id });
  assert.notEqual(same.event.id, event.id);
  assert.deepEqual([same.event.startsAt, same.event.endsAt, same.event.title, same.event.recordIds], [at(1, 10), at(1, 10, 45), "Weekly", ["rec_lee01"]]);
  assert.equal(same.event.attendees[0]!.response, "needs_action");
  const later = await duplicateEvent(h.ctx, { eventId: event.id, startsAt: at(4, 14) });
  assert.deepEqual([later.event.startsAt, later.event.endsAt], [at(4, 14), at(4, 14, 45)]);
  assert.equal(h.named("calendar_event.created").length, 3);
  assert.deepEqual(contractErrors("calendar.duplicate_event", "out", later), []);
});

test("an event moves to another calendar the caller may edit and forgets the provider's id for it", async () => {
  const h = world();
  const { event } = await createEvent(h.ctx, { calendarId: "cld_work01", title: "Call", startsAt: at(1, 10), endsAt: at(1, 11) });
  h.ctx.db.run(`UPDATE calendar_event SET "providerId" = ? WHERE id = ?`, "gcal_1", event.id);
  seedCalendar(h, "cld_other1", { title: "Other" });
  const out = await moveToCalendar(h.ctx, { eventId: event.id, calendarId: "cld_other1" });
  assert.equal(out.event.calendarId, "cld_other1");
  assert.equal(h.rows(`SELECT "providerId" FROM calendar_event WHERE id = ?`, event.id)[0]!.providerId, null);
  assert.deepEqual(h.named("calendar_event.updated").at(-1)!.payload, { eventId: event.id, calendarId: "cld_other1", fields: ["calendarId"] });
  const count = h.named("calendar_event.updated").length;
  await moveToCalendar(h.ctx, { eventId: event.id, calendarId: "cld_other1" });
  assert.equal(h.named("calendar_event.updated").length, count, "moving to where it already is changes nothing");
  h.denied.add("calendar:cld_omar01");
  await refused(moveToCalendar(h.ctx, { eventId: event.id, calendarId: "cld_omar01" }), "permission.no_grant");
});

test("a guest answers an invitation once; someone not on the list has nothing to answer", async () => {
  const h = world();
  const { event } = await createEvent(h.ctx, {
    calendarId: "cld_work01", title: "Call", startsAt: at(1, 10), endsAt: at(1, 11), attendees: [{ email: "Maya@vyre.test" }, { email: "pat@acme.test" }],
  });
  const out = await respond(h.ctx, { eventId: event.id, response: "tentative", comment: "Maybe" });
  assert.deepEqual(contractErrors("calendar.respond", "out", out), []);
  assert.deepEqual(out.event.attendees.map((a) => [a.email, a.response]), [["maya@vyre.test", "tentative"], ["pat@acme.test", "needs_action"]]);
  assert.deepEqual(h.named("calendar_event.response_changed").map((e) => e.payload), [{ eventId: event.id, email: "maya@vyre.test", response: "tentative" }]);
  await respond(h.ctx, { eventId: event.id, response: "tentative" });
  assert.equal(h.named("calendar_event.response_changed").length, 1, "the same answer twice says nothing new");
  await respond(h.ctx, { eventId: event.id, response: "declined" });
  assert.equal(h.named("calendar_event.response_changed").length, 2);
  await refused(respond(h.as(OMAR), { eventId: event.id, response: "accepted" }), "validation.precondition_failed");
  await refused(respond(h.ctx, { eventId: event.id, response: "maybe" as never }), "validation.bad_input");
});

test("records are linked to an event and unlinked again, without duplicates", async () => {
  const h = world();
  const { event } = await createEvent(h.ctx, { calendarId: "cld_work01", title: "Call", startsAt: at(1, 10), endsAt: at(1, 11), recordIds: ["rec_lee01"] });
  const added = await linkRecord(h.ctx, { eventId: event.id, recordIds: ["rec_lee01", "rec_fox001"] });
  assert.deepEqual(added.event.recordIds, ["rec_lee01", "rec_fox001"]);
  assert.deepEqual(h.named("calendar_event.updated").at(-1)!.payload.fields, ["recordIds"]);
  const count = h.named("calendar_event.updated").length;
  await linkRecord(h.ctx, { eventId: event.id, recordIds: ["rec_fox001"] });
  assert.equal(h.named("calendar_event.updated").length, count, "linking what is linked changes nothing");
  const removed = await linkRecord(h.ctx, { eventId: event.id, recordIds: ["rec_lee01"], unlink: true });
  assert.deepEqual(removed.event.recordIds, ["rec_fox001"]);
  await refused(linkRecord(h.ctx, { eventId: event.id, recordIds: [] }), "validation.bad_input");
  await refused(linkRecord(h.ctx, { eventId: event.id, recordIds: ["x"] }), "validation.bad_input");
});

// ---- reading events, Today and the grid

test("events in a range come back in time order with an overlap rule, filters and pages", async () => {
  const h = world();
  for (let i = 0; i < 5; i++) seedEvent(h, `cev_p000${i}`, "cld_work01", at(1, 9 + i), at(1, 9 + i, 30), { title: i === 3 ? "Lunch with Pat" : `Slot ${i}` });
  seedEvent(h, "cev_before1", "cld_work01", at(0, 9), at(0, 10), { title: "Yesterday" });
  seedEvent(h, "cev_over001", "cld_work01", at(0, 23), at(1, 9, 15), { title: "Overnight" });
  seedEvent(h, "cev_omar001", "cld_omar01", at(1, 9), at(1, 10), { title: "Omar's" });
  const all = await listEvents(h.ctx, { from: at(1, 0), to: at(2, 0) });
  assert.deepEqual(contractErrors("calendar.list_events", "out", all), []);
  assert.deepEqual(all.events.map((e) => e.title), ["Overnight", "Slot 0", "Omar's", "Slot 1", "Slot 2", "Lunch with Pat", "Slot 4"], "an event that overlaps the start is in; one that ended before is not");
  assert.equal(all.total, 7);
  assert.deepEqual((await listEvents(h.ctx, { from: at(1, 0), to: at(2, 0), calendarIds: ["cld_omar01"] })).events.map((e) => e.title), ["Omar's"]);
  assert.deepEqual((await listEvents(h.ctx, { from: at(1, 0), to: at(2, 0), query: "PAT" })).events.map((e) => e.title), ["Lunch with Pat"]);
  const p1 = await listEvents(h.ctx, { from: at(1, 0), to: at(2, 0), limit: 3 });
  assert.deepEqual([p1.events.length, p1.next, p1.total], [3, "3", 7]);
  const p2 = await listEvents(h.ctx, { from: at(1, 0), to: at(2, 0), limit: 3, cursor: p1.next! });
  const p3 = await listEvents(h.ctx, { from: at(1, 0), to: at(2, 0), limit: 3, cursor: p2.next! });
  assert.deepEqual([p2.events.length, p2.next, p3.events.length, p3.next], [3, "6", 1, undefined]);
  await refused(listEvents(h.ctx, { from: at(1, 0), to: at(1, 0) }), "validation.bad_input");
  await refused(listEvents(h.ctx, { from: at(0, 0), to: at(0, 0) + 63 * DAY }), "validation.bad_input");
  await refused(listEvents(h.ctx, { from: at(1, 0), to: at(2, 0), limit: 0 }), "validation.bad_input");
  await refused(listEvents(h.ctx, { from: at(1, 0), to: at(2, 0), cursor: "x" }), "validation.bad_input");
});

test("someone else sees only the calendars they may view, and asking for a private one by id says it is not there", async () => {
  const h = world();
  seedCalendar(h, "cld_priv001", { title: "Private", personal: true });
  seedEvent(h, "cev_priv001", "cld_priv001", at(1, 9), at(1, 10), { title: "Doctor" });
  seedEvent(h, "cev_work001", "cld_work01", at(1, 11), at(1, 12), { title: "Standup" });
  h.denied.add("calendar:cld_priv001");
  const omar = h.as(OMAR);
  assert.deepEqual((await listEvents(omar, { from: at(1, 0), to: at(2, 0) })).events.map((e) => e.title), ["Standup"]);
  await refused(listEvents(omar, { from: at(1, 0), to: at(2, 0), calendarIds: ["cld_priv001"] }), "validation.not_found");
  await refused(getEvent(omar, { eventId: "cev_priv001" }), "validation.not_found");
  assert.equal((await getEvent(h.ctx, { eventId: "cev_priv001" })).event.title, "Doctor");
});

test("the Today feed for Home is one day of list_events: timed and all-day events in order, cancelled ones marked", async () => {
  const h = world();
  seedEvent(h, "cev_allday1", "cld_work01", at(0), at(1), { title: "Office closed", allDay: true });
  seedEvent(h, "cev_stand01", "cld_work01", at(0, 9), at(0, 9, 15), { title: "Standup" });
  seedEvent(h, "cev_gone001", "cld_work01", at(0, 14), at(0, 15), { title: "Cancelled call", status: "canceled" });
  seedEvent(h, "cev_tomor01", "cld_work01", at(1, 9), at(1, 10), { title: "Tomorrow" });
  const today = await listEvents(h.ctx, { from: at(0), to: at(1) });
  assert.deepEqual(today.events.map((e) => [e.title, e.allDay, e.status]), [["Office closed", true, "confirmed"], ["Standup", false, "confirmed"], ["Cancelled call", false, "canceled"]]);
});

test("a drag snaps to the 15 minute grid and Find a time answers on it", () => {
  assert.equal(STEP_MS, 15 * MIN);
  assert.equal(snapToStep(at(1, 10, 7)), at(1, 10));
  assert.equal(snapToStep(at(1, 10, 8)), at(1, 10, 15));
  assert.equal(ceilToStep(at(1, 10, 1)), at(1, 10, 15));
  assert.equal(ceilToStep(at(1, 10, 15)), at(1, 10, 15));
  assert.notEqual(NOW % STEP_MS, 0, "the test clock is not on the grid, so the grid helpers earn their keep");
});

// ---- availability and Find a time

function busyWorld(): Harness {
  const h = world();
  seedEvent(h, "cev_m90001", "cld_work01", at(1, 9), at(1, 10, 30), { title: "Maya's morning" });
  seedEvent(h, "cev_o10001", "cld_omar01", at(1, 10), at(1, 11), { title: "Omar 1" });
  seedEvent(h, "cev_o13001", "cld_omar01", at(1, 13), at(1, 14), { title: "Omar 2" });
  return h;
}

test("availability gives each person's busy blocks over the range and no titles", async () => {
  const h = busyWorld();
  const out = await availability(h.ctx, { people: ["usr_maya01", "usr_omar01"], from: at(1, 0), to: at(2, 0) });
  assert.deepEqual(contractErrors("calendar.availability", "out", out), []);
  assert.deepEqual(out.busy, [
    { who: "usr_maya01", startsAt: at(1, 9), endsAt: at(1, 10, 30) },
    { who: "usr_omar01", startsAt: at(1, 10), endsAt: at(1, 11) },
    { who: "usr_omar01", startsAt: at(1, 13), endsAt: at(1, 14) },
  ]);
  assert.deepEqual(out.unknown, []);
  const clipped = await availability(h.ctx, { people: ["usr_maya01"], from: at(1, 10), to: at(1, 12) });
  assert.deepEqual(clipped.busy, [{ who: "usr_maya01", startsAt: at(1, 10), endsAt: at(1, 10, 30) }], "a block is cut to the range asked for");
});

test("an email address is the same person as their member id, and a guest on someone else's calendar is busy too", async () => {
  const h = busyWorld();
  seedEvent(h, "cev_guest01", "cld_omar01", at(1, 15), at(1, 16), { title: "Omar's own", attendees: [{ email: "maya@vyre.test", response: "accepted" }, { email: "pat@acme.test" }] });
  const byMail = await availability(h.ctx, { people: ["maya@vyre.test"], from: at(1, 0), to: at(2, 0) });
  assert.deepEqual(byMail.busy.map((b) => [b.startsAt, b.endsAt]), [[at(1, 9), at(1, 10, 30)], [at(1, 15), at(1, 16)]], "Maya's own calendar plus the event she is invited to");
  const outside = await availability(h.ctx, { people: ["pat@acme.test"], from: at(1, 0), to: at(2, 0) });
  assert.deepEqual(outside.busy.map((b) => b.startsAt), [at(1, 15)], "an outside guest is known by the events that list them");
  assert.deepEqual(outside.unknown, []);
});

test("all-day, cancelled, deleted and declined events do not block time; a person with no calendar is unknown", async () => {
  const h = world();
  seedEvent(h, "cev_ad0001", "cld_work01", at(1), at(2), { allDay: true });
  seedEvent(h, "cev_cx0001", "cld_work01", at(1, 9), at(1, 10), { status: "canceled" });
  seedEvent(h, "cev_dl0001", "cld_work01", at(1, 10), at(1, 11), { deleted: true });
  seedEvent(h, "cev_dc0001", "cld_omar01", at(1, 11), at(1, 12), { attendees: [{ email: "maya@vyre.test", response: "declined" }] });
  seedEvent(h, "cev_tn0001", "cld_work01", at(1, 12), at(1, 13), { status: "tentative" });
  const out = await availability(h.ctx, { people: ["usr_maya01", "usr_omar01", "usr_nobody1", "new@elsewhere.test"], from: at(1, 0), to: at(2, 0) });
  assert.deepEqual(out.busy.map((b) => [b.who, b.startsAt]), [["usr_maya01", at(1, 12)], ["usr_omar01", at(1, 11)]], "a tentative event still holds the time; Maya declined Omar's");
  assert.deepEqual(out.unknown, ["usr_nobody1", "new@elsewhere.test"]);
  await refused(availability(h.ctx, { people: [], from: at(1, 0), to: at(2, 0) }), "validation.bad_input");
  await refused(availability(h.ctx, { people: ["not a person"], from: at(1, 0), to: at(2, 0) }), "validation.bad_input");
  await refused(availability(h.ctx, { people: ["usr_maya01"], from: at(2, 0), to: at(1, 0) }), "validation.bad_input");
});

test("Find a time respects the availability stripes: free for everyone, on the 15 minute grid, inside working hours, 30 minutes apart", async () => {
  const h = busyWorld();
  const out = await findTime(h.ctx, { people: ["usr_maya01", "usr_omar01"], durationMinutes: 60, from: at(1, 8), to: at(1, 18), limit: 3 });
  assert.deepEqual(contractErrors("calendar.find_time", "out", out), []);
  assert.deepEqual(out.slots, [
    { startsAt: at(1, 11), endsAt: at(1, 12) },
    { startsAt: at(1, 11, 30), endsAt: at(1, 12, 30) },
    { startsAt: at(1, 12), endsAt: at(1, 13) },
  ], "9:00 to 11:00 is taken by one of the two, and 8:00 is before working hours");
  for (const s of out.slots) assert.equal(s.startsAt % STEP_MS, 0);
  const more = await findTime(h.ctx, { people: ["usr_maya01", "usr_omar01"], durationMinutes: 60, from: at(1, 8), to: at(1, 18), limit: 20 });
  for (const s of more.slots) {
    assert.ok(s.startsAt >= at(1, 9) && s.endsAt <= at(1, 17), "inside 09:00 to 17:00");
    assert.ok(!(s.startsAt < at(1, 11) && s.endsAt > at(1, 9)) && !(s.startsAt < at(1, 14) && s.endsAt > at(1, 13)), "never over a busy block");
  }
  assert.deepEqual(more.slots.slice(-1), [{ startsAt: at(1, 16), endsAt: at(1, 17) }]);
});

test("Find a time can ignore working hours, skips weekends inside them, and answers nothing when the time is full", async () => {
  const h = busyWorld();
  const early = await findTime(h.ctx, { people: ["usr_maya01", "usr_omar01"], durationMinutes: 60, from: at(1, 6), to: at(1, 18), workingHoursOnly: false, limit: 2 });
  assert.deepEqual(early.slots, [{ startsAt: at(1, 6), endsAt: at(1, 7) }, { startsAt: at(1, 6, 30), endsAt: at(1, 7, 30) }]);
  const weekend = await findTime(h.ctx, { people: ["usr_maya01"], durationMinutes: 30, from: at(2, 9), to: at(4, 0) });
  assert.deepEqual(weekend.slots, [], "Saturday and Sunday are not working days");
  const monday = await findTime(h.ctx, { people: ["usr_maya01"], durationMinutes: 30, from: at(2, 9), to: at(4, 12), limit: 1 });
  assert.deepEqual(monday.slots, [{ startsAt: at(4, 9), endsAt: at(4, 9, 30) }]);
  seedEvent(h, "cev_full001", "cld_work01", at(1, 17), at(1, 20));
  const full = await findTime(h.ctx, { people: ["usr_maya01"], durationMinutes: 60, from: at(1, 17), to: at(1, 20), workingHoursOnly: false });
  assert.deepEqual(full.slots, []);
});

test("Find a time uses the caller's working hours and time zone", async () => {
  const h = harness({ timezone: "Asia/Karachi", workingHours: { days: [1, 2, 3, 4, 5], from: "09:00", to: "17:00" } });
  seedCalendar(h, "cld_work01");
  const out = await findTime(h.ctx, { people: ["usr_maya01"], durationMinutes: 60, from: at(1, 0), to: at(1, 23), limit: 1 });
  assert.deepEqual(out.slots, [{ startsAt: at(1, 4), endsAt: at(1, 5) }], "09:00 in Karachi is 04:00 UTC");
  const narrow = harness({ workingHours: { days: [1], from: "13:00", to: "14:00" } });
  seedCalendar(narrow, "cld_work01");
  const mon = await findTime(narrow.ctx, { people: ["usr_maya01"], durationMinutes: 60, from: at(0, 0), to: at(8, 0), limit: 5 });
  assert.deepEqual(mon.slots.map((s) => s.startsAt), [at(4, 13)], "only Monday 13:00 fits a one-hour window");
});

test("Find a time without settings falls back to the default week, and bad asks are refused", async () => {
  const h = busyWorld();
  h.fail("settings.get");
  const out = await findTime(h.ctx, { people: ["usr_maya01"], durationMinutes: 30, from: at(1, 8), to: at(1, 12), limit: 1 });
  assert.deepEqual(out.slots, [{ startsAt: at(1, 10, 30), endsAt: at(1, 11) }]);
  await refused(findTime(h.ctx, { people: ["usr_maya01"], durationMinutes: 4, from: at(1, 8), to: at(1, 12) }), "validation.bad_input");
  await refused(findTime(h.ctx, { people: ["usr_maya01"], durationMinutes: 30, from: at(1, 8), to: at(1, 12), limit: 21 }), "validation.bad_input");
  await refused(findTime(h.ctx, { people: [], durationMinutes: 30, from: at(1, 8), to: at(1, 12) }), "validation.bad_input");
});

// ---- the merge with meetings

const ZOOM = { id: "rec_zoom001", startsAt: at(1, 10, 2), endsAt: at(1, 11), emails: ["pat@acme.test"], sources: ["zoom"], joinUrl: "https://zoom.us/j/123" };

test("a calendar event and a Zoom meeting for one call merge on time plus guests into one Meeting", async () => {
  const h = harness({ meetings: [ZOOM] });
  seedCalendar(h, "cld_goog01", { provider: "google", connectionId: "con_g01", remoteId: "primary" });
  const out = await ingestEvent(h.ctx, {
    source: "google", calendarId: "cld_goog01", providerId: "g_evt_1", title: "Intake", startsAt: at(1, 10), endsAt: at(1, 11), attendees: [{ email: "pat@acme.test" }, { email: "maya@vyre.test" }],
  });
  assert.deepEqual(contractErrors("calendar.ingest_event", "out", out), []);
  assert.deepEqual([out.meetingId, out.merged], ["rec_zoom001", true]);
  assert.deepEqual(h.meetings[0]!.sources, ["zoom", "calendar"]);
  assert.equal(h.rows(`SELECT "meetingId" FROM calendar_event WHERE id = ?`, out.eventId)[0]!.meetingId, "rec_zoom001");
  const asked = h.calls("meetings.ingest")[0]!.input;
  assert.deepEqual([asked.source, asked.providerRef, asked.calendarEventId, asked.title], ["calendar", "g_evt_1", out.eventId, "Intake"]);
  assert.deepEqual(asked.attendees, [{ email: "pat@acme.test" }, { email: "maya@vyre.test" }]);
});

test("an event at another time, or with other guests, becomes its own Meeting", async () => {
  const h = harness({ meetings: [ZOOM] });
  seedCalendar(h, "cld_goog01", { provider: "google", connectionId: "con_g01", remoteId: "primary" });
  const later = await ingestEvent(h.ctx, { source: "google", calendarId: "cld_goog01", providerId: "g_evt_2", title: "Later", startsAt: at(1, 14), endsAt: at(1, 15), attendees: [{ email: "pat@acme.test" }] });
  assert.equal(later.merged, false);
  assert.notEqual(later.meetingId, "rec_zoom001");
  const others = await ingestEvent(h.ctx, { source: "google", calendarId: "cld_goog01", providerId: "g_evt_3", title: "Other", startsAt: at(1, 10), endsAt: at(1, 11), attendees: [{ email: "sam@acme.test" }] });
  assert.equal(others.merged, false);
  assert.equal(h.meetings.length, 3);
});

test("two events that share a join link merge even when the guests differ", async () => {
  const h = harness({ meetings: [ZOOM] });
  seedCalendar(h, "cld_goog01", { provider: "google", connectionId: "con_g01", remoteId: "primary" });
  const out = await ingestEvent(h.ctx, {
    source: "google", calendarId: "cld_goog01", providerId: "g_evt_4", title: "Same link", startsAt: at(2, 9), endsAt: at(2, 10), joinUrl: "https://zoom.us/j/123", attendees: [{ email: "sam@acme.test" }],
  });
  assert.deepEqual([out.meetingId, out.merged], ["rec_zoom001", true]);
  assert.equal(h.rows(`SELECT "joinProvider" FROM calendar_event WHERE id = ?`, out.eventId)[0]!.joinProvider, "zoom");
});

test("an event with no guests, or an all-day one, is a block of time and never a Meeting; a meetings module that is down never fails the event", async () => {
  const h = harness();
  seedCalendar(h, "cld_goog01", { provider: "google", connectionId: "con_g01", remoteId: "primary" });
  const solo = await ingestEvent(h.ctx, { source: "google", calendarId: "cld_goog01", providerId: "g_evt_5", title: "Focus", startsAt: at(1, 9), endsAt: at(1, 10) });
  const allDay = await ingestEvent(h.ctx, { source: "google", calendarId: "cld_goog01", providerId: "g_evt_6", title: "Away", startsAt: at(1), endsAt: at(2), allDay: true, attendees: [{ email: "pat@acme.test" }] });
  assert.deepEqual([solo.merged, solo.meetingId, allDay.merged, allDay.meetingId], [false, undefined, false, undefined]);
  assert.equal(h.calls("meetings.ingest").length, 0);
  h.fail("meetings.ingest");
  const down = await createEvent(h.ctx, { calendarId: "cld_goog01", title: "Call", startsAt: at(1, 12), endsAt: at(1, 13), attendees: [{ email: "pat@acme.test" }] });
  assert.equal(down.event.meetingId, undefined);
  assert.equal(h.named("calendar_event.created").length, 3);
});

test("an event made here with guests joins a Meeting too, and a change to its time or guests is sent on", async () => {
  const h = harness({ meetings: [ZOOM] });
  seedCalendar(h, "cld_work01");
  const { event } = await createEvent(h.ctx, { calendarId: "cld_work01", title: "Intake", startsAt: at(1, 10), endsAt: at(1, 11), attendees: [{ email: "pat@acme.test" }] });
  assert.equal(event.meetingId, "rec_zoom001");
  assert.equal(h.calls("meetings.ingest").length, 1);
  await updateEvent(h.ctx, { eventId: event.id, location: "Room 9" });
  assert.equal(h.calls("meetings.ingest").length, 1, "a location is not part of a Meeting");
  await updateEvent(h.ctx, { eventId: event.id, startsAt: at(1, 10, 15), endsAt: at(1, 11, 15) });
  assert.equal(h.calls("meetings.ingest").length, 2);
  assert.equal(h.calls("meetings.ingest")[1]!.input.startsAt, at(1, 10, 15));
  assert.equal(h.calls("meetings.ingest")[1]!.input.providerRef, event.id, "a local event is known to meetings by its own id");
});
