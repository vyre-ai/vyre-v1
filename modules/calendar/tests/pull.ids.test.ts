// A pull must keep event ids, and every event the grid lists must open (rc.22: "This event is not there any more" on an event still drawn in the grid). Replay only.
import test from "node:test";
import assert from "node:assert/strict";
import { getEvent, listCalendars, listEvents, pullProviderCalendars } from "../handlers/index.ts";
import { at, contractErrors, harness, seedCalendar } from "../fixtures/harness.ts";

const GOOG = "cld_goog01";
const iso = (ts: number): string => new Date(ts).toISOString();
const world = () => {
  const h = harness();
  seedCalendar(h, GOOG, { provider: "google", title: "Work Google", connectionId: "con_g01", remoteId: "primary" });
  return h;
};
const svc = (h: ReturnType<typeof world>) => h.as({ kind: "service", id: "svc_host" });
const gev = (id: string, title: string, s: number, e: number, extra: Record<string, unknown> = {}) => ({ id, status: "confirmed", summary: title, start: { dateTime: iso(s) }, end: { dateTime: iso(e) }, ...extra });
const office = (id: string, s: number) => gev(id, "Weekly Tech Office Hours", s, s + 3_600_000, {
  recurringEventId: "officehours", hangoutLink: "https://meet.google.com/abc-defg-hij", organizer: { email: "techmanager@mylegalacademy.com" },
  description: "x".repeat(5000), attendees: [{ email: "a@acme.test", responseStatus: "accepted", displayName: "A" }, { email: "b@acme.test" }],
  conferenceData: { conferenceId: "abc-defg-hij", conferenceSolution: { key: { type: "hangoutsMeet" } }, entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" }, { entryPointType: "phone", uri: "tel:+1-555-0100", pin: "123456", regionCode: "US" }] },
});
const range = { from: at(0, 0), to: at(40, 0) };
const ids = async (h: ReturnType<typeof world>): Promise<Map<string, string>> => new Map((await listEvents(h.ctx, range)).events.map((e) => [e.title + e.startsAt, e.id]));
const idOf = (h: ReturnType<typeof world>, providerId: string): string => String(h.rows(`SELECT id FROM calendar_event WHERE "providerId" = ?`, providerId)[0]!.id);

test("every event the grid lists opens, a recurring instance included, and the answer fits its contract", async () => {
  const h = world();
  h.google.pages = [{ events: [office("officehours_20261107T130000Z", at(1, 13)), office("officehours_20261114T130000Z", at(8, 13)), gev("solo", "Intake", at(2, 9), at(2, 10))] }];
  await pullProviderCalendars(svc(h));
  const listed = (await listEvents(h.ctx, range)).events;
  assert.equal(listed.length, 3);
  for (const e of listed) {
    const got = await getEvent(h.ctx, { eventId: e.id });
    assert.equal(got.event.id, e.id);
    assert.deepEqual(contractErrors("calendar.get_event", "out", got), []);
  }
  assert.equal((await getEvent(h.ctx, { eventId: idOf(h, "officehours_20261107T130000Z") })).repeats, "week");
});

test("a re-pull, a changed pull and the full re-read keep every id; a moved event is updated in place; a cancelled one is removed and nothing is duplicated", async () => {
  const h = world();
  h.google.pages = [{ events: [office("o1", at(1, 13)), office("o2", at(8, 13)), gev("solo", "Intake", at(2, 9), at(2, 10))] }];
  await pullProviderCalendars(svc(h));
  const before = await ids(h);
  const solo = idOf(h, "solo");

  h.advance(120_000);
  h.google.pages = [{ events: [office("o1", at(1, 13)), office("o2", at(8, 13)), gev("solo", "Intake", at(2, 9), at(2, 10))] }];
  await pullProviderCalendars(svc(h));
  assert.deepEqual([...(await ids(h))].sort(), [...before].sort(), "the same pull again changes no id");

  h.advance(120_000);
  h.google.pages = [{ events: [gev("solo", "Intake, moved", at(3, 9), at(3, 10))] }];   // the incremental pass: only what changed
  await pullProviderCalendars(svc(h));
  assert.equal(idOf(h, "solo"), solo, "moved in place");
  assert.equal(h.rows(`SELECT count(*) AS n FROM calendar_event WHERE "providerId" = ?`, "solo")[0]!.n, 1);
  assert.equal((await getEvent(h.ctx, { eventId: solo })).event.startsAt, at(3, 9));
  assert.equal((await listEvents(h.ctx, range)).events.length, 3);

  h.advance(120_000);
  h.google.pages = [{ events: [{ id: "solo", status: "cancelled" }] }];
  await pullProviderCalendars(svc(h));
  assert.equal((await listEvents(h.ctx, range)).events.some((e) => e.id === solo), false, "the grid no longer lists it");
  await assert.rejects(getEvent(h.ctx, { eventId: solo }));
  assert.equal(idOf(h, "o1"), before.get("Weekly Tech Office Hours" + at(1, 13)));

  h.advance(7 * 3_600_000);   // past the full re-read: the window is read whole, and it no longer has the cancelled event
  h.google.pages = [{ events: [office("o1", at(1, 13)), office("o2", at(8, 13))] }];
  await pullProviderCalendars(svc(h));
  assert.equal(idOf(h, "o1"), before.get("Weekly Tech Office Hours" + at(1, 13)));
  assert.equal(h.rows(`SELECT count(*) AS n FROM calendar_event WHERE "calendarId" = ?`, GOOG)[0]!.n, 3, "two series events and the cancelled marker, no duplicates");
});

test("a meeting that lives in two people's calendars is listed once, as the viewer's own copy, and that id opens; a calendar the viewer cannot open adds nothing", async () => {
  const h = harness();
  const MAYA = "cld_maya01", OMAR = "cld_omar01", HIDDEN = "cld_hide01";
  seedCalendar(h, MAYA, { provider: "google", owner: "usr_maya01", connectionId: "con_g01", remoteId: "primary" });
  seedCalendar(h, OMAR, { provider: "google", owner: "usr_omar01", connectionId: "con_g01", remoteId: "primary" });
  seedCalendar(h, HIDDEN, { provider: "google", owner: "usr_pat001", connectionId: "con_g01", remoteId: "primary" });
  const { ingestEvent } = await import("../handlers/index.ts");
  for (const c of [OMAR, MAYA, HIDDEN]) await ingestEvent(h.ctx, { source: "google", calendarId: c, providerId: "office_20261107", title: "Weekly Tech Office Hours", startsAt: at(1, 13), endsAt: at(1, 14) });
  await ingestEvent(h.ctx, { source: "google", calendarId: OMAR, providerId: "omar_only", title: "Omar one to one", startsAt: at(2, 9), endsAt: at(2, 10) });
  const mine = String(h.rows(`SELECT id FROM calendar_event WHERE "calendarId" = ? AND "providerId" = ?`, MAYA, "office_20261107")[0]!.id);
  h.denied.add(`calendar:${HIDDEN}`);
  const listed = (await listEvents(h.ctx, range)).events;   // no calendar named: every calendar the viewer may see
  assert.deepEqual(listed.map((e) => e.title).sort(), ["Omar one to one", "Weekly Tech Office Hours"], "the shared meeting once");
  const office = listed.find((e) => e.title === "Weekly Tech Office Hours")!;
  assert.equal(office.id, mine, "the viewer's own copy");
  assert.equal((await getEvent(h.ctx, { eventId: office.id })).event.id, mine);
  for (const e of listed) await getEvent(h.ctx, { eventId: e.id });   // everything listed opens
});

test("with no calendar named, an admin's week and list hold their own calendars and the ones shared with them, never a member's calendar they can open only through the admin role", async () => {
  const h = harness();   // the viewer is usr_maya01, an admin: the role lets them open every calendar
  const MINE = "cld_maya01", SHARED = "cld_omar01", MEMBER = "cld_pat001";
  seedCalendar(h, MINE, { owner: "usr_maya01", title: "Maya" });
  seedCalendar(h, SHARED, { owner: "usr_omar01", title: "Omar (shared with Maya)" });
  seedCalendar(h, MEMBER, { owner: "usr_pat001", title: "Pat" });
  h.roleOnly.add(MEMBER);
  const { ingestEvent } = await import("../handlers/index.ts");
  for (const c of [MINE, SHARED, MEMBER]) await ingestEvent(h.ctx, { source: "google", calendarId: c, providerId: `own_${c}`, title: `on ${c}`, startsAt: at(1, 9), endsAt: at(1, 10) });
  const memberEvent = String(h.rows(`SELECT id FROM calendar_event WHERE "calendarId" = ?`, MEMBER)[0]!.id);
  assert.deepEqual((await listEvents(h.ctx, range)).events.map((e) => e.calendarId).sort(), [SHARED, MINE].sort(), "their own and the shared one");
  assert.deepEqual((await listCalendars(h.ctx, {})).calendars.map((c) => c.id).sort(), [SHARED, MINE].sort(), "the sidebar list says the same");
  // opening a member's calendar on purpose still works
  assert.deepEqual((await listEvents(h.ctx, { ...range, calendarIds: [MEMBER] })).events.map((e) => e.calendarId), [MEMBER]);
  assert.equal((await getEvent(h.ctx, { eventId: memberEvent })).event.id, memberEvent);
});
