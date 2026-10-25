// The Meeting itself (P-L5_10; spec 2.18 Meetings, Meeting sources in v1; 3.3 flow 5): a calendar event and a provider meeting become one Meeting (same id, same link, or same time and people), merge and
// unmerge, live and ended, attendees matched to contacts, list, schedule and cancel. Records, calendar, zoom and contacts are scripted capabilities, each call checked against its frozen contract.
// @reads /modules/meetings/migrations/0001_meetings.sql
// @reads /modules/meetings/handlers/meetings.ts
import test from "node:test";
import assert from "node:assert/strict";
import * as m from "../handlers/index.ts";
import { EVENT, HOUR, JOIN, MAYA, NOW, PAT, START, ZOOM_ID, contractErrors, eventErrors, harness, refusedWith } from "../fixtures/harness.ts";

type Json = Record<string, unknown>;
const out = (x: unknown): Json => x as Json;
const DANA = { email: "dana@firm.example", name: "Dana" };
const PATA = { email: "pat@client.example" };

const calendar = (o: Json = {}) => ({ source: "calendar" as const, providerRef: EVENT, calendarEventId: EVENT, title: "Estate consult", startsAt: START, endsAt: START + HOUR, attendees: [DANA, PATA], ...o });
const zoom = (o: Json = {}) => ({ source: "zoom" as const, providerRef: ZOOM_ID, title: "Estate consult (Zoom)", startsAt: START + 5 * 60_000, endsAt: START + HOUR, joinUrl: JOIN, attendees: [{ email: "dana@firm.example" }], ...o });

test("a calendar event becomes a Meeting; the same event again changes it, not the count", async () => {
  const h = harness();
  h.contacts.set("pat@client.example", PAT);
  const first = out(await m.ingest(h.ctx, calendar()));
  assert.deepEqual(contractErrors("meetings.ingest", "out", first), []);
  assert.deepEqual([first.created, first.merged], [true, false]);
  const f = h.fields(String(first.meetingId));
  assert.deepEqual([f["title"], f["starts_at"], f["ends_at"], f["provider"], f["status"], f["attendees"], f["calendar_event_id"], f["recording_state"]], ["Estate consult", START, START + HOUR, "none", "scheduled", [PAT], EVENT, "none"]);
  assert.equal(h.store.size, 1);

  const again = out(await m.ingest(h.ctx, calendar({ title: "Estate consult, moved", startsAt: START + HOUR, endsAt: START + 2 * HOUR, joinUrl: "https://meet.google.com/aaa-bbbb-ccc" })));
  assert.deepEqual([again.meetingId, again.created, again.merged], [first.meetingId, false, false]);
  const g = h.fields(String(first.meetingId));
  assert.deepEqual([g["title"], g["starts_at"], g["join_url"], g["provider"]], ["Estate consult, moved", START + HOUR, "https://meet.google.com/aaa-bbbb-ccc", "meet"]);
  assert.equal(h.store.size, 1);
  assert.equal(h.named("meeting.merged").length, 0, "the same event is not a merge");
});

test("a Zoom meeting merges into the calendar event: by link, by time and people, and never into a different Zoom meeting", async () => {
  const h = harness();
  const cal = out(await m.ingest(h.ctx, calendar()));
  // time and attendees: the host is a guest of the event and the times are within 15 minutes
  const z = out(await m.ingest(h.ctx, zoom()));
  assert.deepEqual([z.meetingId, z.created, z.merged], [cal.meetingId, false, true]);
  assert.deepEqual(h.named("meeting.merged")[0]?.payload, { meetingId: cal.meetingId, providerRef: ZOOM_ID, by: "time_and_attendees" });
  assert.deepEqual(eventErrors("meeting.merged", h.named("meeting.merged")[0]?.payload), []);
  const f = h.fields(String(cal.meetingId));
  assert.deepEqual([f["provider"], f["join_url"], f["provider_ref"]], ["zoom", JOIN, ZOOM_ID]);
  assert.equal(h.store.size, 1);
  // Zoom sending its meeting again is the same meeting and says nothing
  assert.deepEqual(out(await m.ingest(h.ctx, zoom())), { meetingId: cal.meetingId, created: false, merged: false });
  assert.equal(h.named("meeting.merged").length, 1);

  // another Zoom meeting at the same time with the same people is another call
  const other = out(await m.ingest(h.ctx, zoom({ providerRef: "99999999999", joinUrl: "https://us02web.zoom.us/j/99999999999" })));
  assert.equal(other.created, true);
  assert.notEqual(other.meetingId, cal.meetingId);

  // by link: a second calendar event that carries the Zoom link joins that meeting, whoever is on it
  const viaLink = out(await m.ingest(h.ctx, calendar({ providerRef: "cev_evt00002", calendarEventId: "cev_evt00002", startsAt: START + 9 * HOUR, endsAt: START + 10 * HOUR, joinUrl: `${JOIN.split("?")[0]}/`, attendees: [{ email: "someone@else.example" }] })));
  assert.deepEqual([viaLink.meetingId, viaLink.merged], [cal.meetingId, true]);
  assert.deepEqual(h.named("meeting.merged")[1]?.payload, { meetingId: cal.meetingId, eventId: "cev_evt00002", by: "link" });

  // far apart or with other people: not merged
  const later = out(await m.ingest(h.ctx, calendar({ providerRef: "cev_evt00003", calendarEventId: "cev_evt00003", startsAt: START + 3 * HOUR, endsAt: START + 4 * HOUR })));
  assert.equal(later.created, true, "same people, three hours later");
  const strangers = out(await m.ingest(h.ctx, calendar({ providerRef: "cev_evt00004", calendarEventId: "cev_evt00004", attendees: [{ email: "nobody@else.example" }] })));
  assert.equal(strangers.created, true, "same time, different people");
});

test("ingest checks its input: source, ids, times, link, status, attendees", async () => {
  const h = harness();
  const bad = async (o: Json): Promise<string> => refusedWith(m.ingest(h.ctx, calendar(o) as Parameters<typeof m.ingest>[1]));
  assert.equal(await bad({ source: "skype" }), "validation.bad_input");
  assert.equal(await bad({ providerRef: "" }), "validation.bad_input");
  assert.equal(await bad({ calendarEventId: "evt" }), "validation.bad_input");
  assert.equal(await bad({ startsAt: 1.5 }), "validation.bad_input");
  assert.equal(await bad({ endsAt: START - 1 }), "validation.bad_input");
  assert.equal(await bad({ joinUrl: "http://insecure.example" }), "validation.bad_input");
  assert.equal(await bad({ status: "maybe" }), "validation.bad_input");
  assert.equal(await bad({ attendees: [{ email: "not an email" }] }), "validation.bad_input");
  assert.equal(await bad({ attendees: [{ email: "a@b.example", contactId: "pat" }] }), "validation.bad_input");
  assert.equal(await bad({ attendees: "dana" }), "validation.bad_input");
  assert.equal(h.store.size, 0);
  // an address given twice is one attendee, in any case
  const r = out(await m.ingest(h.ctx, calendar({ attendees: [{ email: "A@B.example" }, { email: "a@b.example" }] })));
  assert.equal(h.rows(`SELECT * FROM meetings_link WHERE "recordId" = ?`, String(r.meetingId))[0]?.emails, JSON.stringify(["a@b.example"]));
});

test("live, ended and canceled: each announced once, in order, and a canceled or ended meeting does not come back", async () => {
  const h = harness();
  const id = String(out(await m.ingest(h.ctx, zoom())).meetingId);
  h.contacts.set("dana@firm.example", PAT);
  assert.deepEqual(await m.setMeetingState(h.ctx, { meetingId: id, state: "live" }), { meetingId: id });
  await m.setMeetingState(h.ctx, { meetingId: id, state: "live" });
  assert.deepEqual(h.named("meeting.started").map((e) => e.payload), [{ meetingId: id, provider: "zoom" }]);
  await m.setMeetingState(h.ctx, { meetingId: id, state: "ended" });
  await m.setMeetingState(h.ctx, { meetingId: id, state: "ended" });
  assert.deepEqual(h.named("meeting.ended").map((e) => e.payload), [{ meetingId: id, provider: "zoom", attendeeIds: [] }]);
  assert.equal(await refusedWith(m.setMeetingState(h.ctx, { meetingId: id, state: "live" })), "validation.precondition_failed");
  assert.equal(await refusedWith(m.setMeetingState(h.ctx, { meetingId: id, state: "paused" })), "validation.bad_input");
  assert.equal(await refusedWith(m.setMeetingState(h.ctx, { meetingId: "rec_nope", state: "live" })), "validation.not_found");

  // the provider says canceled: the record follows and says so once
  const c = String(out(await m.ingest(h.ctx, calendar({ providerRef: "cev_evt00077", calendarEventId: "cev_evt00077", startsAt: START + 20 * HOUR, endsAt: START + 21 * HOUR, attendees: [{ email: "q@r.example" }] }))).meetingId);
  await m.ingest(h.ctx, calendar({ providerRef: "cev_evt00077", calendarEventId: "cev_evt00077", startsAt: START + 20 * HOUR, endsAt: START + 21 * HOUR, attendees: [{ email: "q@r.example" }], status: "canceled" }));
  await m.ingest(h.ctx, calendar({ providerRef: "cev_evt00077", calendarEventId: "cev_evt00077", startsAt: START + 20 * HOUR, endsAt: START + 21 * HOUR, attendees: [{ email: "q@r.example" }], status: "canceled" }));
  assert.equal(h.fields(c)["status"], "canceled");
  assert.deepEqual(h.named("meeting.canceled").map((e) => e.payload), [{ meetingId: c }]);
  assert.equal(await refusedWith(m.setMeetingState(h.ctx, { meetingId: c, state: "live" })), "validation.precondition_failed");
});

test("merge puts two meetings that were one call together; unmerge splits a calendar event off again", async () => {
  const h = harness();
  const a = String(out(await m.ingest(h.ctx, calendar())).meetingId);
  const b = String(out(await m.ingest(h.ctx, zoom({ startsAt: START + 3 * HOUR, endsAt: START + 4 * HOUR, attendees: [{ email: "other@else.example" }], joinUrl: "https://us02web.zoom.us/j/70000000000", providerRef: "70000000000" }))).meetingId);
  assert.notEqual(a, b);
  await m.attachRecording(h.ctx, { meetingId: b, source: "upload", fileId: "fil_b0000001", transcriptText: "Dana: Hello." });
  await m.setSummary(h.ctx, { meetingId: b, summary: "A summary." });

  assert.equal(await refusedWith(m.merge(h.ctx, { meetingId: a, otherId: a })), "validation.bad_input");
  assert.deepEqual(await m.merge(h.ctx, { meetingId: a, otherId: b }), { meetingId: a });
  assert.equal(h.store.get(b)?.deleted, true, "the other record is gone");
  const f = h.fields(a);
  assert.deepEqual([f["provider_ref"], f["provider"], f["join_url"], f["summary"], f["transcript"], f["recording"], f["recording_state"]], ["70000000000", "zoom", "https://us02web.zoom.us/j/70000000000", "A summary.", "Dana: Hello.", ["fil_b0000001"], "attached"]);
  assert.deepEqual(h.named("meeting.merged").at(-1)?.payload, { meetingId: a, providerRef: "70000000000", by: "person" });
  assert.equal(out(await m.transcriptGet(h.ctx, { meetingId: a })).total, 1, "the words moved with it");
  assert.equal(await refusedWith(m.merge(h.ctx, { meetingId: a, otherId: b })), "validation.not_found");

  // two different Zoom meetings are two calls
  const c = String(out(await m.ingest(h.ctx, zoom({ providerRef: "60000000000", startsAt: START + 30 * HOUR, endsAt: START + 31 * HOUR, joinUrl: "https://us02web.zoom.us/j/60000000000", attendees: [] }))).meetingId);
  assert.equal(await refusedWith(m.merge(h.ctx, { meetingId: a, otherId: c })), "validation.precondition_failed");

  // unmerge: the calendar event is not the whole meeting, so it can go
  h.calendar.events.set(EVENT, { id: EVENT, calendarId: "cld_work0001", title: "Estate consult", startsAt: START, endsAt: START + HOUR, allDay: false, attendees: [{ email: "dana@firm.example" }], joinProvider: "none", recordIds: [], status: "confirmed", version: 1 });
  const split = out(await m.unmerge(h.ctx, { meetingId: a, eventId: EVENT }));
  assert.deepEqual(contractErrors("meetings.unmerge", "out", split), []);
  assert.ok(split.newMeetingId && split.newMeetingId !== a);
  assert.deepEqual([h.fields(String(split.newMeetingId))["calendar_event_id"], h.fields(String(split.newMeetingId))["title"]], [EVENT, "Estate consult"]);
  assert.deepEqual(h.named("meeting.unmerged")[0]?.payload, { meetingId: a, eventId: EVENT });
  assert.equal(await refusedWith(m.unmerge(h.ctx, { meetingId: a, eventId: EVENT })), "validation.precondition_failed", "it is not on this meeting any more");
  assert.equal(await refusedWith(m.unmerge(h.ctx, { meetingId: String(split.newMeetingId), eventId: EVENT })), "validation.precondition_failed", "that meeting is only the event: nothing would be left");
  assert.equal(await refusedWith(m.unmerge(h.ctx, { meetingId: a, eventId: "evt" })), "validation.bad_input");
});

test("attendees are matched to contacts: sure matches link, unsure ones raise one task each, and a second pass asks nobody twice", async () => {
  const h = harness();
  h.contacts.set("pat@client.example", PAT);
  h.unsure.add("dana@firm.example");
  const id = String(out(await m.ingest(h.ctx, { ...calendar(), attendees: [DANA, PATA, { email: "new@person.example" }] })).meetingId);
  h.fields(id)["attendees"] = [];
  const first = out(await m.matchAttendees(h.ctx, { meetingId: id }));
  assert.deepEqual(contractErrors("meetings.match_attendees", "out", first), []);
  assert.deepEqual(first, { matched: 1, unsure: 1 });
  assert.deepEqual(h.fields(id)["attendees"], [PAT]);
  const task = h.calls("tasks.create")[0]?.input;
  assert.deepEqual([task?.title, task?.recordId, task?.assigned], ["Who is dana@firm.example?", id, { kind: "person", id: MAYA }]);
  assert.deepEqual(await m.matchAttendees(h.ctx, { meetingId: id }), { matched: 0, unsure: 0 });
  assert.equal(h.calls("tasks.create").length, 1);
  h.contacts.set("new@person.example", "rec_new0000001");
  assert.deepEqual(await m.matchAttendees(h.ctx, { meetingId: id }), { matched: 1, unsure: 0 });
  assert.deepEqual(h.fields(id)["attendees"], [PAT, "rec_new0000001"]);
  assert.equal(await refusedWith(m.matchAttendees(h.ctx, { meetingId: "rec_nope" })), "validation.not_found");
});

test("the list: by time, contact and status, newest first, in pages", async () => {
  const h = harness();
  h.contacts.set("pat@client.example", PAT);
  const mk = async (n: number, o: Json = {}) => String(out(await m.ingest(h.ctx, calendar({ providerRef: `cev_list000${n}`, calendarEventId: `cev_list000${n}`, title: `M${n}`, startsAt: START + n * 24 * HOUR, endsAt: START + n * 24 * HOUR + HOUR, attendees: [{ email: `p${n}@x.example` }], ...o }))).meetingId);
  const a = await mk(1, { attendees: [PATA] });
  const b = await mk(2);
  const c = await mk(3, { attendees: [PATA], status: "canceled" });
  const all = out(await m.listMeetings(h.ctx, {}));
  assert.deepEqual(contractErrors("meetings.list", "out", all), []);
  assert.deepEqual((all.meetings as Json[]).map((x) => x.id), [c, b, a]);
  assert.deepEqual((out(await m.listMeetings(h.ctx, { contactId: PAT })).meetings as Json[]).map((x) => x.id), [c, a]);
  assert.deepEqual((out(await m.listMeetings(h.ctx, { status: "canceled" })).meetings as Json[]).map((x) => x.id), [c]);
  assert.deepEqual((out(await m.listMeetings(h.ctx, { from: START + 2 * 24 * HOUR, to: START + 3 * 24 * HOUR })).meetings as Json[]).map((x) => x.id), [b]);
  const page = out(await m.listMeetings(h.ctx, { limit: 2 }));
  assert.deepEqual([(page.meetings as Json[]).length, page.next, page.total], [2, "2", 3]);
  assert.deepEqual((out(await m.listMeetings(h.ctx, { limit: 2, cursor: "2" })).meetings as Json[]).map((x) => x.id), [a]);
  assert.equal(await refusedWith(m.listMeetings(h.ctx, { status: "gone" })), "validation.bad_input");
  assert.equal(await refusedWith(m.listMeetings(h.ctx, { from: 1.5 })), "validation.bad_input");
  assert.equal(await refusedWith(m.listMeetings(h.ctx, { contactId: "pat" })), "validation.bad_input");
  assert.equal(await refusedWith(m.listMeetings(h.ctx, { limit: 501 })), "validation.bad_input");
});

test("schedule: a Zoom link, the calendar event and one Meeting in a step; Meet and Teams ask the provider through the event; a missing calendar is said plainly", async () => {
  const h = harness();
  const got = out(await m.schedule(h.ctx, { title: "Intake", startsAt: START, endsAt: START + HOUR, attendees: [DANA, PATA], provider: "zoom", agenda: "Goals", idempotencyKey: "sched-1" }));
  assert.deepEqual(contractErrors("meetings.schedule", "out", got), []);
  assert.equal(got.joinUrl, JOIN);
  assert.deepEqual(h.calls("zoom.meetings.create")[0]?.input, { topic: "Intake", startTime: START, durationMinutes: 60, agenda: "Goals", idempotencyKey: "sched-1:zoom" });
  const ev = h.calls("calendar.create_event")[0]?.input;
  assert.deepEqual([ev?.calendarId, ev?.joinProvider, ev?.idempotencyKey], ["cld_work0001", "zoom", "sched-1:event"]);
  const f = h.fields(String(got.meetingId));
  assert.deepEqual([f["provider"], f["provider_ref"], f["join_url"], f["calendar_event_id"]], ["zoom", ZOOM_ID, JOIN, got.eventId]);
  assert.equal(h.store.size, 1, "one Meeting from the event and the Zoom meeting");

  const meet = out(await m.schedule(h.ctx, { title: "Review", startsAt: START + 24 * HOUR, endsAt: START + 25 * HOUR, attendees: [PATA], provider: "meet", calendarId: "cld_other0001", idempotencyKey: "sched-2" }));
  assert.equal(h.calls("zoom.meetings.create").length, 1, "Meet needs no Zoom");
  assert.deepEqual([h.calls("calendar.create_event")[1]?.input.calendarId, h.calls("calendar.create_event")[1]?.input.joinProvider, meet.joinUrl], ["cld_other0001", "meet", undefined]);

  assert.equal(await refusedWith(m.schedule(h.ctx, { title: "", startsAt: START, endsAt: START + HOUR, attendees: [], provider: "none", idempotencyKey: "k" })), "validation.bad_input");
  assert.equal(await refusedWith(m.schedule(h.ctx, { title: "X", startsAt: START, endsAt: START, attendees: [], provider: "none", idempotencyKey: "k" })), "validation.bad_input");
  assert.equal(await refusedWith(m.schedule(h.ctx, { title: "X", startsAt: START, endsAt: START + HOUR, attendees: [], provider: "skype", idempotencyKey: "k" })), "validation.bad_input");
  assert.equal(await refusedWith(m.schedule(h.ctx, { title: "X", startsAt: START, endsAt: START + HOUR, attendees: [], provider: "none", idempotencyKey: "" })), "validation.bad_input");
  h.script("calendar.list_calendars", () => ({ calendars: [] }));
  assert.equal(await refusedWith(m.schedule(h.ctx, { title: "X", startsAt: START, endsAt: START + HOUR, attendees: [], provider: "none", idempotencyKey: "k2" })), "validation.precondition_failed");
  h.script("zoom.meetings.create", () => { throw h.err("provider.auth_failed", "no"); });
  const before = h.calls("calendar.create_event").length;
  assert.equal(await refusedWith(m.schedule(h.ctx, { title: "X", startsAt: START, endsAt: START + HOUR, attendees: [], provider: "zoom", calendarId: "cld_work0001", idempotencyKey: "k3" })), "provider.auth_failed");
  assert.equal(h.calls("calendar.create_event").length, before, "no calendar event for a Zoom link that could not be made");
});

test("cancel: the record, its calendar events and the Zoom meeting; a missing one is fine, a provider refusal is not; twice is once", async () => {
  const h = harness();
  const id = String(out(await m.ingest(h.ctx, calendar())).meetingId);
  await m.ingest(h.ctx, zoom());
  h.calendar.events.set(EVENT, { id: EVENT });
  assert.deepEqual(await m.cancel(h.ctx, { meetingId: id }), { meetingId: id });
  assert.deepEqual(h.calendar.deleted, [EVENT]);
  assert.deepEqual(h.calls("zoom.meetings.delete")[0]?.input, { meetingId: ZOOM_ID, idempotencyKey: `meeting_cancel:${id}:zoom` });
  assert.equal(h.fields(id)["status"], "canceled");
  assert.deepEqual(h.named("meeting.canceled").map((e) => e.payload), [{ meetingId: id }]);
  await m.cancel(h.ctx, { meetingId: id });
  assert.equal(h.named("meeting.canceled").length, 1);
  assert.equal(h.calls("zoom.meetings.delete").length, 1);

  const other = String(out(await m.ingest(h.ctx, zoom({ providerRef: "50000000000", joinUrl: "https://us02web.zoom.us/j/50000000000", startsAt: START + 50 * HOUR, endsAt: START + 51 * HOUR, attendees: [] }))).meetingId);
  h.script("zoom.meetings.delete", () => { throw h.err("provider.auth_failed", "no"); });
  assert.equal(await refusedWith(m.cancel(h.ctx, { meetingId: other })), "provider.auth_failed");
  assert.equal(h.fields(other)["status"], "scheduled", "a refusal leaves the meeting as it was");
  h.script("zoom.meetings.delete", () => { throw h.err("validation.not_found", "gone"); });
  assert.deepEqual(await m.cancel(h.ctx, { meetingId: other }), { meetingId: other });
  assert.equal(await refusedWith(m.cancel(h.ctx, { meetingId: "rec_nope" })), "validation.not_found");
  assert.ok(NOW > 0);
});
