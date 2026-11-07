// The scheduled calendar pull must not hold the daemon's one event loop (rc.22: vyred pinned a core, calendar.pull_provider took 8 to 24 seconds). Replay only.
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { pullProviderCalendars } from "../handlers/index.ts";
import { at, harness, seedCalendar } from "../fixtures/harness.ts";
import { startLoopLag } from "../../../host/src/scheduler/looplag.ts";

const GOOG = "cld_goog01";
const iso = (ts: number): string => new Date(ts).toISOString();
const gev = (id: string, s: number) => ({ id, status: "confirmed", summary: id, start: { dateTime: iso(s) }, end: { dateTime: iso(s + 3_600_000) }, attendees: [{ email: `${id}@acme.test`, responseStatus: "accepted" }] });
const world = () => {
  const h = harness();
  seedCalendar(h, GOOG, { provider: "google", title: "Work Google", connectionId: "con_g01", remoteId: "primary" });
  return h;
};
const svc = (h: ReturnType<typeof world>) => h.as({ kind: "service", id: "svc_host" });
const cursorOf = (h: ReturnType<typeof world>): string | null => h.rows(`SELECT cursor FROM calendar_sync WHERE "calendarId" = ?`, GOOG)[0]!.cursor as string | null;

test("a window pull keeps a cursor, and the next pass asks only for what changed, with the deleted ones", async () => {
  const h = world();
  h.google.pages = [{ events: [gev("g1", at(1, 10))] }];
  await pullProviderCalendars(svc(h));
  assert.match(String(cursorOf(h)), /^u1:\d+:\d+$/, "Google gives no sync token for a window, so the cursor is ours");
  h.advance(120_000);
  h.google.pages = [{ events: [] }];
  await pullProviderCalendars(svc(h));
  const second = h.calls("google.calendar.list_events")[1]!.input;
  assert.equal(second.syncToken, undefined);
  assert.equal(typeof second.updatedMin, "string", "the second pass is incremental");
  assert.equal(typeof second.timeMin, "string");
});

test("the whole window is read again after six hours", async () => {
  const h = world();
  h.google.pages = [{ events: [] }];
  await pullProviderCalendars(svc(h));
  h.advance(6 * 3_600_000 + 1);
  h.google.pages = [{ events: [] }];
  await pullProviderCalendars(svc(h));
  assert.equal(h.calls("google.calendar.list_events")[1]!.input.updatedMin, undefined);
});

test("an event that did not change costs no meetings call and no row write", async () => {
  const h = world();
  h.google.pages = [{ events: [gev("g1", at(1, 10))] }];
  await pullProviderCalendars(svc(h));
  const joins = h.calls("meetings.ingest").length;
  assert.equal(joins, 1);
  h.google.pages = [{ events: [gev("g1", at(1, 10))] }];
  h.advance(1000);
  await pullProviderCalendars(svc(h));
  assert.equal(h.calls("meetings.ingest").length, joins);
});

test("the pull's lookup by calendar and provider id has an index in the schema", () => {
  const sql = readFileSync(fileURLToPath(new URL("../migrations/0006_calendar_event_provider_index.sql", import.meta.url)), "utf8");
  assert.match(sql, /CREATE INDEX IF NOT EXISTS calendar_event__provider ON calendar_event \("calendarId", "providerId"\)/);
});

test("a 5,000 event calendar lands without holding the event loop (budget 200 ms) and a second pass is quick", async (t) => {
  const h = world();
  const pages = (): void => {
    h.google.pages = Array.from({ length: 20 }, (_, p) => ({
      events: Array.from({ length: 250 }, (_, i) => gev(`g${p * 250 + i}`, at(1, 10) + (p * 250 + i) * 60_000)),
      ...(p < 19 ? { nextPageToken: `p${p + 1}` } : {}),
    }));
  };
  const lag = startLoopLag();
  pages();
  await pullProviderCalendars(svc(h));
  const first = lag.take();
  assert.equal(h.rows(`SELECT count(*) AS n FROM calendar_event WHERE "calendarId" = ?`, GOOG)[0]!.n, 5000);
  assert.ok(first.maxMs <= 200, `the first pull held the loop ${first.maxMs} ms`);
  h.advance(120_000);
  pages();
  const writesBefore = h.rows(`SELECT sum(version) AS v, count(*) AS n FROM calendar_event WHERE "calendarId" = ?`, GOOG)[0]!;
  const t0 = performance.now();
  await pullProviderCalendars(svc(h));
  const ms = performance.now() - t0, second = lag.take();
  lag.stop();
  t.diagnostic(`first pull max lag ${first.maxMs} ms; second pull ${Math.round(ms)} ms, max lag ${second.maxMs} ms`);
  assert.ok(second.maxMs <= 200, `the second pull held the loop ${second.maxMs} ms`);
  assert.ok(ms < 5000, `the second pull took ${Math.round(ms)} ms`);
  // 5,000 unchanged events are read in batches and none of them is written again: no row's version moved, and none was added
  const writesAfter = h.rows(`SELECT sum(version) AS v, count(*) AS n FROM calendar_event WHERE "calendarId" = ?`, GOOG)[0]!;
  assert.deepEqual([writesAfter.v, writesAfter.n], [writesBefore.v, writesBefore.n], "the second pass wrote nothing for unchanged events");
});
