// Transform, Collect, Group by, open hours, Run code, and Run another automation.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf } from "../fixtures/db.ts";
import { callOf, node, HOUR } from "../fixtures/seed.ts";
import { callAutomation, runStep } from "../handlers/control.ts";
import { collectItems, groupItems, transformValue } from "../handlers/data-steps.ts";
import { nextOpen } from "../handlers/hours.ts";
import { runUserCode } from "../handlers/code-run.ts";

const hours = { timezone: "America/New_York", days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" };

test("transform copies named paths and skips a missing one", () => {
  assert.deepEqual(transformValue({ person: { name: "Ada" }, n: 2 }, { name: "person.name", n: "n", missing: "no.such" }), { name: "Ada", n: 2 });
  assert.throws(() => transformValue({}, "nope"), (e) => codeOf(e) === "validation.bad_input");
});

test("collect keeps a list and can pick fields", () => {
  assert.deepEqual(collectItems([{ a: 1, b: 2 }, 3], ["a"]), { items: [{ a: 1 }, 3], count: 2 });
  assert.throws(() => collectItems({ a: 1 }, []), (e) => codeOf(e) === "validation.bad_input");
});

test("group by keeps the first-seen order and an empty key", () => {
  assert.deepEqual(groupItems([{ city: "A" }, { city: "B" }, { city: "A" }, { other: 1 }], "city"), [
    { key: "A", items: [{ city: "A" }, { city: "A" }], count: 2 },
    { key: "B", items: [{ city: "B" }], count: 1 },
    { key: "", items: [{ other: 1 }], count: 1 },
  ]);
  assert.throws(() => groupItems("nope", "city"), (e) => codeOf(e) === "validation.bad_input");
});

test("open hours keep an instant inside the window and move one that is closed", () => {
  const inside = Date.UTC(2026, 0, 19, 15, 0, 0);
  assert.equal(nextOpen(inside, hours), inside);
  const saturdayNight = Date.UTC(2026, 0, 18, 1, 0, 0);
  assert.equal(nextOpen(saturdayNight, hours), Date.UTC(2026, 0, 19, 14, 0, 0));
  assert.throws(() => nextOpen(inside, { timezone: "UTC", days: [], start: "09:00", end: "17:00" }), (e) => codeOf(e) === "validation.bad_input");
});

test("a duration wait uses open hours on the first park and again when it resumes", async () => {
  const h = harness();
  const start = h.now();
  const open = { timezone: "UTC", days: [0, 1, 2, 3, 4, 5, 6], start: "09:00", end: "17:00" };
  const first = await runStep(h.env, node("w", "wait", { forDuration: "1h", hours: open }), callOf({ startedAt: start }));
  assert.equal(first.wait?.at, nextOpen(start + HOUR, open));
  const again = await runStep(h.env, node("w", "wait", { forDuration: "1h", hours: open }), callOf({ startedAt: start, resumed: true }));
  if (h.now() < nextOpen(start + HOUR, open)) assert.equal(again.wait?.at, nextOpen(start + HOUR, open));
  else assert.equal((again.output as { resumedBy?: string }).resumedBy, "duration");
});

test("a milestone wait does not move to open hours", async () => {
  const h = harness();
  const at = h.now() + 3 * 24 * HOUR;
  const r = await runStep(h.env, node("w", "wait", { at, hours }), callOf());
  assert.equal(r.wait?.at, at);
});

test("run code returns JSON and refuses the process object, a throw, and a timeout", () => {
  assert.deepEqual(runUserCode("return input.n + 1", { n: 2 }), { result: 3, logs: [] });
  assert.throws(() => runUserCode("return process.pid", {}), (e) => codeOf(e) === "validation.bad_input");
  assert.throws(() => runUserCode("throw new Error('nope')", {}), (e) => codeOf(e) === "validation.bad_input");
  assert.throws(() => runUserCode("while (true) {}", {}, 200), (e) => codeOf(e) === "timeout.deadline");
});

test("the code step uses the sandbox when the host provides one", async () => {
  const h = harness();
  const r = await runStep({
    ...h.env,
    code: async (_node, input) => ({ output: runUserCode(String(input.source ?? ""), input.input) }),
  }, node("c", "code", { language: "javascript", source: "return input.n + 1", input: { n: 2 } }), callOf());
  assert.deepEqual(r.output, { result: 3, logs: [] });
});

test("transform, collect, and group by run through the step catalogue", async () => {
  const h = harness();
  const transformed = await runStep(h.env, node("t", "transform", { value: { person: { name: "Ada" } }, mapping: { name: "person.name" } }), callOf());
  assert.deepEqual(transformed.output, { value: { name: "Ada" } });
  const collected = await runStep(h.env, node("c", "collect", { items: [{ a: 1, b: 2 }], fields: ["a"] }), callOf());
  assert.deepEqual(collected.output, { items: [{ a: 1 }], count: 1 });
  const grouped = await runStep(h.env, node("g", "group_by", { items: [{ city: "A" }, { city: "A" }], by: "city" }), callOf());
  assert.deepEqual(grouped.output, { groups: [{ key: "A", items: [{ city: "A" }, { city: "A" }], count: 2 }] });
});

test("run another automation waits, and a dropped start does not report success", async () => {
  const h = harness({}, { run: { id: "run_parent", automation: "aut_parent", depth: 2 } });
  h.callee("automations.fire", (input) => {
    assert.equal(input.depth, 3);
    assert.equal(input.origin, "automation:aut_parent");
    assert.equal(input.idempotencyKey, "run_t1:s:1");
    return { runId: "run_child" };
  });
  h.callee("runs.get", () => ({ run: { status: "running" } }));
  const waiting = await callAutomation(h.env, callOf(), { automationId: "aut_child", trigger: "manual", payload: { n: 1 } });
  assert.equal(waiting.wait?.runId, "run_child");
  h.callee("runs.get", () => ({ run: { status: "succeeded" } }));
  const done = await callAutomation(h.env, callOf(), { automationId: "aut_child", trigger: "manual" });
  assert.deepEqual(done.output, { runId: "run_child", status: "succeeded" });
  h.callee("automations.fire", () => ({ dropped: "paused" }));
  await assert.rejects(callAutomation(h.env, callOf(), { automationId: "aut_child", trigger: "manual" }), (e) => codeOf(e) === "validation.precondition_failed");
});
