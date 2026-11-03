// The provider push (lane l-calevents): an event made, changed or deleted in Vyre goes to its Google or Microsoft calendar, once, with a key a retry repeats; the provider's answer is
// Vyre's copy; a Meet link comes from Google's createRequest, a Teams meeting from Graph's isOnlineMeeting, a Zoom meeting from the zoom connection with its link and dial-in in the
// event; a provider whose copy moved on wins, with a quiet line. Recorded provider answers only (fixtures/provider-answers.ts); nothing reaches a provider.
// @reads /modules/calendar/handlers/push.ts
// @reads /modules/calendar/handlers/events.ts
import test from "node:test";
import assert from "node:assert/strict";
import { fail } from "../../../host/src/routes/errors.ts";
import { createEvent, deleteEvent, fromGoogle, fromGraph, getEvent, updateEvent } from "../handlers/index.ts";
import { HOUR, at, codeOf, contractErrors, harness, seedCalendar } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";
import { GOOGLE_CREATED_WITH_MEET, GRAPH_CREATED_WITH_TEAMS, ZOOM_MEETING } from "../fixtures/provider-answers.ts";

type Json = Record<string, unknown>;
const GOOG = "cld_goog01", MS = "cld_ms0001", LOCAL = "cld_local1";
const iso = (ts: number): string => new Date(ts).toISOString();
const S = at(1, 14), E = at(1, 14, 45);

function world(): Harness {
  const h = harness();
  seedCalendar(h, GOOG, { provider: "google", title: "Work Google", connectionId: "con_g01", remoteId: "primary" });
  seedCalendar(h, MS, { provider: "microsoft", title: "Outlook", connectionId: "con_m01", remoteId: "default" });
  seedCalendar(h, LOCAL, { provider: "local", title: "Personal" });
  // Google answers with a Meet only when one was asked for (conference: true), as the real API does
  h.script("google.calendar.create_event", (i) => { const e = GOOGLE_CREATED_WITH_MEET(String(i["summary"]), String(obj(i["start"])["dateTime"]), String(obj(i["end"])["dateTime"])); return { event: i["conference"] ? e : { ...e, hangoutLink: undefined, conferenceData: undefined, ...(i["description"] ? { description: i["description"] } : {}) } }; });
  h.script("ms.calendar.create_event", (i) => ({ event: GRAPH_CREATED_WITH_TEAMS(String(i["subject"]), String(obj(i["start"])["dateTime"]), String(obj(i["end"])["dateTime"])) }));
  h.script("zoom.meetings.create", () => ({ meeting: ZOOM_MEETING }));
  return h;
}
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const guests = [{ email: "maya@vyre.test" }, { email: "pat@client.test" }];

test("a new event on a Google calendar goes to Google once, with a Meet createRequest, and takes Google's answer: the link, the dial-in, the guests", async () => {
  const h = world();
  const out = await createEvent(h.ctx, { calendarId: GOOG, title: "Lease call", startsAt: S, endsAt: E, attendees: guests, video: "meet", idempotencyKey: "k-lease" });
  const calls = h.calls("google.calendar.create_event");
  assert.equal(calls.length, 1, "pushed once");
  const sent = calls[0]!.input;
  assert.deepEqual([sent["calendarId"], sent["connectionId"], sent["summary"], sent["conference"], sent["sendUpdates"], sent["idempotencyKey"]], ["primary", "con_g01", "Lease call", true, "all", "cal:create:k-lease:google"]);
  assert.deepEqual([obj(sent["start"])["dateTime"], obj(sent["end"])["dateTime"]], [iso(S), iso(E)]);
  assert.deepEqual(contractErrors("calendar.create_event", "out", out), []);
  assert.deepEqual([out.event.joinUrl, out.event.joinProvider, out.event.organizer], ["https://meet.google.com/abc-defg-hij", "meet", "maya@vyre.test"]);
  assert.deepEqual(out.event.conference, { provider: "meet", url: "https://meet.google.com/abc-defg-hij", meetingId: "abc-defg-hij", dialIns: [{ number: "+1 415-555-0161", pin: "264326521#", label: "US" }] });
  assert.equal(h.rows(`SELECT * FROM calendar_event WHERE "providerId" = ?`, "g_evt_7k2").length, 1, "Vyre's copy is the provider's event");
  // a retry of the same create repeats the same key, so the host's idempotency answers it and Google never sees a second event
  await createEvent(h.ctx, { calendarId: GOOG, title: "Lease call", startsAt: S, endsAt: E, attendees: guests, video: "meet", idempotencyKey: "k-lease" });
  assert.equal(h.calls("google.calendar.create_event")[1]?.input["idempotencyKey"], "cal:create:k-lease:google");
});

test("on a Microsoft calendar a Teams meeting comes with the event (isOnlineMeeting), its join link and dial-in read back from onlineMeeting", async () => {
  const h = world();
  const out = await createEvent(h.ctx, { calendarId: MS, title: "Board prep", startsAt: S, endsAt: E, attendees: [{ email: "pat@client.test" }], video: "teams", idempotencyKey: "k-board" });
  const sent = h.calls("ms.calendar.create_event")[0]!.input;
  assert.deepEqual([sent["teamsMeeting"], sent["subject"], sent["calendarId"], obj(sent["start"])["timeZone"]], [true, "Board prep", undefined, "UTC"], "the default Outlook calendar has no id of its own");
  assert.deepEqual(out.event.conference, { provider: "teams", url: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_NjA4%40thread.v2/0", meetingId: "482991733", dialIns: [{ number: "+1 323-555-0144", pin: "482991733#" }] });
  assert.equal(out.event.joinUrl, "https://teams.microsoft.com/l/meetup-join/19%3ameeting_NjA4%40thread.v2/0");
});

test("Zoom: the meeting is made through the zoom connection first, and its link, passcode and dial-in go into the event Google sends", async () => {
  const h = world();
  const out = await createEvent(h.ctx, { calendarId: GOOG, title: "Lease call", startsAt: S, endsAt: E, attendees: guests, video: "zoom", idempotencyKey: "k-zoom" });
  const z = h.calls("zoom.meetings.create");
  assert.deepEqual([z.length, z[0]?.input["topic"], z[0]?.input["startTime"], z[0]?.input["durationMinutes"], z[0]?.input["idempotencyKey"]], [1, "Lease call", S, 45, "cal:create:k-zoom:zoom"]);
  const g = h.calls("google.calendar.create_event")[0]!.input;
  assert.equal(g["conference"], undefined, "no Meet link on a Zoom call");
  assert.match(String(g["description"]), /Join Zoom: https:\/\/us02web\.zoom\.us\/j\/84512345678\?pwd=Q2x\nMeeting ID: 845 1234 5678 · Passcode: 551203\nDial in: \+1 669 444 9171, \+1 646 931 3860, then 84512345678#/);
  assert.deepEqual(out.event.conference, { provider: "zoom", url: ZOOM_MEETING.joinUrl, meetingId: "84512345678", passcode: "551203", dialIns: [{ number: "+1 669 444 9171", pin: "84512345678#", label: "US" }, { number: "+1 646 931 3860", pin: "84512345678#", label: "US" }] });
  assert.deepEqual([out.event.joinProvider, out.event.joinUrl], ["zoom", ZOOM_MEETING.joinUrl]);
  // a local calendar keeps the event to itself, and still gets the Zoom call
  const local = await createEvent(h.ctx, { calendarId: LOCAL, title: "Run", startsAt: S, endsAt: E, video: "zoom" });
  assert.equal(h.calls("google.calendar.create_event").length + h.calls("ms.calendar.create_event").length, 1, "nothing pushed for a local calendar");
  assert.equal(local.event.conference?.provider, "zoom");
  await assert.rejects(createEvent(h.ctx, { calendarId: LOCAL, title: "Run", startsAt: S, endsAt: E, video: "meet" }), (e: unknown) => codeOf(e) === "validation.precondition_failed", "Meet needs a Google calendar");
});

async function made(h: Harness): Promise<string> {
  const out = await createEvent(h.ctx, { calendarId: GOOG, title: "Lease call", startsAt: S, endsAt: E, attendees: guests, idempotencyKey: "k-1" });
  return out.event.id;
}

test("an edit goes to Google as a change of the provider's event (title, time, guests), and Google's answer is Vyre's copy", async () => {
  const h = world();
  const id = await made(h);
  h.script("google.calendar.update_event", (i) => ({ event: { ...GOOGLE_CREATED_WITH_MEET(String(i["summary"] ?? "Lease call"), String(obj(i["start"])["dateTime"] ?? iso(S)), String(obj(i["end"])["dateTime"] ?? iso(E))), hangoutLink: undefined, conferenceData: undefined } }));
  const out = await updateEvent(h.ctx, { eventId: id, title: "Lease call: draft 3", startsAt: S + HOUR, endsAt: E + HOUR, attendees: [{ email: "maya@vyre.test" }] });
  const sent = h.calls("google.calendar.update_event")[0]!.input;
  assert.deepEqual([sent["eventId"], sent["summary"], obj(sent["start"])["dateTime"], obj(sent["end"])["dateTime"], sent["attendees"], sent["sendUpdates"]], ["g_evt_7k2", "Lease call: draft 3", iso(S + HOUR), iso(E + HOUR), [{ email: "maya@vyre.test" }], "all"]);
  assert.match(String(sent["idempotencyKey"]), /^cal:update:cev_[a-z0-9]+:\d+:google$/);
  assert.deepEqual([out.event.title, out.event.startsAt], ["Lease call: draft 3", S + HOUR]);
  assert.deepEqual(out.event.attendees.map((a) => [a.email, a.response]), [["maya@vyre.test", "accepted"], ["pat@client.test", "needs_action"]], "Google's guest list is the one Vyre keeps");
  // an agenda is Vyre's own: no push
  await updateEvent(h.ctx, { eventId: id, agenda: "Clause 4" });
  assert.equal(h.calls("google.calendar.update_event").length, 1);
});

test("Add a video call: Meet is asked of Google with the change; Zoom is made and written in", async () => {
  const h = world();
  const id = await made(h);
  h.script("google.calendar.update_event", (i) => ({ event: GOOGLE_CREATED_WITH_MEET("Lease call", iso(S), iso(E)) }));
  const meet = await updateEvent(h.ctx, { eventId: id, video: "meet" });
  assert.equal(h.calls("google.calendar.update_event")[0]?.input["conference"], true);
  assert.equal(meet.event.conference?.provider, "meet");
  const h2 = world();
  const id2 = await made(h2);
  h2.script("google.calendar.update_event", (i) => ({ event: { ...GOOGLE_CREATED_WITH_MEET("Lease call", iso(S), iso(E)), hangoutLink: undefined, conferenceData: undefined, description: i["description"] } }));
  const zoom = await updateEvent(h2.ctx, { eventId: id2, video: "zoom" });
  assert.match(String(h2.calls("google.calendar.update_event")[0]?.input["description"]), /Join Zoom: https:\/\/us02web\.zoom\.us/);
  assert.deepEqual([zoom.event.conference?.provider, zoom.event.joinUrl], ["zoom", ZOOM_MEETING.joinUrl]);
});

test("a provider whose copy moved on wins: its version comes back, nothing is forced, and the caller is told quietly", async () => {
  const h = world();
  const id = await made(h);
  h.script("google.calendar.update_event", () => { throw fail("validation.precondition_failed", "0123456789abcdef0123456789abcdef", { message: "Google refused because the item changed." }); });
  h.script("google.calendar.get_event", () => ({ event: { ...GOOGLE_CREATED_WITH_MEET("Lease call (moved by Pat)", iso(S + 2 * HOUR), iso(E + 2 * HOUR)) } }));
  const out = await updateEvent(h.ctx, { eventId: id, title: "Mine" });
  assert.deepEqual(contractErrors("calendar.update_event", "out", out), []);
  assert.equal(out.notice, "This event changed in Google Calendar meanwhile, so Vyre kept that version.");
  assert.deepEqual([out.event.title, out.event.startsAt], ["Lease call (moved by Pat)", S + 2 * HOUR]);
});

test("delete goes to Google first (Google tells the guests); one already gone there is fine", async () => {
  const h = world();
  const id = await made(h);
  h.script("google.calendar.delete_event", () => ({ deleted: true }));
  await deleteEvent(h.ctx, { eventId: id });
  assert.deepEqual([h.calls("google.calendar.delete_event")[0]?.input["eventId"], h.calls("google.calendar.delete_event")[0]?.input["sendUpdates"]], ["g_evt_7k2", "all"]);
  const id2 = (await createEvent(h.ctx, { calendarId: GOOG, title: "Gone", startsAt: S, endsAt: E, idempotencyKey: "k-2" })).event.id;
  h.script("google.calendar.delete_event", () => { throw fail("validation.not_found", "0123456789abcdef0123456789abcdef", { message: "Google has no such item." }); });
  assert.deepEqual(await deleteEvent(h.ctx, { eventId: id2 }), { deleted: true });
});

test("All events of a repeating event go to the provider once, on the series master, moved by the same amount", async () => {
  const h = world();
  const inst = (n: number, day: number) => ({ id: `sync_${n}`, status: "confirmed", summary: "Weekly sync", start: { dateTime: iso(at(day, 9, 30)) }, end: { dateTime: iso(at(day, 10)) }, recurringEventId: "sync" });
  h.google.pages.push({ events: [inst(1, 1), inst(2, 8), inst(3, 15)] });
  const { pullProviderCalendars } = await import("../handlers/index.ts");
  await pullProviderCalendars(h.as({ kind: "service", id: "svc_host" }));
  const id = String(h.rows(`SELECT * FROM calendar_event WHERE "providerId" = ?`, "sync_1")[0]!.id);
  h.script("google.calendar.get_event", () => ({ event: { id: "sync", summary: "Weekly sync", start: { dateTime: iso(at(-20, 9, 30)) }, end: { dateTime: iso(at(-20, 10)) } } }));
  h.script("google.calendar.update_event", (i) => ({ event: { id: String(i["eventId"]), summary: i["summary"], start: i["start"] ?? {}, end: i["end"] ?? {} } }));
  const out = await updateEvent(h.ctx, { eventId: id, title: "Team sync", startsAt: at(1, 10), endsAt: at(1, 10, 30), scope: "all" });
  assert.equal(out.changed, 3);
  const ups = h.calls("google.calendar.update_event");
  assert.equal(ups.length, 1, "one change, on the series");
  assert.deepEqual([ups[0]!.input["eventId"], ups[0]!.input["summary"], obj(ups[0]!.input["start"])["dateTime"]], ["sync", "Team sync", iso(at(-20, 10))], "the master moves by the same half hour");
});

test("detection: Google's conferenceData and Graph's onlineMeeting become the event's conference on a pull", async () => {
  const g = fromGoogle(GOOG, GOOGLE_CREATED_WITH_MEET("Lease call", iso(S), iso(E)));
  assert.deepEqual(g?.conference, { provider: "meet", url: "https://meet.google.com/abc-defg-hij", meetingId: "abc-defg-hij", dialIns: [{ number: "+1 415-555-0161", pin: "264326521#", label: "US" }] });
  const zoomOnGoogle = fromGoogle(GOOG, { id: "z1", summary: "Zoom call", start: { dateTime: iso(S) }, end: { dateTime: iso(E) }, conferenceData: { conferenceSolution: { key: { type: "addOn" }, name: "Zoom Meeting" }, conferenceId: "845", entryPoints: [{ entryPointType: "video", uri: "https://us02web.zoom.us/j/845", passcode: "9911" }] } });
  assert.deepEqual(zoomOnGoogle?.conference, { provider: "zoom", url: "https://us02web.zoom.us/j/845", meetingId: "845", passcode: "9911", dialIns: [] });
  const t = fromGraph(MS, GRAPH_CREATED_WITH_TEAMS("Board prep", "2025-10-10T09:00:00", "2025-10-10T10:00:00"));
  assert.equal(t?.conference?.provider, "teams");
  assert.equal(fromGoogle(GOOG, { id: "p", summary: "Plain", start: { dateTime: iso(S) }, end: { dateTime: iso(E) } })?.conference, undefined);
  const h = world();
  const { ingestEvent } = await import("../handlers/index.ts");
  const landed = await ingestEvent(h.as({ kind: "service", id: "svc_host" }), g!);
  assert.equal((await getEvent(h.ctx, { eventId: landed.eventId })).event.conference?.dialIns[0]?.pin, "264326521#");
});
