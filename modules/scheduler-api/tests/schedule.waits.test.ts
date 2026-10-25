// Background waits (spec 2.13 Waiting, 2.12): register on an event, a Run or a time with a timeout and cancel conditions; match, expire and cancel wake the Run through the runs module.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, host, NOW, MINUTE, HOUR, DAY } from "../fixtures/seed.ts";

const runId = (n: number): string => `run_${n.toString(16).padStart(32, "0")}`;
const eventId = (n: number): string => `evt_${n.toString(16).padStart(32, "0")}`;
const names = (h: Harness): string[] => h.allEvents.map((e) => e.name);
interface Ev { type: string; subject?: { type: string; id: string }; payload?: unknown }

/** The runs and events modules as far as the scheduler uses them. */
function world(h: Harness, kinds: Record<string, string> = {}): { events: Map<string, Ev>; woke: { cap: string; input: any }[]; add(n: number, ev: Ev): string } {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const events = new Map<string, Ev>();
  const woke: { cap: string; input: any }[] = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
  h.callee("events.get", (i) => ({ event: { id: i.eventId, ...events.get(i.eventId)! } }));
  h.callee("runs.get", (i) => ({ run: { id: i.runId, kind: kinds[i.runId] ?? "automation", status: "waiting" } }));
  for (const cap of ["runs.resume", "runs.finish", "runs.stop"]) h.callee(cap, (i) => { woke.push({ cap, input: i }); return { run: { id: i.runId } }; });
  return { events, woke, add(n, ev) { events.set(eventId(n), ev); return eventId(n); } };
}
const reg = (h: Harness, over: Record<string, unknown>) => h.call("scheduler.waits.register", { runId: runId(1), on: { event: "record.updated" }, ...over }, host);

test("register: an event wait gets the default 30 day timeout, a registered event, and an idempotency key", async () => {
  const h = harness();
  const r = await reg(h, { on: { event: "record.updated", filter: { recordId: "rec_1" } }, idempotencyKey: "w1" });
  assert.equal(r.expiresAt, NOW + 30 * DAY);
  assert.deepEqual(names(h), ["wait.registered"]);
  assert.deepEqual(h.allEvents[0]!.payload, { waitId: r.waitId, runId: runId(1), on: { event: "record.updated", filter: { recordId: "rec_1" } }, expiresAt: NOW + 30 * DAY });
  assert.deepEqual(await reg(h, { idempotencyKey: "w1" }), r, "the same key is the same wait");
  assert.equal(h.allEvents.length, 1);
  const open = await h.call("scheduler.waits.list", {}, host);
  assert.equal(open.total, 1);
  assert.equal(open.waits[0].state, "open");
});

test("register: a custom timeout, the Space setting for the default, and a bad duration is refused", async () => {
  const h = harness();
  assert.equal((await reg(h, { timeout: "6h" })).expiresAt, NOW + 6 * HOUR);
  assert.equal((await reg(h, { timeout: "2w" })).expiresAt, NOW + 14 * DAY);
  h.policy("scheduler.default_wait_timeout", "7d");
  assert.equal((await reg(h, {})).expiresAt, NOW + 7 * DAY);
  await assert.rejects(reg(h, { timeout: "soon" }), (e) => codeOf(e) === "validation.precondition_failed" && reasonOf(e) === "bad_duration");
  await assert.rejects(reg(h, { timeout: "0s" }), (e) => reasonOf(e) === "bad_duration");
});

test("list: filters open waits by Run, subject and thread", async () => {
  const h = harness();
  const subject = { type: "record", id: "rec_9" };
  const a = await reg(h, { runId: runId(1), subject, threadId: "thr_" + "a".repeat(32) });
  await reg(h, { runId: runId(2) });
  assert.equal((await h.call("scheduler.waits.list", { runId: runId(2) }, host)).total, 1);
  assert.deepEqual((await h.call("scheduler.waits.list", { subject }, host)).waits.map((w: any) => w.id), [a.waitId]);   // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal((await h.call("scheduler.waits.list", { threadId: "thr_" + "a".repeat(32) }, host)).total, 1);
  assert.equal((await h.call("scheduler.waits.list", { threadId: "thr_" + "b".repeat(32) }, host)).total, 0);
});

test("match: an event of the right type and filter wakes the Run; others leave it waiting", async () => {
  const h = harness();
  const w = world(h);
  const r = await reg(h, { on: { event: "record.updated", filter: { recordId: "rec_1" } } });
  assert.deepEqual(await h.call("scheduler.waits.match", { eventId: w.add(1, { type: "record.updated", payload: { recordId: "rec_other" } }) }, host), { matched: 0 });
  assert.deepEqual(await h.call("scheduler.waits.match", { eventId: w.add(2, { type: "record.created", payload: { recordId: "rec_1" } }) }, host), { matched: 0 });
  assert.equal(w.woke.length, 0);
  const ev = w.add(3, { type: "record.updated", payload: { recordId: "rec_1", fields: { a: 1 } } });
  assert.deepEqual(await h.call("scheduler.waits.match", { eventId: ev }, host), { matched: 1 });
  assert.deepEqual(w.woke, [{ cap: "runs.resume", input: { runId: runId(1), reason: "background" } }]);
  assert.deepEqual(h.allEvents.at(-1)!.payload, { waitId: r.waitId, runId: runId(1), matchedEventId: ev });
  assert.equal((await h.call("scheduler.waits.list", {}, host)).total, 0, "a matched wait is no longer open");
  assert.deepEqual(await h.call("scheduler.waits.match", { eventId: ev }, host), { matched: 0 }, "the same event again does nothing");
  assert.equal(w.woke.length, 1);
});

test("match: a Run of kind wait is finished with a summary the waking thread reads; a star pattern matches the family", async () => {
  const h = harness();
  const w = world(h, { [runId(1)]: "wait" });
  await reg(h, { on: { event: "record.*" } });
  await h.call("scheduler.waits.match", { eventId: w.add(1, { type: "task.created", payload: {} }) }, host);
  assert.equal(w.woke.length, 0);
  await h.call("scheduler.waits.match", { eventId: w.add(2, { type: "record.deleted", payload: {} }) }, host);
  assert.deepEqual(w.woke, [{ cap: "runs.finish", input: { runId: runId(1), status: "succeeded", summary: "Matched record.deleted." } }]);
});

test("match: a wait on another Run ends when that Run ends, whichever way", async () => {
  const h = harness();
  const w = world(h);
  await reg(h, { runId: runId(1), on: { run: runId(7) } });
  await reg(h, { runId: runId(2), on: { run: runId(8) } });
  await h.call("scheduler.waits.match", { eventId: w.add(1, { type: "run.started", payload: { runId: runId(7) } }) }, host);
  await h.call("scheduler.waits.match", { eventId: w.add(2, { type: "run.succeeded", payload: { runId: runId(9) } }) }, host);
  assert.equal(w.woke.length, 0);
  assert.deepEqual(await h.call("scheduler.waits.match", { eventId: w.add(3, { type: "run.failed", payload: { runId: runId(7) } }) }, host), { matched: 1 });
  assert.deepEqual(w.woke.map((x) => x.input.runId), [runId(1)]);
  assert.deepEqual(await h.call("scheduler.waits.match", { eventId: w.add(4, { type: "run.stopped", payload: { runId: runId(8) } }) }, host), { matched: 1 });
});

test("match: one event wakes every wait it matches", async () => {
  const h = harness();
  const w = world(h);
  await reg(h, { runId: runId(1) });
  await reg(h, { runId: runId(2), on: { event: "record.*" } });
  await reg(h, { runId: runId(3), on: { event: "record.updated", filter: { a: 2 } } });
  assert.deepEqual(await h.call("scheduler.waits.match", { eventId: w.add(1, { type: "record.updated", payload: { a: 1 } }) }, host), { matched: 2 });
  assert.deepEqual(w.woke.map((x) => x.input.runId).sort(), [runId(1), runId(2)]);
});

test("match: an event that cancels the wait stops the Run; a deleted subject record is the usual one", async () => {
  const h = harness();
  const w = world(h);
  const subject = { type: "record", id: "rec_5" };
  const r = await reg(h, { on: { event: "record.updated" }, subject, cancelsOn: ["record.deleted", "journey.stage_exited"] });
  // another record deleted: nothing happens
  await h.call("scheduler.waits.match", { eventId: w.add(1, { type: "record.deleted", subject: { type: "record", id: "rec_6" }, payload: { recordId: "rec_6" } }) }, host);
  assert.equal(w.woke.length, 0);
  assert.deepEqual(await h.call("scheduler.waits.match", { eventId: w.add(2, { type: "record.deleted", subject, payload: {} }) }, host), { matched: 0 });
  assert.deepEqual(w.woke, [{ cap: "runs.stop", input: { runId: runId(1), reason: "Canceled by record.deleted." } }]);
  assert.deepEqual(h.allEvents.at(-1)!.payload, { waitId: r.waitId, runId: runId(1), reason: "subject_deleted" });
  assert.equal((await h.call("scheduler.waits.list", {}, host)).total, 0);

  // leaving the stage: the event names the record in its payload
  const h2 = harness();
  const w2 = world(h2);
  await reg(h2, { subject, cancelsOn: ["journey.stage_exited"] });
  await h2.call("scheduler.waits.match", { eventId: w2.add(1, { type: "journey.stage_exited", payload: { recordId: "rec_5", stage: "Intake" } }) }, host);
  assert.equal(h2.allEvents.at(-1)!.payload.reason, "left_stage");
});

test("match: a wait with no subject is canceled by an event about its own Run; a cancel wins over a match in the same event", async () => {
  const h = harness();
  const w = world(h);
  await reg(h, { on: { event: "run.stopped", filter: { runId: runId(1) } }, cancelsOn: ["run.stopped"] });
  await h.call("scheduler.waits.match", { eventId: w.add(1, { type: "run.stopped", payload: { runId: runId(2) } }) }, host);
  assert.equal(w.woke.length, 0, "another Run stopped: not about this wait");
  assert.deepEqual(await h.call("scheduler.waits.match", { eventId: w.add(2, { type: "run.stopped", payload: { runId: runId(1) } }) }, host), { matched: 0 });
  assert.equal(h.allEvents.at(-1)!.payload.reason, "stopped");
  assert.deepEqual(w.woke.map((x) => x.cap), ["runs.stop"]);
});

test("match: a Run that is gone or already woken is not an error, and the wait still closes", async () => {
  const h = harness();
  const w = world(h);
  h.callee("runs.resume", () => { throw Object.assign(new Error("not waiting"), { error: { code: "validation.precondition_failed" } }); });
  await reg(h, {});
  assert.deepEqual(await h.call("scheduler.waits.match", { eventId: w.add(1, { type: "record.updated", payload: {} }) }, host), { matched: 1 });
  assert.equal((await h.call("scheduler.waits.list", {}, host)).total, 0);
  h.callee("runs.resume", () => { throw Object.assign(new Error("db down"), { error: { code: "internal.unavailable" } }); });
  await reg(h, { runId: runId(2) });
  await assert.rejects(h.call("scheduler.waits.match", { eventId: w.add(2, { type: "record.updated", payload: {} }) }, host));
  assert.equal((await h.call("scheduler.waits.list", {}, host)).total, 1, "a real failure leaves the wait open for the next try");
});

test("match: an unknown event is refused", async () => {
  const h = harness();
  h.callee("events.get", () => ({}));
  await assert.rejects(h.call("scheduler.waits.match", { eventId: eventId(404) }, host), (e) => codeOf(e) === "validation.not_found");
});

test("expire: waits past their timeout wake their Run with a timeout summary; those not yet due stay", async () => {
  const h = harness();
  const w = world(h, { [runId(1)]: "wait" });
  const a = await reg(h, { timeout: "1h", on: { event: "message.received" } });
  await reg(h, { runId: runId(2), timeout: "3h" });
  h.advance(HOUR - 1);
  assert.deepEqual(await h.call("scheduler.waits.expire", {}, host), { expired: 0 });
  h.advance(1);
  assert.deepEqual(await h.call("scheduler.waits.expire", {}, host), { expired: 1 });
  assert.deepEqual(w.woke, [{ cap: "runs.finish", input: { runId: runId(1), status: "succeeded", summary: "Timed out waiting for message.received." } }]);
  assert.deepEqual(h.allEvents.at(-1)!.payload, { waitId: a.waitId, runId: runId(1) });
  assert.equal((await h.call("scheduler.waits.list", {}, host)).total, 1);
  assert.deepEqual(await h.call("scheduler.waits.expire", {}, host), { expired: 0 }, "once");
  h.advance(2 * HOUR);
  assert.deepEqual(await h.call("scheduler.waits.expire", {}, host), { expired: 1 });
  assert.deepEqual(w.woke.at(-1), { cap: "runs.resume", input: { runId: runId(2), reason: "background" } }, "a step's Run is resumed and its step reads the clock");
});

test("a wait on a time ends at that time", async () => {
  const h = harness();
  const w = world(h, { [runId(1)]: "wait" });
  const at = NOW + 90 * MINUTE;
  const r = await reg(h, { on: { at } });
  assert.equal(r.expiresAt, at);
  h.setNow(at - 1);
  assert.deepEqual(await h.call("scheduler.waits.expire", {}, host), { expired: 0 });
  h.setNow(at);
  assert.deepEqual(await h.call("scheduler.waits.expire", {}, host), { expired: 1 });
  assert.equal((w.woke[0]!.input as { summary: string }).summary, "The time came.");
});

test("cancel: closes an open wait once, with its reason; an unknown wait is refused", async () => {
  const h = harness();
  const r = await reg(h, {});
  assert.deepEqual(await h.call("scheduler.waits.cancel", { waitId: r.waitId, reason: "manual" }, host), { canceled: true });
  assert.deepEqual(h.allEvents.at(-1)!.payload, { waitId: r.waitId, runId: runId(1), reason: "manual" });
  assert.deepEqual(await h.call("scheduler.waits.cancel", { waitId: r.waitId, reason: "manual" }, host), { canceled: false });
  assert.equal(h.allEvents.filter((e) => e.name === "wait.canceled").length, 1);
  await assert.rejects(h.call("scheduler.waits.cancel", { waitId: "wat_" + "0".repeat(32), reason: "manual" }, host), (e) => codeOf(e) === "validation.not_found");
  assert.equal((await h.call("scheduler.status", {}, alice)).openWaits, 0);
});
