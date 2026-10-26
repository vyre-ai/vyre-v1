// P-L6_24: the host's queue for Run drives: an event asks and returns, at most eight Runs are driven at once, one Run is never driven twice at the same time, and an ask that comes while a Run is
// being driven makes one more pass after it (the wait it just parked on may already be over).
import test from "node:test";
import assert from "node:assert/strict";
import { createRunsHost, MAX_DRIVES } from "../src/seams/runs.ts";

function rig() {
  const started: string[] = [];
  const release = new Map<string, () => void>();
  let active = 0, peak = 0;
  const call = (name: string, input: unknown): Promise<unknown> => {
    if (name === "runs.interrupted") return Promise.resolve(["run_old1", "run_old2"]);
    const id = (input as { runId: string }).runId;
    started.push(id);
    active += 1; peak = Math.max(peak, active);
    return new Promise((resolve) => release.set(id, () => { active -= 1; resolve("ok"); }));
  };
  const host = createRunsHost({ call });
  const finish = async (id: string): Promise<void> => { release.get(id)?.(); release.delete(id); await new Promise((r) => setTimeout(r, 0)); };
  return { host, started, finish, peak: () => peak };
}

test("at most eight Runs are driven at once and the rest wait their turn", async () => {
  const t = rig();
  const ids = Array.from({ length: 12 }, (_, i) => `run_${i}`);
  for (const id of ids) t.host.enqueue(id);
  assert.equal(t.started.length, MAX_DRIVES, "eight started, four queued");
  await t.finish("run_0");
  assert.equal(t.started.length, MAX_DRIVES + 1, "a finished drive lets the next in");
  for (const id of ids) await t.finish(id);
  assert.deepEqual([...t.started].sort(), [...ids].sort(), "every Run was driven once");
  assert.equal(t.peak(), MAX_DRIVES);
});

test("one Run is never driven twice at once, and an ask made meanwhile is one more pass afterwards", async () => {
  const t = rig();
  t.host.enqueue("run_a");
  t.host.enqueue("run_a");
  t.host.enqueue("run_a");
  assert.deepEqual(t.started, ["run_a"], "one drive");
  await t.finish("run_a");
  assert.deepEqual(t.started, ["run_a", "run_a"], "the asks that came meanwhile are one more pass, not three");
  await t.finish("run_a");
  assert.equal(t.started.length, 2);
});

test("recover queues what the last server left, and shutdown does not wait for ever", async () => {
  const t = rig();
  assert.equal(await t.host.recover(), 2);
  assert.deepEqual(t.started.sort(), ["run_old1", "run_old2"]);
  const began = Date.now();
  await t.host.settle(50);
  assert.ok(Date.now() - began < 1000, "settle gave up after its limit although two drives never finished");
});

test("a step denied because its person was removed or suspended fails the Run with the catalogued code and the reason, whatever the step's own error rule says", async () => {
  const denied = (reason: string, code: string) => Promise.reject({ error: { code, message: "denied", retryable: true, details: { reason } } });
  for (const [reason, code] of [["not_a_member", "auth.unauthenticated"], ["suspended", "permission.suspended"], ["revoked", "permission.revoked"]] as const) {
    const host = createRunsHost({
      call: (name) => {
        if (name === "automations.run_plan") return Promise.resolve({ link: { principal: { kind: "person", id: "usr_noah" }, automationId: "aut_1" }, definition: { nodes: [{ id: "a", key: "records.create", input: {}, onError: { mode: "continue" } }] } });
        return denied(reason, code);
      },
    });
    const r = await host.resolve({ id: "run_1" });
    assert.ok(r);
    await assert.rejects(r.exec({ id: "a" }, { attempt: 1, key: "k" } as never), (e: { error?: { code?: string; details?: { reason?: string }; retryable?: boolean } }) =>
      e.error?.code === code && e.error?.details?.reason === reason && e.error?.retryable === false, `${reason} is refused, not swallowed by "continue"`);
  }
});
