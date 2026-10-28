// runs.pin_version moves the visible definition pin and leaves the step log alone.
import test from "node:test";
import assert from "node:assert/strict";
import { harness, codeOf, reasonOf } from "../fixtures/db.ts";
import { engine, newRun } from "../fixtures/seed.ts";
import { pinVersion } from "../handlers/engine.ts";
import { allSteps } from "../projections.ts";

test("pin moves an active run and does not rewrite its steps or emit", async () => {
  const h = harness();
  const runId = (await h.call("runs.start", newRun({ definitionVersion: 1 }), engine)).runId as string;
  await h.call("runs.record_step", { runId, step: "tag", attempt: 1, state: "succeeded" }, engine);
  const before = allSteps(h.db, runId);
  const names = h.events.map((event) => event.name);
  const out = await pinVersion(h.ctxFor(null, engine), { runId, definitionVersion: 4 }) as { run: { definitionVersion: number; status: string } };
  assert.equal(out.run.definitionVersion, 4);
  assert.equal(out.run.status, "queued");
  assert.deepEqual(allSteps(h.db, runId), before);
  assert.deepEqual(h.events.map((event) => event.name), names);
  const same = await pinVersion(h.ctxFor(null, engine), { runId, definitionVersion: 4 }) as { run: { definitionVersion: number } };
  assert.equal(same.run.definitionVersion, 4);
});

test("a finished run cannot be pinned", async () => {
  const h = harness();
  const runId = (await h.call("runs.start", newRun({ definitionVersion: 1 }), engine)).runId as string;
  await h.call("runs.finish", { runId, status: "succeeded", summary: "done" }, engine);
  await assert.rejects(pinVersion(h.ctxFor(null, engine), { runId, definitionVersion: 2 }), (e) => codeOf(e) === "validation.precondition_failed" && reasonOf(e) === "run_finished");
});
