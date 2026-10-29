// A member's Google or Microsoft calendar in Calendar (calendar.connect_provider): it is owned by the member and read as their account, a repeat call answers the same calendar,
// the pull asks the provider for that account whoever runs the sync, and an excluded member's calendar and events leave Calendar (a fresh one comes back when they are included).
import test from "node:test";
import assert from "node:assert/strict";
import { connectProvider, listCalendars, syncNow } from "../handlers/index.ts";
import { at, codeOf, contractErrors, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const MAYA = "usr_maya01";
const ARGS = { provider: "google", ownerId: MAYA, account: "Maya@Vyre.test", connectionId: "con_g01" } as const;
const iso = (ts: number): string => new Date(ts).toISOString();

function admin(): Harness {
  return harness({ principal: { kind: "service", id: "svc_host" } });
}

test("connect_provider puts the member's primary Google calendar in Calendar, owned by them and read as their account", async () => {
  const h = admin();
  assert.deepEqual(contractErrors("calendar.connect_provider", "in", ARGS), []);
  const out = await connectProvider(h.ctx, { ...ARGS });
  assert.deepEqual(contractErrors("calendar.connect_provider", "out", out), []);
  assert.equal(out.created, true);
  const row = h.rows(`SELECT * FROM calendar_list WHERE id = ?`, out.calendarId!)[0]!;
  assert.deepEqual([row.provider, row.ownerId, row.connectionId, row.remoteId, row.title, row.personal, row.state], ["google", MAYA, "con_g01", "primary", "Google Calendar", 0, "syncing"]);
  assert.deepEqual(h.rows(`SELECT * FROM calendar_account`), [{ calendarId: out.calendarId, account: "maya@vyre.test" }]);
  const again = await connectProvider(h.ctx, { ...ARGS });
  assert.deepEqual(again, { calendarId: out.calendarId, created: false });
  assert.equal(h.rows(`SELECT id FROM calendar_list`).length, 1);
  // the member sees it as theirs; nobody else is told it exists
  const mine = await listCalendars(h.as({ kind: "person", id: MAYA }), {});
  assert.deepEqual(mine.calendars.map((c) => [c.id, c.provider, c.ownerId]), [[out.calendarId, "google", MAYA]]);
});

test("a Microsoft default calendar has no remote id of its own, and refusals name the bad input", async () => {
  const h = admin();
  const ms = await connectProvider(h.ctx, { provider: "microsoft", ownerId: MAYA, account: "maya@vyre.test", connectionId: "con_m01" });
  assert.equal(h.rows(`SELECT "remoteId", title FROM calendar_list WHERE id = ?`, ms.calendarId!)[0]!.remoteId, "default");
  assert.equal(h.rows(`SELECT title FROM calendar_list WHERE id = ?`, ms.calendarId!)[0]!.title, "Outlook Calendar");
  for (const bad of [{ ...ARGS, provider: "icloud" }, { ...ARGS, ownerId: "maya" }, { ...ARGS, account: "nobody" }, { ...ARGS, connectionId: "g1" }]) {
    await assert.rejects(() => connectProvider(h.ctx, bad as never), (e) => codeOf(e) === "validation.bad_input");
  }
});

test("the Google pull is made as the calendar's account, even when the server runs it", async () => {
  const h = admin();
  const { calendarId } = await connectProvider(h.ctx, { ...ARGS });
  h.google.pages = [{ events: [{ id: "g1", status: "confirmed", summary: "Intake", start: { dateTime: iso(at(1, 10)) }, end: { dateTime: iso(at(1, 11)) } }], nextSyncToken: "s1" }];
  await syncNow(h.ctx, { calendarId: calendarId! });
  const asked = h.calls("google.calendar.list_events");
  assert.equal(asked.length, 1);
  assert.deepEqual([asked[0]!.input.connectionId, asked[0]!.input.calendarId, asked[0]!.input.as], ["con_g01", "primary", "maya@vyre.test"]);
  assert.equal(h.rows(`SELECT title FROM calendar_event WHERE "calendarId" = ?`, calendarId!)[0]!.title, "Intake");
});

test("the Microsoft pull is made as the account and names no calendar for the default one", async () => {
  const h = admin();
  const { calendarId } = await connectProvider(h.ctx, { provider: "microsoft", ownerId: MAYA, account: "maya@vyre.test", connectionId: "con_m01" });
  await syncNow(h.ctx, { calendarId: calendarId! });
  const asked = h.calls("ms.calendar.delta");
  assert.equal(asked.length, 1);
  assert.equal(asked[0]!.input.as, "maya@vyre.test");
  assert.ok(!("calendarId" in asked[0]!.input));
});

test("an excluded member's calendar and its events leave Calendar; including them again makes a fresh one", async () => {
  const h = admin();
  const first = await connectProvider(h.ctx, { ...ARGS });
  h.google.pages = [{ events: [{ id: "g1", status: "confirmed", summary: "Intake", start: { dateTime: iso(at(1, 10)) }, end: { dateTime: iso(at(1, 11)) } }], nextSyncToken: "s1" }];
  await syncNow(h.ctx, { calendarId: first.calendarId! });
  assert.equal(h.rows(`SELECT id FROM calendar_event WHERE deleted_at IS NULL`).length, 1);

  const off = await connectProvider(h.ctx, { ...ARGS, connected: false });
  assert.deepEqual(off, { calendarId: first.calendarId, created: false });
  assert.equal(h.rows(`SELECT id FROM calendar_list WHERE deleted_at IS NULL`).length, 0);
  assert.equal(h.rows(`SELECT id FROM calendar_event WHERE deleted_at IS NULL`).length, 0);
  assert.equal(h.named("calendar_event.deleted").length, 1);
  assert.deepEqual(await connectProvider(h.ctx, { ...ARGS, connected: false }), { created: false });   // already gone: nothing to remove

  const back = await connectProvider(h.ctx, { ...ARGS });
  assert.equal(back.created, true);
  assert.notEqual(back.calendarId, first.calendarId);
});
