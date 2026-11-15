// A test run answers a write or outward step with its sample, but a step whose required input is empty stops the way the real call would: a stopped test is not a success.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { runStep } from "../handlers/control.ts";
import type { StepCall } from "../handlers/control.ts";

const call = (over: Partial<StepCall> = {}): StepCall =>
  ({ attempt: 1, key: "in:run_t1:s:1", outputs: {}, resumed: false, trigger: {}, ...over }) as StepCall;

test("in a sandbox a step with an empty required input is refused and names the field", async () => {
  const h = harness({});
  await assert.rejects(
    () => runStep(h.env, { id: "s", key: "create_task", input: { title: "Follow up" } }, call({ sandbox: true })),
    (e: { error?: { code?: string; message?: string } }) =>
      e.error?.code === "validation.bad_input" && e.error?.message === "Create a task: choose who it is for.",
  );
  assert.equal(h.log.length, 0);
});

test("in a sandbox a step with its required inputs answers with its sample", async () => {
  const h = harness({});
  const r = await runStep(
    h.env,
    { id: "s", key: "post_message", input: { channelId: "chn_a1b2c3", text: "Hello" } },
    call({ sandbox: true }),
  );
  assert.ok(r.output !== undefined);
  assert.equal(h.log.length, 0);
});
