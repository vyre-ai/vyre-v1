// The HTTP request step picks its capability from the method, renders its inputs from earlier steps, and in a sandbox runs a read for real and records a send.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { runStep, stepsTest } from "../handlers/control.ts";
import type { StepCall } from "../handlers/control.ts";

const answer = { status: 200, ok: true, headers: {}, body: { n: 1 } };
const call = (over: Partial<StepCall> = {}): StepCall => ({ attempt: 1, key: "in:run_t1:hook:1", outputs: { lookup: { id: "ord_7" } }, resumed: false, trigger: {}, ...over } as StepCall);

test("a GET uses the read capability, has no body or key, and renders its address from an earlier step", async () => {
  const h = harness({ "automations.http_read": () => answer });
  const r = await runStep(h.env, { id: "hook", key: "http_request", input: { method: "GET", url: "https://api.example.com/orders/{{ steps.lookup.out.id }}", json: { ignored: true } } }, call());
  assert.deepEqual(r.output, answer);
  assert.equal(h.log.length, 1);
  assert.equal(h.log[0]!.cap, "automations.http_read");
  assert.deepEqual(h.log[0]!.input, { method: "GET", url: "https://api.example.com/orders/ord_7" });
});

test("a POST uses the send capability with the step's attempt key", async () => {
  const h = harness({ "automations.http_send": () => answer });
  await runStep(h.env, { id: "hook", key: "http_request", input: { method: "POST", url: "https://api.example.com/orders", json: { id: "{{ steps.lookup.out.id }}" }, auth: { kind: "bearer", handle: "#Acme_API" } } }, call());
  assert.equal(h.log[0]!.cap, "automations.http_send");
  assert.deepEqual(h.log[0]!.input, { method: "POST", url: "https://api.example.com/orders", json: { id: "ord_7" }, auth: { kind: "bearer", handle: "#Acme_API" }, idempotencyKey: "in:run_t1:hook:1" });
});

test("in a sandbox a GET runs for real and a POST is recorded, not sent", async () => {
  const h = harness({ "automations.http_read": () => answer, "automations.http_send": () => { throw new Error("a sandbox must not send"); } });
  const read = await runStep(h.env, { id: "a", key: "http_request", input: { method: "GET", url: "https://api.example.com/x" } }, call({ sandbox: true }));
  assert.deepEqual(read.output, answer);
  const sent = await runStep(h.env, { id: "b", key: "http_request", input: { method: "DELETE", url: "https://api.example.com/x" } }, call({ sandbox: true }));
  assert.equal(h.only("automations.http_send").length, 0);
  assert.deepEqual(Object.keys(sent.output as object).sort(), ["body", "headers", "ok", "status"]);
});

test("steps.test reports a GET as run and a PATCH as stubbed", async () => {
  const h = harness({ "automations.http_read": () => answer });
  const g = await stepsTest(h.ctx, { key: "http_request", input: { method: "GET", url: "https://api.example.com/x" } }) as { stubbed: boolean };
  const p = await stepsTest(h.ctx, { key: "http_request", input: { method: "PATCH", url: "https://api.example.com/x", json: {} } }) as { stubbed: boolean };
  assert.deepEqual([g.stubbed, p.stubbed], [false, true]);
});

test("a held send parks the Run on the Gate's task", async () => {
  const held = Object.assign(new Error("held"), { error: { code: "permission.needs_approval", message: "held", retryable: false, details: { taskId: "tsk_9" } } });
  const h = harness({ "automations.http_send": () => { throw held; } });
  const r = await runStep(h.env, { id: "hook", key: "http_request", input: { method: "POST", url: "https://api.example.com/x", json: {} } }, call());
  assert.deepEqual(r.wait, { reason: "approval", taskId: "tsk_9", on: "approval to send", cancelOn: ["task.withdrawn"] });
});
