// A Personal Space on several computers (lane l-multidevice): a send inside a scheduled Run happens only on the computer that holds the schedule lease at that moment. On any other computer the
// step is refused with "not the scheduling computer" (host/src/invoke.ts); the Run then waits, the lease holder's wait sweep resumes it when its time comes, and the step runs there once, with the
// same key. So two computers that both believed they held the lease cannot both send: the one that does not hold it now parks instead.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { engine, newRun } from "../fixtures/seed.ts";
import { SCHEDULER_WAIT_MS, drive, sweepWaits } from "../handlers/engine.ts";
import type { Executor, PlanStep } from "../handlers/engine.ts";
import { allSteps, readWait } from "../projections.ts";

test("a send on a computer without the lease parks the Run; the holder resumes it and the send happens once", async () => {
  const h = harness();
  const id = (await h.call("runs.start", newRun({ name: "Weekly email" }), engine)).runId as string;
  const plan: PlanStep[] = [{ id: "prepare" }, { id: "send", effects: "outward" } as PlanStep];
  const sent: string[] = [];
  let holder = false;
  const exec: Executor = async (s, c) => {
    if (s.id !== "send") return { output: { ran: s.id } };
    if (!holder) throw Object.assign(new Error("Waiting for the computer that runs scheduled work."), { error: { code: "internal.unavailable", message: "Waiting for the computer that runs scheduled work.", retryable: true, details: { reason: "not_scheduling_computer" } } });
    sent.push(c.key);
    return { output: { sent: true } };
  };
  // this computer lost the lease between the tick and the send: the Run waits instead of retrying or failing
  assert.deepEqual(await h.engineRun(engine, (ctx) => drive(ctx, id, plan, exec)), { status: "waiting" });
  assert.deepEqual(sent, [], "nothing was sent here");
  assert.equal(readWait(h.db, id)?.label, "the computer that runs scheduled work");
  assert.deepEqual(readWait(h.db, id)?.on, { at: h.now() + SCHEDULER_WAIT_MS });
  // the holder's sweep resumes it when the time comes, and the step runs there
  h.advance(SCHEDULER_WAIT_MS);
  assert.deepEqual(await h.engineRun(engine, (ctx) => sweepWaits(ctx)), [id]);
  holder = true;
  assert.deepEqual(await h.engineRun(engine, (ctx) => drive(ctx, id, plan, exec)), { status: "succeeded" });
  assert.equal(sent.length, 1, "sent once");
  assert.deepEqual(allSteps(h.db, id).map((s) => `${s.step}:${s.state}`).filter((x) => x.startsWith("send")).pop(), "send:succeeded");
});
