// The event pane's facts (lane l-calevents): a provider series lands with its series id and description, get_event says the caller's own answer and how the event repeats,
// and an edit applies to This event or All events of the series (ended instances stay as they happened). Replay only: the provider capabilities are scripted.
// @reads /modules/calendar/handlers/events.ts
// @reads /modules/calendar/migrations/0004_calendar_series.sql
import test from "node:test";
import assert from "node:assert/strict";
import { fromGoogle, fromGraph, getEvent, pullProviderCalendars, respond, updateEvent } from "../handlers/index.ts";
import { repeatsOf } from "../handlers/events.ts";
import { DAY, HOUR, at, contractErrors, harness, seedCalendar } from "../fixtures/harness.ts";

const GOOG = "cld_goog01";
const iso = (ts: number): string => new Date(ts).toISOString();
const inst = (n: number, day: number) => ({
  id: `sync_${n}`, status: "confirmed", summary: "Weekly sync", start: { dateTime: iso(at(day, 9, 30)) }, end: { dateTime: iso(at(day, 10)) }, recurringEventId: "sync",
  description: "Pipeline, approvals, blockers. Notes: https://docs.example/sync", organizer: { email: "omar@vyre.test" },
  attendees: [{ email: "omar@vyre.test", responseStatus: "accepted" }, { email: "maya@vyre.test", responseStatus: "needsAction" }],
});

async function world() {
  const h = harness();
  seedCalendar(h, GOOG, { provider: "google", title: "Work Google", connectionId: "con_g01", remoteId: "primary" });
  // last week's instance has ended; this week's and the next two are ahead
  h.google.pages.push({ events: [inst(0, -7), inst(1, 0), inst(2, 7), inst(3, 14), { id: "lunch", status: "confirmed", summary: "Lunch", start: { dateTime: iso(at(1, 12)) }, end: { dateTime: iso(at(1, 13)) } }] });
  await pullProviderCalendars(h.as({ kind: "service", id: "svc_host" }));
  const id = (pid: string): string => String(h.rows(`SELECT * FROM calendar_event WHERE "providerId" = ?`, pid)[0]!.id);
  return { h, id };
}

test("a repeating Google event lands with its series and description; Microsoft's occurrence too", async () => {
  const { h, id } = await world();
  const rows = h.rows(`SELECT * FROM calendar_event WHERE "seriesId" = ?`, "sync");
  assert.equal(rows.length, 4, "every instance carries the series");
  assert.equal(h.rows(`SELECT * FROM calendar_event WHERE "providerId" = ?`, "lunch")[0]!.seriesId, null, "a one-off has none");
  const ev = (await getEvent(h.ctx, { eventId: id("sync_1") })).event;
  assert.deepEqual([ev.seriesId, ev.description], ["sync", "Pipeline, approvals, blockers. Notes: https://docs.example/sync"]);
  const ms = fromGraph(GOOG, { id: "occ1", subject: "Standup", start: { dateTime: "2025-10-10T09:00:00", timeZone: "UTC" }, end: { dateTime: "2025-10-10T09:15:00", timeZone: "UTC" }, seriesMasterId: "master1", bodyPreview: "Quick round" });
  assert.deepEqual([ms?.seriesId, ms?.description], ["master1", "Quick round"]);
  assert.equal(fromGoogle(GOOG, inst(9, 3))?.seriesId, "sync");
});

test("get_event says your own answer when you are a guest, and how the event repeats", async () => {
  const { h, id } = await world();
  const out = await getEvent(h.ctx, { eventId: id("sync_1") });
  assert.deepEqual(contractErrors("calendar.get_event", "out", out), []);
  assert.deepEqual([out.mine, out.repeats], [{ email: "maya@vyre.test", response: "needs_action" }, "week"]);
  await respond(h.ctx, { eventId: id("sync_1"), response: "accepted" });
  assert.deepEqual((await getEvent(h.ctx, { eventId: id("sync_1") })).mine, { email: "maya@vyre.test", response: "accepted" });
  const lunch = await getEvent(h.ctx, { eventId: id("lunch") });
  assert.deepEqual([lunch.mine, lunch.repeats], [undefined, undefined], "not a guest, does not repeat");
  assert.equal((await getEvent(h.as({ kind: "person", id: "usr_omar01" }), { eventId: id("sync_1") })).mine?.response, "accepted", "Omar sees his own answer");
});

test("All events changes every instance that has not ended, by the same change of time; This event only this one", async () => {
  const { h, id } = await world();
  const before = (pid: string) => h.rows(`SELECT * FROM calendar_event WHERE "providerId" = ?`, pid)[0]!;
  const past = before("sync_0");
  const one = await updateEvent(h.ctx, { eventId: id("sync_2"), title: "Weekly sync (moved)", scope: "this" });
  assert.deepEqual(contractErrors("calendar.update_event", "out", one), []);
  assert.deepEqual([before("sync_1").title, before("sync_2").title, before("sync_3").title], ["Weekly sync", "Weekly sync (moved)", "Weekly sync"]);

  const all = await updateEvent(h.ctx, { eventId: id("sync_1"), title: "Team sync", startsAt: at(0, 10), endsAt: at(0, 10, 45), scope: "all" });
  assert.deepEqual(contractErrors("calendar.update_event", "out", all), []);
  assert.equal(all.changed, 3, "this one and the two ahead");
  for (const [pid, day] of [["sync_1", 0], ["sync_2", 7], ["sync_3", 14]] as const) {
    const r = before(pid);
    assert.deepEqual([r.title, r.startsAt, r.endsAt], ["Team sync", at(day, 10), at(day, 10, 45)], `${pid} keeps its date and moves with the series`);
  }
  assert.deepEqual([before("sync_0").title, before("sync_0").startsAt], [past.title, past.startsAt], "the ended one stays as it happened");
  assert.equal(h.named("calendar_event.updated").filter((e) => (e.payload.fields as string[]).includes("title")).length, 4, "each changed instance says so once");
  assert.equal(await updateEvent(h.ctx, { eventId: id("lunch"), title: "Long lunch", scope: "all" }).then((o) => o.event.title), "Long lunch", "All on a one-off is just this one");
});

test("how a series repeats, from the starts of its instances", () => {
  const d = (n: number, hh = 9): number => Date.UTC(2025, 9, 6) + n * DAY + hh * HOUR;   // Monday 6 Oct 2025
  assert.equal(repeatsOf([d(0), d(7), d(14)]), "week");
  assert.equal(repeatsOf([d(0), d(14), d(28)]), "two_weeks");
  assert.equal(repeatsOf([d(0), d(1), d(2), d(3), d(4), d(5), d(6)]), "day");
  assert.equal(repeatsOf([d(0), d(1), d(2), d(3), d(4), d(7), d(8)]), "weekday");
  assert.equal(repeatsOf([d(0), d(31), d(61)]), "month");
  assert.equal(repeatsOf([d(0), d(3), d(11)]), "other");
  assert.equal(repeatsOf([d(0)]), "other");
});
