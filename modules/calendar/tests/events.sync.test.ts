// Provider events landing in the calendar (calendar.ingest_event), the pull behind calendar.sync_now for Google and Microsoft, and the sync health read. Replay only:
// the provider capabilities are scripted stand-ins that answer in the frozen shapes; nothing here reaches a provider.
import test from "node:test";
import assert from "node:assert/strict";
import { fromGoogle, fromGraph, health, ingestEvent, syncNow } from "../handlers/index.ts";
import { at, codeOf, contractErrors, HOUR, harness, seedCalendar } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

async function refused(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e: unknown) => {
    assert.equal(codeOf(e), code);
    return true;
  });
}

const GOOG = "cld_goog01";
const MS = "cld_ms0001";

function world(): Harness {
  const h = harness();
  seedCalendar(h, GOOG, { provider: "google", title: "Work Google", connectionId: "con_g01", remoteId: "primary" });
  return h;
}
function both(): Harness {
  const h = world();
  seedCalendar(h, MS, { provider: "microsoft", title: "Outlook", connectionId: "con_m01", remoteId: "AAMkAGI2" });
  return h;
}

const iso = (ts: number): string => new Date(ts).toISOString();
const gev = (id: string, title: string, s: number, e: number, extra: Record<string, unknown> = {}) => ({
  id, status: "confirmed", summary: title, start: { dateTime: iso(s) }, end: { dateTime: iso(e) }, ...extra,
});
const eventsOf = (h: Harness, calendarId: string) => h.rows(`SELECT * FROM calendar_event WHERE "calendarId" = ?`, calendarId);
const byProvider = (h: Harness, providerId: string) => h.rows(`SELECT * FROM calendar_event WHERE "providerId" = ?`, providerId)[0]!;

// ---- ingest_event

test("a provider event lands once, and the same notice again changes nothing", async () => {
  const h = world();
  const input = {
    source: "google", calendarId: GOOG, providerId: "g1", title: "Intake", startsAt: at(1, 10), endsAt: at(1, 11), location: "Room 2", organizer: "Omar@Vyre.test",
    attendees: [{ email: "Pat@acme.test", response: "accepted" }],
  } as const;
  assert.deepEqual(contractErrors("calendar.ingest_event", "in", { ...input, attendees: [...input.attendees] }), []);
  const a = await ingestEvent(h.ctx, { ...input, attendees: [...input.attendees] });
  assert.deepEqual(contractErrors("calendar.ingest_event", "out", a), []);
  assert.equal(h.named("calendar_event.created").length, 1);
  assert.deepEqual(h.named("calendar_event.created")[0]!.payload, { eventId: a.eventId, calendarId: GOOG, startsAt: at(1, 10), attendeeCount: 1, source: "google" });
  const row = byProvider(h, "g1");
  assert.deepEqual([row.organizer, row.location, row.status], ["omar@vyre.test", "Room 2", "confirmed"]);
  const b = await ingestEvent(h.ctx, { ...input, attendees: [...input.attendees] });
  assert.equal(b.eventId, a.eventId);
  assert.equal(eventsOf(h, GOOG).length, 1);
  assert.deepEqual([h.named("calendar_event.created").length, h.named("calendar_event.updated").length], [1, 0]);
});

test("a changed provider event updates only what changed and says which fields", async () => {
  const h = world();
  const a = await ingestEvent(h.ctx, { source: "google", calendarId: GOOG, providerId: "g1", title: "Intake", startsAt: at(1, 10), endsAt: at(1, 11), attendees: [{ email: "pat@acme.test" }] });
  await ingestEvent(h.ctx, { source: "google", calendarId: GOOG, providerId: "g1", title: "Intake call", startsAt: at(1, 10, 30), endsAt: at(1, 11, 30) });
  assert.deepEqual(h.named("calendar_event.updated").at(-1)!.payload, { eventId: a.eventId, calendarId: GOOG, fields: ["title", "startsAt", "endsAt"] });
  assert.equal(JSON.parse(String(byProvider(h, "g1").attendees)).length, 1, "a notice that leaves the guests out leaves them alone");
  await ingestEvent(h.ctx, { source: "google", calendarId: GOOG, providerId: "g1", attendees: [{ email: "pat@acme.test", response: "declined" }, { email: "sam@acme.test" }] });
  assert.deepEqual(h.named("calendar_event.updated").at(-1)!.payload.fields, ["attendees"]);
  await ingestEvent(h.ctx, { source: "google", calendarId: GOOG, providerId: "g1", joinUrl: "https://meet.google.com/abc-defg" });
  assert.deepEqual(h.named("calendar_event.updated").at(-1)!.payload.fields, ["joinUrl", "joinProvider"]);
  assert.equal(byProvider(h, "g1").joinProvider, "meet");
});

test("a deleted provider event is deleted here once, stays deleted when a later pull still shows it, and an unknown one leaves a quiet marker", async () => {
  const h = world();
  const a = await ingestEvent(h.ctx, { source: "google", calendarId: GOOG, providerId: "g1", title: "Intake", startsAt: at(1, 10), endsAt: at(1, 11) });
  const gone = await ingestEvent(h.ctx, { source: "google", calendarId: GOOG, providerId: "g1", deleted: true });
  assert.equal(gone.eventId, a.eventId);
  await ingestEvent(h.ctx, { source: "google", calendarId: GOOG, providerId: "g1", deleted: true });
  assert.equal(h.named("calendar_event.deleted").length, 1);
  assert.ok(Number(byProvider(h, "g1").deleted_at) > 0);
  const again = await ingestEvent(h.ctx, { source: "google", calendarId: GOOG, providerId: "g1", title: "Intake", startsAt: at(1, 10), endsAt: at(1, 11) });
  assert.equal(again.eventId, a.eventId);
  assert.ok(Number(byProvider(h, "g1").deleted_at) > 0, "a pull that still shows an event the person deleted does not bring it back");
  const before = h.emitted.length;
  const unknown = await ingestEvent(h.ctx, { source: "google", calendarId: GOOG, providerId: "g_never", deleted: true });
  assert.equal(h.emitted.length, before, "nothing to tell anyone");
  assert.equal((await ingestEvent(h.ctx, { source: "google", calendarId: GOOG, providerId: "g_never", deleted: true })).eventId, unknown.eventId);
});

test("an event with no title is called (No title); a new one needs times, a calendar and a provider id", async () => {
  const h = world();
  await ingestEvent(h.ctx, { source: "google", calendarId: GOOG, providerId: "g1", startsAt: at(1, 10), endsAt: at(1, 11) });
  assert.equal(byProvider(h, "g1").title, "(No title)");
  await refused(ingestEvent(h.ctx, { source: "google", calendarId: GOOG, providerId: "g2", title: "No times" }), "validation.bad_input");
  await refused(ingestEvent(h.ctx, { source: "google", calendarId: "cld_nothing1", providerId: "g3", startsAt: at(1, 10), endsAt: at(1, 11) }), "validation.not_found");
  await refused(ingestEvent(h.ctx, { source: "yahoo" as never, calendarId: GOOG, providerId: "g4", startsAt: at(1, 10), endsAt: at(1, 11) }), "validation.bad_input");
  await refused(ingestEvent(h.ctx, { source: "google", calendarId: GOOG, providerId: " ", startsAt: at(1, 10), endsAt: at(1, 11) }), "validation.bad_input");
  await refused(ingestEvent(h.ctx, { source: "google", calendarId: GOOG, providerId: "g5", startsAt: at(1, 11), endsAt: at(1, 10) }), "validation.bad_input");
  assert.equal(eventsOf(h, GOOG).length, 1);
});

// ---- what the providers send

test("a Google event becomes the ingest input: times in UTC, answers mapped, the Meet link as the join link", () => {
  const out = fromGoogle(GOOG, {
    id: "g1", status: "confirmed", summary: "Intake", start: { dateTime: "2025-10-10T10:00:00+05:00" }, end: { dateTime: "2025-10-10T11:00:00+05:00" }, location: "Room 2",
    hangoutLink: "https://meet.google.com/abc", organizer: { email: "omar@vyre.test" },
    attendees: [{ email: "pat@acme.test", responseStatus: "accepted" }, { email: "sam@acme.test", responseStatus: "needsAction", optional: true }, { email: "", responseStatus: "accepted" }],
  });
  assert.deepEqual(out, {
    source: "google", calendarId: GOOG, providerId: "g1", title: "Intake", startsAt: Date.parse("2025-10-10T05:00:00Z"), endsAt: Date.parse("2025-10-10T06:00:00Z"), allDay: false,
    location: "Room 2", joinUrl: "https://meet.google.com/abc", organizer: "omar@vyre.test",
    attendees: [{ email: "pat@acme.test", response: "accepted" }, { email: "sam@acme.test", response: "needs_action", optional: true }],
  });
});

test("a Google all-day event is read from its dates, a cancelled one is a delete, and one with no id or times is skipped", () => {
  const day = fromGoogle(GOOG, { id: "g2", start: { date: "2025-10-10" }, end: { date: "2025-10-11" } });
  assert.deepEqual(day, { source: "google", calendarId: GOOG, providerId: "g2", title: "(No title)", startsAt: Date.parse("2025-10-10T00:00:00Z"), endsAt: Date.parse("2025-10-11T00:00:00Z"), allDay: true });
  assert.deepEqual(fromGoogle(GOOG, { id: "g3", status: "cancelled" }), { source: "google", calendarId: GOOG, providerId: "g3", deleted: true });
  assert.equal(fromGoogle(GOOG, { start: { date: "2025-10-10" }, end: { date: "2025-10-11" } }), null);
  assert.equal(fromGoogle(GOOG, { id: "g4", start: { dateTime: "not a time" }, end: { dateTime: "2025-10-10T11:00:00Z" } }), null);
});

test("a Graph event becomes the ingest input: a time with no offset is UTC, Teams link, optional guests", () => {
  const out = fromGraph(MS, {
    id: "m1", subject: "Sync", start: { dateTime: "2025-10-10T10:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2025-10-10T11:00:00.0000000", timeZone: "UTC" },
    location: { displayName: "HQ" }, onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/x" }, organizer: { emailAddress: { address: "omar@vyre.test" } },
    attendees: [{ email: "pat@acme.test", response: "tentativelyAccepted", type: "required" }, { email: "sam@acme.test", response: "notResponded", type: "optional" }],
  });
  assert.deepEqual(out, {
    source: "microsoft", calendarId: MS, providerId: "m1", title: "Sync", startsAt: Date.parse("2025-10-10T10:00:00.000Z"), endsAt: Date.parse("2025-10-10T11:00:00.000Z"),
    location: "HQ", joinUrl: "https://teams.microsoft.com/l/meetup-join/x", organizer: "omar@vyre.test",
    attendees: [{ email: "pat@acme.test", response: "tentative" }, { email: "sam@acme.test", response: "needs_action", optional: true }],
  });
  assert.deepEqual(fromGraph(MS, { id: "m2", isCancelled: true }), { source: "microsoft", calendarId: MS, providerId: "m2", deleted: true });
  assert.equal(fromGraph(MS, { id: "m3", start: {}, end: {} }), null);
});

// ---- the Google pull

test("a Google pull reads every page, lands events and deletes, keeps the sync token and says what it did", async () => {
  const h = world();
  h.google.pages = [
    { events: [gev("g1", "Intake", at(1, 10), at(1, 11), { attendees: [{ email: "pat@acme.test", responseStatus: "accepted" }] })], nextPageToken: "p2" },
    { events: [gev("g2", "Lunch", at(1, 12), at(1, 13)), { id: "g3", status: "cancelled" }], nextSyncToken: "sync_1" },
  ];
  const run = await syncNow(h.ctx, { calendarId: GOOG });
  assert.deepEqual(contractErrors("calendar.sync_now", "out", run), []);
  const asked = h.calls("google.calendar.list_events");
  assert.equal(asked.length, 2);
  assert.deepEqual([asked[0]!.input.connectionId, asked[0]!.input.calendarId, asked[0]!.input.syncToken], ["con_g01", "primary", undefined]);
  assert.equal(typeof asked[0]!.input.timeMin, "string");
  assert.equal(asked[1]!.input.pageToken, "p2");
  assert.deepEqual(eventsOf(h, GOOG).map((r) => [r.providerId, r.deleted_at === null]).sort(), [["g1", true], ["g2", true], ["g3", false]]);
  const synced = h.named("calendar.synced");
  assert.deepEqual(synced.map((e) => [e.payload, e.vis]), [[{ calendarId: GOOG, upserted: 2, removed: 1 }, "participants"]]);
  assert.equal(h.rows(`SELECT cursor FROM calendar_sync WHERE "calendarId" = ?`, GOOG)[0]!.cursor, "sync_1");
  assert.equal(h.rows(`SELECT state FROM calendar_list WHERE id = ?`, GOOG)[0]!.state, "syncing");
});

test("the next Google pull asks only for what changed since the token; an expired token reads the window again", async () => {
  const h = world();
  h.google.pages = [{ events: [gev("g1", "Intake", at(1, 10), at(1, 11))], nextSyncToken: "sync_1" }];
  await syncNow(h.ctx, { calendarId: GOOG });
  h.google.pages = [{ events: [], nextSyncToken: "sync_2" }];
  await syncNow(h.ctx, { calendarId: GOOG });
  const second = h.calls("google.calendar.list_events")[1]!.input;
  assert.deepEqual([second.syncToken, second.timeMin], ["sync_1", undefined], "a sync token goes alone");
  assert.equal(h.rows(`SELECT cursor FROM calendar_sync WHERE "calendarId" = ?`, GOOG)[0]!.cursor, "sync_2");
  h.google.refuseToken = true;
  h.google.pages = [{ events: [gev("g1", "Intake, moved", at(1, 10), at(1, 11))], nextSyncToken: "sync_3" }];
  await syncNow(h.ctx, { calendarId: GOOG });
  const tail = h.calls("google.calendar.list_events").slice(-2).map((c) => [c.input.syncToken, typeof c.input.timeMin]);
  assert.deepEqual(tail, [["sync_2", "undefined"], [undefined, "string"]], "the refused token is followed by a read of the window");
  assert.equal(byProvider(h, "g1").title, "Intake, moved");
  assert.equal(h.rows(`SELECT cursor FROM calendar_sync WHERE "calendarId" = ?`, GOOG)[0]!.cursor, "sync_3");
  assert.equal(h.named("calendar.synced").length, 3);
});

test("a pull that fails marks the calendar and tells nobody it synced; the next good pull clears it", async () => {
  const h = world();
  h.fail("google.calendar.list_events");
  const run = await syncNow(h.ctx, { calendarId: GOOG });
  assert.match(run.runId, /^run_[a-z0-9]+$/);
  assert.equal(h.named("calendar.synced").length, 0);
  assert.equal(h.rows(`SELECT state FROM calendar_list WHERE id = ?`, GOOG)[0]!.state, "error");
  assert.equal(h.rows(`SELECT "lastError" FROM calendar_sync WHERE "calendarId" = ?`, GOOG)[0]!.lastError, "internal.unavailable");
  const sick = await health(h.ctx);
  assert.deepEqual(contractErrors("calendar.health", "out", sick), []);
  assert.deepEqual([sick.state, sick.detail], ["down", "Work Google could not sync."]);
  h.fail("google.calendar.list_events", false);
  await syncNow(h.ctx, { calendarId: GOOG });
  assert.equal(h.rows(`SELECT state FROM calendar_list WHERE id = ?`, GOOG)[0]!.state, "syncing");
  assert.deepEqual(await health(h.ctx), { state: "healthy" });
});

test("a sync uses the run the host gave it, skips a paused calendar, and a calendar with no connection reports an error instead of guessing", async () => {
  const h = world();
  const ctx = h.as({ kind: "person", id: "usr_maya01" });
  (ctx as { run?: string }).run = "run_fromhost01";
  assert.equal((await syncNow(ctx, { calendarId: GOOG })).runId, "run_fromhost01");
  seedCalendar(h, "cld_paused1", { provider: "google", state: "paused", connectionId: "con_g02", remoteId: "other" });
  const calls = h.calls("google.calendar.list_events").length;
  await syncNow(h.ctx, { calendarId: "cld_paused1" });
  assert.equal(h.calls("google.calendar.list_events").length, calls, "paused means no pull");
  assert.equal(h.rows(`SELECT state FROM calendar_list WHERE id = ?`, "cld_paused1")[0]!.state, "paused");
  seedCalendar(h, "cld_noconn1", { provider: "microsoft", title: "Detached" });
  await syncNow(h.ctx, { calendarId: "cld_noconn1" });
  assert.equal(h.rows(`SELECT state FROM calendar_list WHERE id = ?`, "cld_noconn1")[0]!.state, "error");
  assert.equal(h.rows(`SELECT "lastError" FROM calendar_sync WHERE "calendarId" = ?`, "cld_noconn1")[0]!.lastError, "validation.precondition_failed");
  seedCalendar(h, "cld_local01", { title: "Local" });
  await syncNow(h.ctx, { calendarId: "cld_local01" });
  assert.deepEqual(h.named("calendar.synced").at(-1)!.payload, { calendarId: "cld_local01", upserted: 0, removed: 0 });
  seedCalendar(h, "cld_theirs1", { owner: "usr_omar01", provider: "google", connectionId: "con_g03", remoteId: "x" });
  h.denied.add("calendar:cld_theirs1");
  await refused(syncNow(h.ctx, { calendarId: "cld_theirs1" }), "permission.no_grant");
  await refused(syncNow(h.ctx, { calendarId: "cld_nothing1" }), "validation.not_found");
});

// ---- the Microsoft pull

test("a Microsoft pull lands changes and removals from the delta, keeps the delta link, and falls back to the window when the link is refused", async () => {
  const h = both();
  h.graph.answers = [{
    changed: [
      { id: "m1", subject: "Sync", start: { dateTime: iso(at(1, 10)) }, end: { dateTime: iso(at(1, 11)) }, attendees: [{ email: "pat@acme.test", response: "accepted", type: "required" }] },
      { id: "m2", isCancelled: true },
    ],
    removed: ["m_old"], deltaLink: "delta_1",
  }];
  await syncNow(h.ctx, { calendarId: MS });
  const first = h.calls("ms.calendar.delta")[0]!.input;
  assert.deepEqual([first.connectionId, first.calendarId, first.deltaLink], ["con_m01", "AAMkAGI2", undefined]);
  assert.deepEqual(eventsOf(h, MS).map((r) => [r.providerId, r.deleted_at === null]).sort(), [["m1", true], ["m2", false], ["m_old", false]]);
  assert.deepEqual(h.named("calendar.synced")[0]!.payload, { calendarId: MS, upserted: 1, removed: 2 });
  assert.equal(h.rows(`SELECT cursor FROM calendar_sync WHERE "calendarId" = ?`, MS)[0]!.cursor, "delta_1");
  h.graph.answers = [{ changed: [], removed: [], deltaLink: "delta_2" }];
  await syncNow(h.ctx, { calendarId: MS });
  assert.equal(h.calls("ms.calendar.delta")[1]!.input.deltaLink, "delta_1");
  h.graph.refuseLink = true;
  h.graph.answers = [{ changed: [], removed: [], deltaLink: "delta_3" }];
  await syncNow(h.ctx, { calendarId: MS });
  assert.deepEqual(h.calls("ms.calendar.delta").slice(-2).map((c) => c.input.deltaLink), ["delta_2", undefined]);
  assert.equal(h.rows(`SELECT cursor FROM calendar_sync WHERE "calendarId" = ?`, MS)[0]!.cursor, "delta_3");
});

// ---- health

test("health is healthy with no provider calendars or no pull yet, degraded when one of several is stale, down when all are", async () => {
  const h = harness();
  seedCalendar(h, "cld_local01", { title: "Local" });
  assert.deepEqual(await health(h.ctx), { state: "healthy", detail: "No Google or Microsoft calendar is connected." });
  seedCalendar(h, GOOG, { provider: "google", title: "Work Google", connectionId: "con_g01", remoteId: "primary" });
  assert.deepEqual(await health(h.ctx), { state: "healthy" }, "connected but never pulled: nothing to age yet");
  await syncNow(h.ctx, { calendarId: GOOG });
  seedCalendar(h, MS, { provider: "microsoft", title: "Outlook", connectionId: "con_m01", remoteId: "AAMkAGI2" });
  h.advance(2 * HOUR);
  await syncNow(h.ctx, { calendarId: MS });
  assert.deepEqual(await health(h.ctx), { state: "healthy" });
  h.advance(5 * HOUR);
  assert.deepEqual(await health(h.ctx), { state: "degraded", detail: "Work Google last synced 7 hours ago." });
  h.advance(60 * HOUR);
  const down = await health(h.ctx);
  assert.equal(down.state, "down");
  assert.equal(down.detail, "Work Google last synced 2 days ago. Outlook last synced 2 days ago.");
});
