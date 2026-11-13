import test from "node:test";
import assert from "node:assert/strict";
import { runView } from "./model.ts";
import type { StepIn } from "../story/model.ts";

const step = (id: string, action: string, extra: Partial<StepIn> = {}): StepIn => ({
  id,
  app: { id: "vyre", name: "Vyre" },
  action,
  template: action,
  values: {},
  ...extra,
});

test("a run is numbered as the builder is, with the failed step in words and its one fix", () => {
  const steps = [
    step("a", "Make a task"),
    step("b", "Text to me", { writes: true }),
    step("c", "Post in #ops", { writes: true }),
  ];
  const r = runView(steps, {
    a: { status: "ok", line: "Task for Lena, due in 2 days", values: [["Title", "Follow up"]] },
    b: { status: "failed", line: "", why: "The Twilio key is missing.", fix: "Add the key" },
  });
  assert.deepEqual(
    r.rows.map((x) => [x.number, x.mark, x.tag, x.line]),
    [
      [1, "done", null, "Task for Lena, due in 2 days"],
      [2, "failed", null, null],
      [3, "skipped", null, null],
    ],
  );
  assert.deepEqual(r.banner, {
    title: "Stopped at step 2, Text to me",
    text: "The Twilio key is missing. Add it and run again.",
    button: "Add the key",
  });
});

test("held steps say Not sent, each step offers its Values, and a clean run has no banner", () => {
  const steps = [step("a", "Make a task"), step("b", "Text to me", { writes: true })];
  const r = runView(steps, {
    a: { status: "ok", line: "x", values: [["Title", "T"]] },
    b: { status: "held", line: "Text to me", values: [] },
  });
  assert.deepEqual(
    r.rows.map((x) => [x.mark, x.tag, x.values.length]),
    [
      ["done", null, 1],
      ["held", "Not sent", 0],
    ],
  );
  assert.equal(r.banner, null);
});

test("a run waiting on a person says who and for what, and stops the steps after it", () => {
  const steps = [step("a", "Ask Maya to approve"), step("b", "Send")];
  const r = runView(steps, { a: { status: "waiting", line: "Waiting for Maya to approve 4 invoices" } });
  assert.deepEqual(
    r.rows.map((x) => [x.mark, x.line]),
    [
      ["waiting", "Waiting for Maya to approve 4 invoices"],
      ["skipped", null],
    ],
  );
  assert.equal(r.banner, null);
});

test("the run page starts with the trigger as When, then the steps from 1", () => {
  const r = runView(
    [step("a", "Make a task")],
    { a: { status: "ok", line: "x" } },
    {
      id: "t",
      app: { id: "vyre", name: "Vyre" },
      template: "A form is submitted: {form}",
      values: { form: { text: "Contact" } },
      hand: false,
    },
  );
  assert.deepEqual([r.when?.sentence.text, r.rows[0]!.number], ["A form is submitted: Contact", 1]);
});
