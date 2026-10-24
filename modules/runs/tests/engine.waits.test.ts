// Waits (spec runs.wait_for, 2.13 Waiting): waiting for an event, another Run or a time; matching, cancel-on events, timeouts, the 30 day default.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, reasonOf } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { alice, bot, engine, newRun, DAY, HOUR } from "../fixtures/seed.ts";
import { sweepWaits, wake } from "../handlers/engine.ts";
import { readWait, saveWait } from "../projections.ts";

const names = (h: Harness): string[] => h.allEvents.map((e) => e.name);
const get = async (h: Harness, id: string): Promise<any> => (await h.call("runs.get", { runId: id }, engine)).run;   // eslint-disable-line @typescript-eslint/no-explicit-any
const tasks = (h: Harness): any[] => {   // eslint-disable-line @typescript-eslint/no-explicit-any
  const made: any[] = [];   // eslint-disable-line @typescript-eslint/no-explicit-any
  h.callee("tasks.create", (input) => { made.push(input); return { task: { id: `tsk_n${made.length}` } }; });
  return made;
};

test("wait_for an event: a Run of kind wait is created waiting; an event that does not match leaves it, one that does ends it", async () => {
  const h = harness();
  const r = await h.call("runs.wait_for", { on: { event: "record.updated", filter: { recordId: "rec_1" } }, label: "Client reply", subject: { type: "record", id: "rec_1" } }, alice);
  assert.deepEqual(names(h), ["run.started", "run.waiting"]);
  const run = await get(h, r.runId);
  assert.equal(run.kind, "wait");
  assert.equal(run.status, "waiting");
  assert.equal(run.waitReason, "background");
  assert.equal(run.owner, alice.id);
  assert.equal(run.name, "Client reply");
  assert.deepEqual(h.allEvents[1]!.payload, { runId: r.runId, reason: "background", on: "event record.updated" });

  assert.deepEqual(await h.engineRun(engine, (ctx) => wake(ctx, { type: "record.updated", payload: { recordId: "rec_other" } })), []);
  assert.deepEqual(await h.engineRun(engine, (ctx) => wake(ctx, { type: "record.created", payload: { recordId: "rec_1" } })), []);
  assert.equal((await get(h, r.runId)).status, "waiting");
  assert.deepEqual(await h.engineRun(engine, (ctx) => wake(ctx, { type: "record.updated", payload: { recordId: "rec_1", fields: {} } })), [r.runId]);
  const done = await get(h, r.runId);
  assert.equal(done.status, "succeeded");
  assert.equal(done.summary, "Matched record.updated.");
  assert.equal(readWait(h.db, r.runId), undefined);
  assert.ok(names(h).includes("run.succeeded"));
});

test("an event pattern with a star matches the whole family", async () => {
  const h = harness();
  const r = await h.call("runs.wait_for", { on: { event: "record.*" } }, alice);
  assert.deepEqual(await h.engineRun(engine, (ctx) => wake(ctx, { type: "task.created", payload: {} })), []);
  assert.deepEqual(await h.engineRun(engine, (ctx) => wake(ctx, { type: "record.deleted", payload: {} })), [r.runId]);
});

test("an agent that waits on someone's behalf leaves the Run with that person", async () => {
  const h = harness();
  const r = await h.call("runs.wait_for", { on: { event: "message.received" } }, bot);
  assert.equal((await get(h, r.runId)).owner, alice.id);
  assert.equal((await get(h, r.runId)).startedBy, bot.id);
});

test("the default timeout is 30 days; at the deadline the wait ends and says it timed out", async () => {
  const h = harness();
  const t0 = h.now();
  const r = await h.call("runs.wait_for", { on: { event: "message.received" }, label: "the reply" }, alice);
  assert.equal(readWait(h.db, r.runId)?.untilAt, t0 + 30 * DAY);
  h.advance(30 * DAY - 1);
  assert.deepEqual(await h.engineRun(engine, (ctx) => sweepWaits(ctx)), []);
  h.advance(1);
  assert.deepEqual(await h.engineRun(engine, (ctx) => sweepWaits(ctx)), [r.runId]);
  const run = await get(h, r.runId);
  assert.equal(run.status, "succeeded");
  assert.equal(run.summary, "Timed out waiting for the reply.");
});

test("a custom timeout is read as seconds, minutes, hours, days or weeks; anything else is refused", async () => {
  const h = harness();
  const t0 = h.now();
  const r = await h.call("runs.wait_for", { on: { event: "x.y" }, timeout: "6h" }, alice);
  assert.equal(readWait(h.db, r.runId)?.untilAt, t0 + 6 * HOUR);
  const w = await h.call("runs.wait_for", { on: { event: "x.y" }, timeout: "2w" }, alice);
  assert.equal(readWait(h.db, w.runId)?.untilAt, t0 + 14 * DAY);
  await assert.rejects(h.call("runs.wait_for", { on: { event: "x.y" }, timeout: "soon" }, alice), (e) => { assert.equal(codeOf(e), "validation.precondition_failed"); assert.equal(reasonOf(e), "bad_duration"); return true; });
});

test("wait for a time: the wait ends when the time comes", async () => {
  const h = harness();
  const at = h.now() + HOUR;
  const r = await h.call("runs.wait_for", { on: { at } }, alice);
  h.advance(HOUR - 1);
  assert.deepEqual(await h.engineRun(engine, (ctx) => sweepWaits(ctx)), []);
  h.advance(1);
  assert.deepEqual(await h.engineRun(engine, (ctx) => sweepWaits(ctx)), [r.runId]);
  assert.equal((await get(h, r.runId)).summary, "The time came.");
});

test("wait for another Run: the Run's end event wakes the wait; a Run that already ended is found by the next sweep", async () => {
  const h = harness();
  const target = (await h.call("runs.start", newRun(), engine)).runId as string;
  const w = await h.call("runs.wait_for", { on: { run: target } }, alice);
  assert.equal((await get(h, w.runId)).status, "waiting");
  assert.deepEqual(await h.engineRun(engine, (ctx) => wake(ctx, { type: "run.succeeded", payload: { runId: "run_other" } })), []);
  await h.call("runs.finish", { runId: target, status: "succeeded" }, engine);
  assert.deepEqual(await h.engineRun(engine, (ctx) => wake(ctx, { type: "run.succeeded", payload: { runId: target } })), [w.runId]);
  const done = await get(h, w.runId);
  assert.equal(done.status, "succeeded");
  assert.equal(done.summary, `Run ${target} succeeded.`);
  const late = await h.call("runs.wait_for", { on: { run: target } }, alice);
  assert.equal((await get(h, late.runId)).status, "waiting");
  assert.deepEqual(await h.engineRun(engine, (ctx) => sweepWaits(ctx)), [late.runId]);
  assert.equal((await get(h, late.runId)).status, "succeeded");
  await assert.rejects(h.call("runs.wait_for", { on: { run: "run_nothere" } }, alice), (e) => codeOf(e) === "validation.not_found");
});

test("an engine Run waiting in the background wakes into Running; its timeout fails it into Needs you", async () => {
  const h = harness();
  const made = tasks(h);
  const id = (await h.call("runs.start", newRun({ name: "Intake" }), engine)).runId as string;
  await h.call("runs.mark_waiting", { runId: id, reason: "background" }, engine);
  saveWait(h.db, { runId: id, reason: "background", on: { event: "email.received" }, untilAt: h.now() + HOUR, createdAt: h.now() });
  assert.deepEqual(await h.engineRun(engine, (ctx) => wake(ctx, { type: "email.received", payload: {} })), [id]);
  assert.equal((await get(h, id)).status, "running");
  assert.ok(names(h).includes("run.resumed"));

  const slow = (await h.call("runs.start", newRun({ name: "Intake" }), engine)).runId as string;
  await h.call("runs.mark_waiting", { runId: slow, reason: "background" }, engine);
  saveWait(h.db, { runId: slow, reason: "background", untilAt: h.now() + HOUR, createdAt: h.now() });
  h.advance(HOUR);
  assert.deepEqual(await h.engineRun(engine, (ctx) => sweepWaits(ctx)), [slow]);
  const run = await get(h, slow);
  assert.equal(run.status, "failed");
  const failed = h.allEvents.filter((e) => e.name === "run.failed").pop()!;
  assert.equal(failed.payload.code, "run.wait_timeout");
  assert.equal(made.length, 1);
  assert.equal(made[0].idempotencyKey, `run-failed:${slow}`);
});

test("a cancel-on event stops the waiting Run instead of waking it", async () => {
  const h = harness();
  const id = (await h.call("runs.start", newRun(), engine)).runId as string;
  await h.call("runs.mark_waiting", { runId: id, reason: "approval", taskId: "tsk_a1" }, engine);
  saveWait(h.db, { runId: id, reason: "approval", on: { event: "task.completed" }, cancelOn: ["automation.disabled"], taskId: "tsk_a1", createdAt: h.now() });
  assert.deepEqual(await h.engineRun(engine, (ctx) => wake(ctx, { type: "automation.disabled", payload: {} })), []);
  const run = await get(h, id);
  assert.equal(run.status, "stopped");
  const ev = h.allEvents.filter((e) => e.name === "run.stopped").pop()!;
  assert.deepEqual(ev.payload, { runId: id, by: "system", reason: "Canceled by automation.disabled." });
});
