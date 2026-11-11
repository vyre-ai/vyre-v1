// Two members' calendars carry the same meeting with different titles and end times (issue 906: a server rewrote such meetings every two minutes for a week). One source speaks for the title,
// start and end (the calendar copy with the lowest event id), so after any number of passes the record is written at most once more; other copies and calls only add what is new.
import test from "node:test";
import assert from "node:assert/strict";
import * as m from "../handlers/index.ts";
import { HOUR, START, harness } from "../fixtures/harness.ts";

type Json = Record<string, unknown>;
const out = (x: unknown): Json => x as Json;
const copy = (event: string, title: string, endsAfterHours: number, extra: string[] = []) => ({
  source: "calendar", providerRef: event, calendarEventId: event, title, startsAt: START, endsAt: START + endsAfterHours * HOUR, joinUrl: "https://meet.example.com/abc-defg-hij",
  attendees: [{ email: "pat@client.example" }, { email: "maya@firm.example" }, ...extra.map((email) => ({ email }))],
});

test("two calendar copies of one meeting with different titles and ends settle on one value and stop writing", async () => {
  const h = harness();
  const a = copy("cev_evt00001", "Estate review", 1), b = copy("cev_evt00002", "Review: estate plan (Dana's copy)", 2);
  const first = out(await m.ingest(h.ctx, a)), second = out(await m.ingest(h.ctx, b));
  assert.equal(second.meetingId, first.meetingId, "the second copy merges into the first meeting");
  assert.equal(second.merged, true);
  const writesAfterMerge = h.calls("records.update").length;
  for (let pass = 0; pass < 10; pass++) { await m.ingest(h.ctx, a); await m.ingest(h.ctx, b); }
  assert.ok(h.calls("records.update").length - writesAfterMerge <= 1, `ten passes wrote ${h.calls("records.update").length - writesAfterMerge} times`);
  const fields = (h.store.get(String(first.meetingId))!.fields) as Json;
  assert.equal(fields["title"], "Estate review", "the first calendar copy speaks for the title");
  assert.equal(fields["ends_at"], new Date(START + HOUR).toISOString(), "and for the end");
});

test("the order the copies arrive in does not matter: the lowest event id wins either way", async () => {
  for (const order of [["cev_evt00002", "cev_evt00001"], ["cev_evt00001", "cev_evt00002"]]) {
    const h = harness();
    const by: Record<string, ReturnType<typeof copy>> = { cev_evt00001: copy("cev_evt00001", "Estate review", 1), cev_evt00002: copy("cev_evt00002", "Another title", 2) };
    const id = String(out(await m.ingest(h.ctx, by[order[0]!]!)).meetingId);
    await m.ingest(h.ctx, by[order[1]!]!);
    for (let pass = 0; pass < 5; pass++) for (const e of order) await m.ingest(h.ctx, by[e]!);
    const fields = h.store.get(id)!.fields as Json;
    assert.equal(fields["title"], "Estate review", `arriving ${order.join(" then ")}`);
    assert.equal(fields["ends_at"], new Date(START + HOUR).toISOString());
  }
});

test("a copy that is not the speaking one leaves the title and end alone, however often it is refreshed", async () => {
  const h = harness();
  const id = String(out(await m.ingest(h.ctx, copy("cev_evt00001", "Estate review", 1))).meetingId);
  await m.ingest(h.ctx, copy("cev_evt00002", "Other", 2));
  await m.ingest(h.ctx, copy("cev_evt00002", "Other", 2, ["sam@firm.example"]));
  const fields = h.store.get(id)!.fields as Json;
  assert.equal(fields["title"], "Estate review");
  assert.equal(fields["ends_at"], new Date(START + HOUR).toISOString());
});
