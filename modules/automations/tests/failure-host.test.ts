// The host catch calls failureResult. Skip and substitute return a result. Retry throws so the engine can try again. Route needs a step that exists.
import test from "node:test";
import assert from "node:assert/strict";
import { createRunsHost } from "../../../host/src/seams/runs.ts";

const timeout = Object.assign(new Error("nope"), { error: { code: "provider.timeout", message: "the provider timed out", retryable: true } });
const bad = Object.assign(new Error("bad"), { error: { code: "validation.bad_input", message: "bad input", retryable: false } });

function hostFor(nodes: Record<string, unknown>[], error: unknown) {
  const steps: string[] = [];
  const host = createRunsHost({
    call: (name) => {
      if (name === "automations.run_plan") return Promise.resolve({ link: { principal: { kind: "person", id: "usr_noah" }, automationId: "aut_1" }, definition: { nodes } });
      if (name === "steps-core.run_step") { steps.push(name); return Promise.reject(error); }
      return Promise.resolve(null);
    },
  });
  return { host, steps };
}

test("the host records skip and substitute without another attempt, and routes only a listed code to a step that exists", async () => {
  const skipped = hostFor([{ id: "a", key: "records.create", input: {}, onError: { mode: "skip" } }], timeout);
  const skipRun = await skipped.host.resolve({ id: "run_skip" });
  assert.ok(skipRun);
  assert.equal(skipRun.plan[0]?.retry, undefined);
  assert.deepEqual(await skipRun.exec({ id: "a" }, { attempt: 1, key: "k" } as never), { output: { skipped: true, error: "the provider timed out" } });
  assert.equal(skipped.steps.length, 1);

  const sub = hostFor([{ id: "a", key: "records.create", input: {}, onError: { mode: "substitute", output: { ok: false } } }], timeout);
  const subRun = await sub.host.resolve({ id: "run_sub" });
  assert.ok(subRun);
  assert.deepEqual(await subRun.exec({ id: "a" }, { attempt: 1, key: "k" } as never), { output: { ok: false } });
  assert.equal(sub.steps.length, 1);

  const open = hostFor([
    { id: "a", key: "records.create", input: {}, onError: { mode: "route", route: "b" } },
    { id: "b", key: "records.update", input: {} },
  ], bad);
  const openRun = await open.host.resolve({ id: "run_route" });
  assert.ok(openRun);
  assert.deepEqual(await openRun.exec({ id: "a" }, { attempt: 1, key: "k" } as never), { output: { error: "bad input" }, next: "b" });

  const filtered = hostFor([
    { id: "a", key: "records.create", input: {}, onError: { mode: "route", route: "b", codes: ["provider.timeout"] } },
    { id: "b", key: "records.update", input: {} },
  ], timeout);
  const filteredRun = await filtered.host.resolve({ id: "run_code" });
  assert.ok(filteredRun);
  assert.deepEqual(await filteredRun.exec({ id: "a" }, { attempt: 1, key: "k" } as never), { output: { error: "the provider timed out" }, next: "b" });

  const other = hostFor([
    { id: "a", key: "records.create", input: {}, onError: { mode: "route", route: "b", codes: ["provider.timeout"] } },
    { id: "b", key: "records.update", input: {} },
  ], bad);
  const otherRun = await other.host.resolve({ id: "run_other" });
  assert.ok(otherRun);
  await assert.rejects(otherRun.exec({ id: "a" }, { attempt: 1, key: "k" } as never), (e) => e === bad);

  const missing = hostFor([{ id: "a", key: "records.create", input: {}, onError: { mode: "route", route: "gone" } }], timeout);
  const missingRun = await missing.host.resolve({ id: "run_gone" });
  assert.ok(missingRun);
  await assert.rejects(missingRun.exec({ id: "a" }, { attempt: 1, key: "k" } as never), (e) => e === timeout);

  const again = hostFor([{ id: "a", key: "records.create", input: {}, onError: { mode: "retry", max: 99 } }], timeout);
  const againRun = await again.host.resolve({ id: "run_retry" });
  assert.ok(againRun);
  assert.equal(againRun.plan[0]?.retry?.max, 10);
  await assert.rejects(againRun.exec({ id: "a" }, { attempt: 1, key: "k" } as never), (e) => e === timeout);
  assert.equal(again.steps.length, 1);
});
