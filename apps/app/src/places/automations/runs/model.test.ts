// A run reads its steps by name: the step's own title, else what it does, never the stored id.
import test from "node:test";
import assert from "node:assert/strict";
import { stepNamer, stepRows } from "./model.ts";
import type { RunStep } from "./model.ts";

const nodes = [
  { id: "step_1", key: "send_email", title: "Email the client" },
  { id: "n_7f3a", key: "wait", input: { forDuration: "2d" } },
  { id: "step_3", key: "send_email" },
  { id: "step_4", key: "records.update" },
];
const st = (step: string, state: string): RunStep => ({ step, state, attempt: 1 }) as unknown as RunStep;

test("step ids resolve to the step's title, then to what the step does, never the id", () => {
  const n = stepNamer(nodes);
  assert.equal(n("step_1"), "Email the client");
  assert.equal(n("n_7f3a"), "Wait 2 days");
  assert.equal(n("step_3"), "Send an email");
  assert.equal(n("step_4"), "Update");
  assert.equal(n("step_9"), "Step 9");
  assert.equal(n("q"), "A step");
});

test("the run's step rows carry those names", () => {
  const rows = stepRows({ startedAt: 0 }, [st("step_1", "succeeded"), st("n_7f3a", "failed"), st("step_3", "running")], stepNamer(nodes));
  assert.deepEqual(rows.map((r) => (r as { text: string }).text), ["Email the client", "Wait 2 days failed", "Send an email, running"]);
  for (const r of rows) assert.doesNotMatch((r as { text: string }).text, /step_|n_7f3a/);
});
