// A Wait step driven by the engine (spec 2.13 Waiting; P-L6_03b): drive passes the step's first start, registers the wait extras (at, event, timeoutAt, cancelOn),
// a resumed Wait keeps waiting until its time, event or timeout, and a timeout ends the step with resumedBy timeout instead of failing the Run.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { engine, newRun, HOUR } from "../fixtures/seed.ts";
import { drive, sweepWaits, wake } from "../handlers/engine.ts";
import type { Executor, PlanStep, StepCall, StepResult } from "../handlers/engine.ts";
import { allSteps, readWait } from "../projections.ts";

const CANCEL = ["record.deleted"];
type In = { until?: number; event?: { event: string; filter?: Record<string, unknown> }; timeout?: number };

/** The shape of the steps-core Wait step: first call parks, a resumed call decides from the clock whether the wait is over. */
const waitExec: Executor = async (s: PlanStep, c: StepCall): Promise<StepResult> => {
  if (s.id !== "wait") return { output: { ran: s.id } };
  const i = s.input as In;
  const now = h0.now();
  const hasEvent = i.event !== undefined;
  const timeoutAt = hasEvent ? c.startedAt + (i.timeout ?? 30 * 86_400_000) : undefined;
  if (c.resumed) {
    if (i.until !== undefined && now < i.until) return { wait: { reason: "background", on: "a time", at: i.until, cancelOn: CANCEL } };
    if (hasEvent && timeoutAt !== undefined && now < timeoutAt && !seenEvent) return { wait: { reason: "background", on: "an event", event: i.event!, timeoutAt, cancelOn: CANCEL } };
    return { output: { resumedBy: hasEvent ? (seenEvent ? "event" : "timeout") : "time", at: now } };
  }
  return { wait: { reason: "background", on: hasEvent ? `event ${i.event!.event}` : "a time", ...(i.until !== undefined ? { at: i.until } : {}), ...(hasEvent ? { event: i.event!, timeoutAt: timeoutAt! } : {}), cancelOn: CANCEL } };
};
let h0: Harness;
let seenEvent = false;

async function setup(input: In): Promise<{ h: Harness; id: string; plan: PlanStep[] }> {
  const h = harness();
  h0 = h;
  seenEvent = false;
  const id = (await h.call("runs.start", newRun({ name: "Intake" }), engine)).runId as string;
  return { h, id, plan: [{ id: "wait", input }, { id: "after" }] };
}
const stepsOf = (h: Harness, id: string): string[] => allSteps(h.db, id).map((s) => `${s.step}#${s.attempt}:${s.state}`);
const run = async (h: Harness, id: string): Promise<any> => (await h.call("runs.get", { runId: id }, engine)).run;   // eslint-disable-line @typescript-eslint/no-explicit-any

test("wait until a time: drive registers the time; an early wake keeps waiting; the sweep at the time lets the Run go on", async () => {
  const { h, id, plan } = await setup({});
  const at = h.now() + HOUR;
  plan[0]!.input = { until: at };
  assert.deepEqual(await h.engineRun(engine, (ctx) => drive(ctx, id, plan, waitExec)), { status: "waiting" });
  assert.deepEqual(readWait(h.db, id)?.on, { at });
  assert.deepEqual(readWait(h.db, id)?.cancelOn, CANCEL);
  h.advance(HOUR - 1);
  assert.deepEqual(await h.engineRun(engine, (ctx) => sweepWaits(ctx)), []);
  h.advance(1);
  assert.deepEqual(await h.engineRun(engine, (ctx) => sweepWaits(ctx)), [id]);
  assert.equal((await run(h, id)).status, "running");
  assert.deepEqual(await h.engineRun(engine, (ctx) => drive(ctx, id, plan, waitExec)), { status: "succeeded" });
  assert.deepEqual(stepsOf(h, id), ["wait#1:succeeded", "after#1:succeeded"]);
});

test("a resumed Wait keeps waiting: a wake before its time parks the Run again on the same attempt with the first start time", async () => {
  const { h, id, plan } = await setup({});
  const at = h.now() + HOUR;
  plan[0]!.input = { until: at };
  await h.engineRun(engine, (ctx) => drive(ctx, id, plan, waitExec));
  const first = allSteps(h.db, id)[0]!.startedAt;
  h.advance(10 * 60_000);
  await h.call("runs.resume", { runId: id }, engine);   // an early wake
  const calls: StepCall[] = [];
  const spy: Executor = async (s, c) => { calls.push(c); return waitExec(s, c); };
  assert.deepEqual(await h.engineRun(engine, (ctx) => drive(ctx, id, plan, spy)), { status: "waiting" });
  assert.equal(calls[0]!.startedAt, first);
  assert.equal(calls[0]!.resumed, true);
  assert.deepEqual(readWait(h.db, id)?.on, { at });
  assert.deepEqual(stepsOf(h, id), ["wait#1:waiting"]);
  assert.equal(allSteps(h.db, id)[0]!.startedAt, first);
});

test("wait for an event: the matching event wakes the Run and the step ends with resumedBy event", async () => {
  const { h, id, plan } = await setup({ event: { event: "record.updated", filter: { recordId: "rec_1" } }, timeout: 2 * HOUR });
  const t0 = h.now();
  await h.engineRun(engine, (ctx) => drive(ctx, id, plan, waitExec));
  assert.deepEqual(readWait(h.db, id)?.on, { event: "record.updated", filter: { recordId: "rec_1" } });
  assert.equal(readWait(h.db, id)?.untilAt, t0 + 2 * HOUR);
  assert.deepEqual(await h.engineRun(engine, (ctx) => wake(ctx, { type: "record.updated", payload: { recordId: "rec_x" } })), []);
  seenEvent = true;
  assert.deepEqual(await h.engineRun(engine, (ctx) => wake(ctx, { type: "record.updated", payload: { recordId: "rec_1" } })), [id]);
  assert.deepEqual(await h.engineRun(engine, (ctx) => drive(ctx, id, plan, waitExec)), { status: "succeeded" });
  const out = JSON.parse(allSteps(h.db, id)[0]!.outputJson!);
  assert.equal(out.resumedBy, "event");
});

test("a Wait step that times out ends the step with resumedBy timeout; the Run does not fail", async () => {
  const { h, id, plan } = await setup({ event: { event: "record.updated" }, timeout: HOUR });
  await h.engineRun(engine, (ctx) => drive(ctx, id, plan, waitExec));
  h.advance(HOUR - 1);
  assert.deepEqual(await h.engineRun(engine, (ctx) => sweepWaits(ctx)), []);
  h.advance(1);
  assert.deepEqual(await h.engineRun(engine, (ctx) => sweepWaits(ctx)), [id]);
  assert.equal((await run(h, id)).status, "running");
  assert.deepEqual(await h.engineRun(engine, (ctx) => drive(ctx, id, plan, waitExec)), { status: "succeeded" });
  assert.equal(JSON.parse(allSteps(h.db, id)[0]!.outputJson!).resumedBy, "timeout");
  assert.ok(!h.allEvents.some((e) => e.name === "run.failed"));
  assert.deepEqual(stepsOf(h, id), ["wait#1:succeeded", "after#1:succeeded"]);
});

test("cancelOn: a cancel event stops the Run waiting in a step and no later step runs", async () => {
  const { h, id, plan } = await setup({ event: { event: "record.updated" } });
  await h.engineRun(engine, (ctx) => drive(ctx, id, plan, waitExec));
  assert.deepEqual(await h.engineRun(engine, (ctx) => wake(ctx, { type: "record.deleted", payload: {} })), []);
  assert.equal((await run(h, id)).status, "stopped");
  assert.deepEqual(await h.engineRun(engine, (ctx) => drive(ctx, id, plan, waitExec)), { status: "stopped" });
  assert.deepEqual(stepsOf(h, id), ["wait#1:stopped"]);
});
