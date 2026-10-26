// P-CC_39: runs.erase removes one Run whole (row, step log with its inputs and outputs, wait, extra facts, trigger, idempotency key); runs.purge removes ended Runs older than a cutoff, oldest first, in batches,
// and never a Run that is still queued, running or waiting. Events carry ids and counts only.
import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "../fixtures/db.ts";
import type { Harness } from "../fixtures/db.ts";
import { DAY, engine, newRun } from "../fixtures/seed.ts";

const count = (h: Harness, table: string): number => (h.db.all(`SELECT * FROM ${table}`) as unknown[]).length;
const ids = (h: Harness): string[] => (h.db.all(`SELECT id FROM runs_items ORDER BY id`) as { id: string }[]).map((r) => r.id);

async function finished(h: Harness, name: string, secret?: string): Promise<string> {
  const run = (await h.call("runs.start", newRun({ name }), engine)).runId as string;
  await h.call("runs.record_step", { runId: run, step: "send", attempt: 1, state: "succeeded", ...(secret ? { input: { note: secret } } : {}) }, engine);
  await h.call("runs.finish", { runId: run, status: "succeeded" }, engine);
  return run;
}

test("erase removes one Run whole and leaves the others", async () => {
  const h = harness();
  const gone = await finished(h, "Intake for Pat", "Pat is divorcing");
  const keep = await finished(h, "Weekly digest");
  assert.equal(count(h, "runs_steps"), 2);
  const out = await h.call("runs.erase", { runId: gone, idempotencyKey: "k1" }, engine);
  assert.deepEqual(out, { erased: true });
  assert.deepEqual(ids(h), [keep]);
  assert.equal(count(h, "runs_steps"), 1);
  assert.ok(!JSON.stringify([h.db.all(`SELECT * FROM runs_items`), h.db.all(`SELECT * FROM runs_steps`), h.events]).includes("divorcing"), "the words are gone");
  assert.deepEqual(h.events.map((e) => [e.name, e.payload]), [["run.erased", { runId: gone }]]);
  assert.deepEqual(await h.call("runs.erase", { runId: gone, idempotencyKey: "k2" }, engine), { erased: false });
});

test("purge removes ended Runs older than the cutoff in batches, oldest first, and keeps young and unfinished ones", async () => {
  const h = harness();
  const a = await finished(h, "old a");
  h.advance(DAY);
  const b = await finished(h, "old b");
  h.advance(DAY);
  const c = await finished(h, "old c");
  const active = (await h.call("runs.start", newRun({ name: "Still running" }), engine)).runId as string;
  h.advance(10 * DAY);
  const young = await finished(h, "young");
  const cutoff = h.now() - 5 * DAY;

  const first = await h.call("runs.purge", { before: cutoff, limit: 2, idempotencyKey: "p1" }, engine);
  assert.deepEqual(first, { removed: 2, more: true });
  assert.ok(!ids(h).includes(a) && !ids(h).includes(b), "the oldest two went first");
  const second = await h.call("runs.purge", { before: cutoff, limit: 2, idempotencyKey: "p2" }, engine);
  assert.deepEqual(second, { removed: 1, more: false });
  assert.deepEqual(ids(h).sort(), [active, young].sort());
  assert.ok(!ids(h).includes(c));
  assert.deepEqual(h.events.map((e) => [e.name, e.payload]), [["runs.purged", { removed: 1 }]]);
  assert.deepEqual(await h.call("runs.purge", { before: cutoff, idempotencyKey: "p3" }, engine), { removed: 0, more: false });
});
