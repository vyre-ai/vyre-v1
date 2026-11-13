// runs.states: the status of many Runs in one call, for the host's sweeps. Every id asked gets an answer ("gone" for a Run that is not there); only the host may ask; at most 200.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import { alice, engine, newRun } from "../fixtures/seed.ts";

const host = { id: "svc_host", kind: "service" as const };
const code = (e: unknown): string | undefined => (e as { error?: { code?: string } } | null)?.error?.code;

test("every id asked gets an answer: its status, or gone for a Run that is not there", async () => {
  const h = harness();
  const live = (await h.call("runs.start", newRun({ name: "live" }), engine)).runId as string;
  const done = (await h.call("runs.start", newRun({ name: "done" }), engine)).runId as string;
  await h.call("runs.finish", { runId: done, status: "succeeded" }, engine);
  const missing = `run_${"0".repeat(32)}`;
  const out = await h.call("runs.states", { runIds: [live, done, missing] }, host);
  assert.deepEqual(out.states, [
    { runId: live, status: "queued" },
    { runId: done, status: "succeeded" },
    { runId: missing, status: "gone" },
  ]);
});

test("only the server asks: a person, an agent and a tenant service are refused", async () => {
  const h = harness();
  for (const who of [
    alice,
    { id: `agt_${"a".repeat(32)}`, kind: "agent" as const },
    { id: `svc_${"b".repeat(32)}`, kind: "service" as const },
  ])
    assert.equal(
      await h.call("runs.states", { runIds: [`run_${"0".repeat(32)}`] }, who).catch(code),
      "permission.no_grant",
      who.id.slice(0, 7),
    );
});

test("at most 200 Runs at a time", async () => {
  const h = harness();
  const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `run_${String(i).padStart(32, "0")}`);
  assert.equal((await h.call("runs.states", { runIds: ids(200) }, host)).states.length, 200);
  await assert.rejects(() => h.call("runs.states", { runIds: ids(201) }, host), /runIds|maxItems|200/);
});
