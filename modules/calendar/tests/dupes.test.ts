// One calendar per Google account, and no event twice (MLA, 4 Nov: the same Google event sat in four calendar rows, one for every reconnect, and clicking it said "not there any more"): a reconnect
// answers the calendar that is already here, an event lands once per calendar and provider id, the duplicates an earlier reconnect left are folded into the oldest calendar (newest version of each event
// wins, grants kept, one audit row), and what Calendar lists is exactly what it opens.
import test from "node:test";
import assert from "node:assert/strict";
import { connectProvider, getEvent, ingestEvent, listCalendars, listEvents, mergeDuplicateCalendars, pullProviderCalendars } from "../handlers/index.ts";
import { NOW, at, codeOf, harness } from "../fixtures/harness.ts";
import type { Harness } from "../fixtures/harness.ts";

const MAYA = "usr_maya01";
const ACCOUNT = "techmanager@mylegalacademy.com";
const admin = (): Harness => harness({ principal: { kind: "service", id: "svc_host" } });
const rowsOf = (h: Harness, sql: string, ...a: unknown[]) => h.rows(sql, ...a);

function addCalendar(h: Harness, id: string, o: { connectionId: string; at: number; owner?: string }): void {
  h.ctx.db.run(`INSERT INTO calendar_list (id, title, color, provider, "connectionId", "remoteId", "ownerId", personal, state, version, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, ACCOUNT, "#4f6bed", "google", o.connectionId, "primary", o.owner ?? MAYA, 0, "syncing", 1, o.at, null);
  h.ctx.db.run(`INSERT INTO calendar_account ("calendarId", account) VALUES (?, ?)`, id, ACCOUNT);
  h.ctx.db.run(`INSERT INTO calendar_sync ("calendarId", cursor, "lastTryAt", "lastOkAt", "lastError") VALUES (?, ?, ?, ?, ?)`, id, `cursor-${id}`, o.at, o.at, null);
}
function addEvent(h: Harness, id: string, calendarId: string, providerId: string, o: { title: string; at: number; version?: number; updated?: number; deleted?: boolean; meeting?: string; records?: string[] }): void {
  h.ctx.db.run(
    `INSERT INTO calendar_event (id, "calendarId", title, "startsAt", "endsAt", "allDay", "joinProvider", attendees, "recordIds", "meetingId", "providerId", status, version, updated_at, "deletedAt", deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, calendarId, o.title, o.at, o.at + 3_600_000, 0, "none", "[]", JSON.stringify(o.records ?? []), o.meeting ?? null, providerId, "confirmed", o.version ?? 1, o.updated ?? NOW, o.deleted ? NOW : null, o.deleted ? NOW : null,
  );
}

test("reconnecting the same Google account twice leaves one calendar, and an event pulled after each lands once", async () => {
  const h = admin();
  const first = await connectProvider(h.ctx, { provider: "google", ownerId: MAYA, account: ACCOUNT, connectionId: "con_g01" });
  const second = await connectProvider(h.ctx, { provider: "google", ownerId: MAYA, account: ACCOUNT.toUpperCase(), connectionId: "con_g02" });
  const third = await connectProvider(h.ctx, { provider: "google", ownerId: MAYA, account: ACCOUNT, connectionId: "con_g03" });
  assert.deepEqual([second.calendarId, second.created], [first.calendarId, false], "the same calendar, not a new one");
  assert.equal(third.calendarId, first.calendarId);
  assert.equal(rowsOf(h, `SELECT id FROM calendar_list WHERE deleted_at IS NULL`).length, 1);
  assert.equal(h.named("calendar.created").length, 1, "born once");
  assert.equal(rowsOf(h, `SELECT "connectionId" FROM calendar_list`)[0]!.connectionId, "con_g03", "the pull reads through the newest connection");
  for (let pass = 0; pass < 3; pass++) {
    await ingestEvent(h.ctx, { calendarId: first.calendarId!, providerId: "7eljn49vvdr0qu8ftvqaddbj0v", source: "google", title: `Meet and Greet ${pass}`, startsAt: at(5, 14), endsAt: at(5, 15) });
  }
  assert.equal(rowsOf(h, `SELECT id FROM calendar_event`).length, 1, "the same provider event is one row however often it is pulled");
  // a different account is a different calendar
  const other = await connectProvider(h.ctx, { provider: "google", ownerId: MAYA, account: "other@mylegalacademy.com", connectionId: "con_g09" });
  assert.notEqual(other.calendarId, first.calendarId);
  // excluding the member removes the calendar (and any copy an older reconnect left)
  await connectProvider(h.ctx, { provider: "google", ownerId: MAYA, account: ACCOUNT, connectionId: "con_g03", connected: false });
  assert.deepEqual(rowsOf(h, `SELECT id FROM calendar_list WHERE deleted_at IS NULL`).map((r) => r.id), [other.calendarId]);
});

test("the merge folds the duplicate calendars of one account into the oldest: events once by provider id, the newest version wins, grants and the audit row kept", async () => {
  const h = admin();
  // shaped like MLA: four rows for one Google calendar, created at different times, the newest holding a full re-import
  addCalendar(h, "cld_01a19e1b8c85", { connectionId: "con_a", at: NOW - 5000 });
  addCalendar(h, "cld_01a19e21129d", { connectionId: "con_b", at: NOW - 4000 });
  addCalendar(h, "cld_01a19e5fddda", { connectionId: "con_c", at: NOW - 3000 });
  addCalendar(h, "cld_01a1a38873bd", { connectionId: "con_d", at: NOW - 100 });
  addCalendar(h, "cld_01a1b0000000", { connectionId: "con_x", at: NOW - 3000, owner: "usr_omar01" });   // another person's calendar, same remote id: untouched
  const shared = "7eljn49vvdr0qu8ftvqaddbj0v";
  addEvent(h, "cev_1a", "cld_01a19e1b8c85", shared, { title: "Meet and Greet (old)", at: at(5, 14), version: 1, updated: NOW - 5000, records: ["rec_one"] });
  addEvent(h, "cev_1b", "cld_01a19e21129d", shared, { title: "Meet and Greet (older)", at: at(5, 14), version: 2, updated: NOW - 4000, meeting: "rec_meet1" });
  addEvent(h, "cev_1c", "cld_01a19e5fddda", shared, { title: "Meet and Greet (mid)", at: at(5, 14), version: 3, updated: NOW - 3000 });
  addEvent(h, "cev_1d", "cld_01a1a38873bd", shared, { title: "Meet and Greet", at: at(5, 15), version: 4, updated: NOW - 100 });
  addEvent(h, "cev_2a", "cld_01a19e5fddda", "only-in-one", { title: "Only here", at: at(6, 9) });
  addEvent(h, "cev_3a", "cld_01a19e1b8c85", "gone-in-newest", { title: "Was live", at: at(7, 9), updated: NOW - 5000 });
  addEvent(h, "cev_3d", "cld_01a1a38873bd", "gone-in-newest", { title: "Was live", at: at(7, 9), updated: NOW - 50, deleted: true });
  addEvent(h, "cev_9", "cld_01a1b0000000", shared, { title: "Omar's copy of the same invite", at: at(5, 14) });
  h.script("access.shares_of", (i) => ({ shares: (i as { resource: { id: string } }).resource.id === "cld_01a19e5fddda" ? [{ through: "direct", grant: { id: "gnt_1", subject: { kind: "person", id: "usr_omar01" }, level: "view" } }] : [] }));
  h.script("access.share", () => ({ grant: { id: "gnt_new" } }));
  h.script("audit.append", () => ({ auditId: "aud_1" }));

  const done = await mergeDuplicateCalendars(h.ctx);
  assert.deepEqual([done.merged, done.grants], [3, 1]);
  const live = rowsOf(h, `SELECT id FROM calendar_list WHERE deleted_at IS NULL`).map((r) => String(r.id)).sort();
  assert.deepEqual(live, ["cld_01a19e1b8c85", "cld_01a1b0000000"], "the oldest copy stays; the other person's calendar is not touched");
  const kept = rowsOf(h, `SELECT * FROM calendar_event WHERE "calendarId" = ?`, "cld_01a19e1b8c85").sort((a, b) => String(a.providerId).localeCompare(String(b.providerId)));
  assert.deepEqual(kept.map((e) => e.providerId), ["gone-in-newest", "only-in-one", shared].sort(), "each provider event once");
  const meet = kept.find((e) => e.providerId === shared)!;
  assert.equal(meet.title, "Meet and Greet", "the newest version wins");
  assert.equal(meet.startsAt, at(5, 15));
  assert.equal(meet.meetingId, "rec_meet1", "the meeting the event became is carried over");
  assert.deepEqual(JSON.parse(String(meet.recordIds)), ["rec_one"], "so are its linked records");
  assert.ok(num(kept.find((e) => e.providerId === "gone-in-newest")!, "deleted_at") > 0, "a newer delete wins too");
  assert.equal(rowsOf(h, `SELECT id FROM calendar_event WHERE "calendarId" = ?`, "cld_01a1b0000000").length, 1, "the other person's copy stays theirs");
  assert.equal(rowsOf(h, `SELECT id FROM calendar_event`).length, 3 + 1, "three provider events on the kept calendar and the other person's copy");
  assert.deepEqual(rowsOf(h, `SELECT "calendarId" FROM calendar_sync`).map((r) => r.calendarId).sort(), ["cld_01a19e1b8c85", "cld_01a1b0000000"], "one sync cursor per calendar that stays");
  assert.deepEqual(h.calls("access.share").map((c) => [(c.input as { resource: { id: string } }).resource.id, (c.input as { level: string }).level]), [["cld_01a19e1b8c85", "view"]], "the grant is given again on the calendar that stays");
  const audit = h.calls("audit.append");
  assert.equal(audit.length, 1);
  assert.equal(audit[0]!.input["action"], "calendar.duplicates_merged");
  // run again: nothing left to fold, nothing written
  const before = rowsOf(h, `SELECT id, version FROM calendar_event`).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  assert.deepEqual(await mergeDuplicateCalendars(h.ctx), { merged: 0, events: 0, grants: 0 });
  assert.deepEqual(rowsOf(h, `SELECT id, version FROM calendar_event`).sort((a, b) => String(a.id).localeCompare(String(b.id))), before);
  assert.equal(h.calls("audit.append").length, 1);
});

const num = (r: Record<string, string | number | null>, k: string): number => Number(r[k] ?? 0);

test("the scheduled pull folds duplicates first", async () => {
  const h = admin();
  addCalendar(h, "cld_01a19e1b8c85", { connectionId: "con_a", at: NOW - 5000 });
  addCalendar(h, "cld_01a1a38873bd", { connectionId: "con_d", at: NOW - 100 });
  h.script("access.shares_of", () => ({ shares: [] }));
  h.script("audit.append", () => ({ auditId: "aud_1" }));
  await pullProviderCalendars(h.ctx);
  assert.deepEqual(rowsOf(h, `SELECT id FROM calendar_list WHERE deleted_at IS NULL`).map((r) => r.id), ["cld_01a19e1b8c85"]);
});

test("what the week lists is what opens: every listed event can be read, and an event on a calendar the person cannot see is neither listed nor opened", async () => {
  const h = admin();
  addCalendar(h, "cld_01a19e1b8c85", { connectionId: "con_a", at: NOW - 5000 });
  addCalendar(h, "cld_01a1b0000000", { connectionId: "con_x", at: NOW - 3000, owner: "usr_omar01" });
  addEvent(h, "cev_mine", "cld_01a19e1b8c85", "p-mine", { title: "Mine", at: at(1, 10) });
  addEvent(h, "cev_theirs", "cld_01a1b0000000", "p-theirs", { title: "Theirs", at: at(1, 11) });
  h.denied.add("calendar:cld_01a1b0000000");
  const maya = h.as({ kind: "person", id: MAYA });
  const range = { from: at(0), to: at(3) };
  const listed = (await listEvents(maya, range)).events;
  assert.deepEqual(listed.map((e) => e.id), ["cev_mine"]);
  for (const e of listed) assert.equal((await getEvent(maya, { eventId: e.id })).event.id, e.id, "listed means it opens");
  await assert.rejects(getEvent(maya, { eventId: "cev_theirs" }), (e) => codeOf(e) === "validation.not_found");
  assert.deepEqual((await listCalendars(maya, {})).calendars.map((c) => c.id), ["cld_01a19e1b8c85"], "the calendar list agrees");
});
