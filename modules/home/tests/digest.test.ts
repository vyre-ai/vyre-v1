// The While you were away digest (spec 3.1, Provisional b2): ranking, the stored `digest` entity that reads offline, reset once seen, who may write and read it, and See all.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, assistant, bob, host, hex, item, newDigest, NOW, MINUTE, HOUR } from "../fixtures/seed.ts";

const names = (h: Harness): string[] => h.allEvents.map((e) => e.name);
const titles = (items: { title: string }[]): string[] => items.map((i) => i.title);
const DAYS = (n: number): number => n * 24 * HOUR;
const undo = (n: number): Record<string, unknown> => ({ cap: "runs.undo", input: { runId: hex("run", n) } });

const mixed = [
  item("waiting", "Contract waits", { at: NOW - HOUR }),
  item("routine", "Morning inbox", { at: NOW - 5 * HOUR }),
  item("decision", "Booked the call", { at: NOW - 3 * HOUR, undo: undo(1) }),
  item("finished", "Intake review", { at: NOW - 2 * HOUR }),
  item("decision", "Moved the deadline", { at: NOW - HOUR, undo: undo(2) }),
  item("record_change", "Smith matter", { at: NOW - 4 * HOUR }),
  item("routine", "Morning inbox", { at: NOW - 2 * HOUR }),
];

test("write_digest ranks by kind (decisions, finished, record changes, routine results, waiting), newest first, a routine once", async () => {
  const h = harness();
  const { digestId } = await h.call("home.write_digest", newDigest({ items: mixed }), assistant);
  const d = (await h.call("home.digest", {}, alice)).digest;
  assert.equal(d.id, digestId);
  assert.deepEqual(titles(d.items), ["Moved the deadline", "Booked the call", "Intake review", "Smith matter", "Morning inbox", "Contract waits"]);
  assert.equal(d.items[4].at, NOW - 2 * HOUR, "the newest result of the routine is the one kept");
  assert.deepEqual(d.items[0].undo, undo(2), "each decision keeps its Undo");
  assert.deepEqual(d.headline, ["Two decisions were made for you.", "The intake review finished.", "One approval can wait."]);
  assert.equal(d.builtBy, assistant.id);
  assert.equal(d.seenAt, undefined);
});

test("at most seven items: the seven best by rank are kept, and eight are refused at the door", async () => {
  const h = harness();
  const seven = Array.from({ length: 7 }, (_, i) => item("waiting", `Waiting ${i}`, { at: NOW - i * MINUTE }));
  const { digestId } = await h.call("home.write_digest", newDigest({ items: [...seven] }), assistant);
  assert.equal((await h.call("home.digest", {}, alice)).digest.id, digestId);
  assert.equal((await h.call("home.digest", {}, alice)).digest.items.length, 7);
  await assert.rejects(h.call("home.write_digest", newDigest({ items: [...seven, item("waiting", "Eighth")] }), assistant), /invalid/);
  await assert.rejects(h.call("home.write_digest", newDigest({ headline: ["a", "b", "c", "d"] }), assistant), /invalid/);
});

test("the digest is a stored entity row: it reads with no call to another module (offline), items and headline kept as text", async () => {
  const h = harness();
  const { digestId } = await h.call("home.write_digest", newDigest({ items: mixed }), assistant);
  h.calls.length = 0;
  const d = (await h.call("home.digest", {}, alice)).digest;
  assert.equal(h.calls.length, 0, "home.digest reads the local row only");
  const row = h.db.all("SELECT * FROM home_digests WHERE id = ?", digestId)[0] as Record<string, unknown>;
  assert.equal(row.person, alice.id);
  assert.equal(row.period_end, NOW);
  assert.equal(row.built_by, assistant.id);
  assert.equal(row.version, 0);
  assert.deepEqual(JSON.parse(row.items as string), d.items);
  assert.deepEqual(JSON.parse(row.headline as string), d.headline);
  assert.equal(row.seen_at, null);
});

test("write_digest emits digest.written with the item count; the same idempotency key is the same digest", async () => {
  const h = harness();
  const a = await h.call("home.write_digest", newDigest({ items: mixed, idempotencyKey: "nightly-1" }), assistant);
  const b = await h.call("home.write_digest", newDigest({ items: mixed, idempotencyKey: "nightly-1" }), assistant);
  assert.deepEqual(a, b);
  assert.deepEqual(names(h), ["digest.written"]);
  assert.deepEqual(h.allEvents[0]!.payload, { digestId: a.digestId, person: alice.id, periodStart: NOW - 12 * HOUR, periodEnd: NOW, items: 6 });
  assert.equal(h.db.all("SELECT id FROM home_digests").length, 1);
});

test("a digest is seen once and resets: home.digest is empty until the next one is written", async () => {
  const h = harness();
  const { digestId } = await h.call("home.write_digest", newDigest(), assistant);
  h.advance(5 * MINUTE);
  assert.deepEqual(await h.call("home.mark_digest_seen", { digestId }, alice), { ok: true });
  assert.deepEqual(h.allEvents.at(-1)!.payload, { digestId, person: alice.id });
  assert.equal((await h.call("home.digest", {}, alice)).digest, null);
  const row = h.db.all("SELECT seen_at, version FROM home_digests WHERE id = ?", digestId)[0] as { seen_at: number; version: number };
  assert.deepEqual([row.seen_at, row.version], [NOW + 5 * MINUTE, 1]);
  const before = h.allEvents.length;
  assert.deepEqual(await h.call("home.mark_digest_seen", { digestId }, alice), { ok: true }, "seeing it twice is fine");
  assert.equal(h.allEvents.length, before, "and says nothing the second time");
  const next = await h.call("home.write_digest", newDigest({ periodStart: NOW, periodEnd: NOW + 12 * HOUR }), assistant);
  assert.equal((await h.call("home.digest", {}, alice)).digest.id, next.digestId);
});

test("home.digest gives the newest digest that was not seen", async () => {
  const h = harness();
  const old = await h.call("home.write_digest", newDigest({ periodStart: NOW - DAYS(2), periodEnd: NOW - DAYS(1) }), assistant);
  const mid = await h.call("home.write_digest", newDigest({ periodStart: NOW - DAYS(1), periodEnd: NOW }), assistant);
  assert.equal((await h.call("home.digest", {}, alice)).digest.id, mid.digestId);
  await h.call("home.mark_digest_seen", { digestId: mid.digestId }, alice);
  assert.equal((await h.call("home.digest", {}, alice)).digest.id, old.digestId, "the older one that was never seen is next");
});
test("each person sees only their own digest; only that person's assistant or the host writes it", async () => {
  const h = harness();
  await assert.rejects(h.call("home.write_digest", newDigest(), bob), (e) => codeOf(e) === "permission.not_found");
  await assert.rejects(h.call("home.write_digest", newDigest({ person: bob.id }), assistant), (e) => codeOf(e) === "permission.not_found", "an assistant acting for Alice cannot write Bob's");
  const mine = await h.call("home.write_digest", newDigest(), alice);
  const forBob = await h.call("home.write_digest", newDigest({ person: bob.id }), host);
  assert.equal((await h.call("home.digest", {}, alice)).digest.id, mine.digestId);
  assert.equal((await h.call("home.digest", {}, bob)).digest.id, forBob.digestId);
  await assert.rejects(h.call("home.mark_digest_seen", { digestId: mine.digestId }, bob), (e) => codeOf(e) === "permission.not_found");
  await assert.rejects(h.call("home.mark_digest_seen", { digestId: hex("dgs", 404) }, alice), (e) => codeOf(e) === "permission.not_found");
  assert.equal((await h.call("home.digest", {}, alice)).digest.id, mine.digestId, "Bob's attempt changed nothing");
});

test("a period that ends before it starts is refused", async () => {
  const h = harness();
  await assert.rejects(h.call("home.write_digest", newDigest({ periodStart: NOW, periodEnd: NOW - 1 }), assistant), (e) => codeOf(e) === "validation.bad_input" && reasonOf(e) === "bad_period");
  assert.equal(h.allEvents.length, 0);
});

// ---- See all ----

function activityWorld(h: Harness): void {
  const run = (n: number, over: Record<string, unknown>) => ({ id: hex("run", n), kind: "automation", owner: alice.id, startedBy: alice.id, status: "succeeded", startedAt: NOW - 10 * HOUR, ...over });
  h.callee("settings.get", () => ({ row: { value: "UTC" } }));
  h.callee("runs.list", () => ({
    runs: [
      run(1, { kind: "routine", name: "Morning inbox", summary: "12 emails sorted", endedAt: NOW - HOUR }),
      run(2, { kind: "routine", name: "Morning inbox", status: "failed", summary: "Mail was down", endedAt: NOW - 9 * HOUR }),
      run(3, { name: "Booked the call", startedBy: "agt_bot", summary: "Tuesday 3pm with Smith", endedAt: NOW - 3 * HOUR }),
      run(4, { kind: "journey", name: "Intake review", endedAt: NOW - 2 * HOUR }),
      run(5, { name: "Still going", status: "running" }),
      run(6, { name: "Agent failure", startedBy: "agt_bot", status: "failed", endedAt: NOW - HOUR }),
      run(7, { name: "Too late", endedAt: NOW - 10 * MINUTE }),
    ],
  }));
  h.callee("follows.list", () => ({ follows: [{ resource: { type: "record", id: hex("rec", 1) }, title: "Smith matter", at: NOW - 30 * HOUR }, { resource: { type: "channel", id: hex("chn", 1) }, title: "General", at: NOW }] }));
  h.callee("events.list", (i) => {
    assert.equal(i.subject.id, hex("rec", 1));
    return { events: [{ id: hex("evt", 1), type: "record.updated", at: NOW - 6 * HOUR, actor: "usr_carol" }, { id: hex("evt", 2), type: "record.updated", at: NOW - 4 * HOUR, actor: "usr_dan" }] };
  });
  h.callee("tasks.my_work", () => ({
    tasks: [
      { id: hex("tsk", 1), title: "Review the engagement letter", state: "todo", updatedAt: NOW - HOUR },
      { id: hex("tsk", 2), title: "Due this afternoon", state: "todo", due: NOW + HOUR },
      { id: hex("tsk", 3), title: "Next week", state: "doing", due: NOW + 3 * 24 * HOUR, updatedAt: NOW - 2 * HOUR },
      { id: hex("tsk", 4), title: "Already done", state: "done" },
    ],
  }));
}

test("See all: runs, decisions with Undo, followed records and what waits, ranked like the digest but complete", async () => {
  const h = harness();
  activityWorld(h);
  const r = await h.call("home.activity", { since: NOW - 12 * HOUR, until: NOW - 30 * MINUTE }, alice);
  assert.deepEqual(r.items.map((i: { kind: string; title: string }) => `${i.kind}:${i.title}`), [
    "decision:Booked the call", "finished:Intake review", "record_change:Smith matter",
    "routine:Morning inbox", "routine:Morning inbox", "waiting:Review the engagement letter", "waiting:Next week",
  ]);
  assert.equal(r.total, 7);
  assert.deepEqual(r.items[0].undo, { cap: "runs.undo", input: { runId: hex("run", 3) } });
  assert.deepEqual(r.items[2], { kind: "record_change", title: "Smith matter", line: "Changed by usr_dan.", subject: { type: "record", id: hex("rec", 1) }, at: NOW - 4 * HOUR });
  assert.equal(r.items[3].line, "12 emails sorted");
  assert.equal(r.items[4].line, "Mail was down", "every routine result is here, not one per routine");
  const runsCall = h.calls.find((c) => c.cap === "runs.list")!;
  assert.deepEqual(runsCall.input, { scope: "mine", since: NOW - 12 * HOUR, limit: 500 });
});

test("See all: filter by kind, page through, and the period defaults to now", async () => {
  const h = harness();
  activityWorld(h);
  const only = await h.call("home.activity", { since: NOW - 12 * HOUR, kinds: ["routine", "waiting"] }, alice);
  assert.deepEqual(only.items.map((i: { kind: string }) => i.kind), ["routine", "routine", "waiting", "waiting"]);
  const first = await h.call("home.activity", { since: NOW - 12 * HOUR, limit: 3 }, alice);
  assert.equal(first.items.length, 3);
  assert.equal(first.next, "3");
  const all = await h.call("home.activity", { since: NOW - 12 * HOUR }, alice);
  assert.equal(all.total, 8, "run 7 is inside the period when it runs to now");
  const second = await h.call("home.activity", { since: NOW - 12 * HOUR, limit: 3, cursor: first.next }, alice);
  assert.deepEqual(second.items.map((i: { title: string }) => i.title), all.items.slice(3, 6).map((i: { title: string }) => i.title));
  assert.equal(second.next, "6");
  const third = await h.call("home.activity", { since: NOW - 12 * HOUR, limit: 3, cursor: second.next }, alice);
  assert.equal(third.items.length, 2);
  assert.equal(third.next, undefined);
});
